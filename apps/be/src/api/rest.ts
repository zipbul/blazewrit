import { Elysia } from 'elysia';
import type { SQL } from 'bun';
import { runFlow } from '../orchestrator/orchestrator';
import { PgOrchestratorStore } from '../orchestrator/infra/pg-store';
import { PacedStepExecutor } from '../orchestrator/paced-executor';
import { StubTriage } from '../triage/triage';
import { getWorkflow } from '../harness/workflows';
import { routeProject } from '../meta/router';
import { toFlowDto, toStepRunDto, type FlowRow, type StepRunRow } from './mappers';
import type { AgentEvent, OrchestratorStore, StepExecutor } from '../orchestrator/types';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

/** Flow-level SSE hub: the write path publishes, dashboard subscribes (status = mirror). */
class FlowHub {
  private readonly subs = new Set<(line: string) => void>();
  subscribe(fn: (line: string) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  publish(event: object): void {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const fn of this.subs) fn(line);
  }
}

interface StepSub {
  onEvent: (dto: Record<string, unknown>) => void;
  onDone: () => void;
}

/** Per-step-run agent-output hub: buffers events for replay + live-streams to UI subscribers. */
class StepStreamHub {
  private readonly buffers = new Map<string, Array<Record<string, unknown>>>();
  private readonly subs = new Map<string, Set<StepSub>>();
  private readonly finished = new Set<string>();
  private readonly seqs = new Map<string, number>();

  record(stepRunId: string, ev: AgentEvent): void {
    const seq = (this.seqs.get(stepRunId) ?? 0) + 1;
    this.seqs.set(stepRunId, seq);
    const dto = {
      id: `${stepRunId}-${seq}`,
      stepRunId,
      sessionId: stepRunId,
      seq,
      type: ev.type,
      payload: ev.payload,
      createdAt: new Date().toISOString(),
    };
    const buf = this.buffers.get(stepRunId) ?? [];
    buf.push(dto);
    this.buffers.set(stepRunId, buf);
    for (const sub of this.subs.get(stepRunId) ?? []) sub.onEvent(dto);
  }

  finish(stepRunId: string): void {
    this.finished.add(stepRunId);
    for (const sub of this.subs.get(stepRunId) ?? []) sub.onDone();
  }

  subscribe(stepRunId: string, onEvent: StepSub['onEvent'], onDone: StepSub['onDone']): () => void {
    for (const e of this.buffers.get(stepRunId) ?? []) onEvent(e);
    if (this.finished.has(stepRunId)) {
      onDone();
      return () => {};
    }
    const sub: StepSub = { onEvent, onDone };
    const set = this.subs.get(stepRunId) ?? new Set<StepSub>();
    set.add(sub);
    this.subs.set(stepRunId, set);
    return () => set.delete(sub);
  }
}

/** Wrap a store so flow/step-run writes publish flow events (+ close per-step streams on finish). */
function publishing(store: OrchestratorStore, flowHub: FlowHub, stepHub: StepStreamHub): OrchestratorStore {
  return {
    createFlow: async (f) => {
      await store.createFlow(f);
      flowHub.publish({ type: 'flow-created', flowId: f.id, flowType: f.flowType });
    },
    setCurrentStep: async (id, step) => {
      await store.setCurrentStep(id, step);
      flowHub.publish({ type: 'current-step', flowId: id, currentStep: step });
    },
    setStatus: async (id, status) => {
      await store.setStatus(id, status);
      flowHub.publish({ type: 'status', flowId: id, status });
    },
    startStepRun: async (r) => {
      await store.startStepRun(r);
      flowHub.publish({ type: 'step-run-started', flowId: r.flowId, stepRunId: r.id, step: r.step, role: r.role });
    },
    finishStepRun: async (id, status, verdict) => {
      await store.finishStepRun(id, status, verdict);
      flowHub.publish({ type: 'step-run-finished', stepRunId: id, status, verdict });
      stepHub.finish(id);
    },
    getFlow: (id) => store.getFlow(id),
    stepRuns: (id) => store.stepRuns(id),
  };
}

export interface RestDeps {
  /** Step executor for /api/run; defaults to the paced stub (no LLM). Pass AgentStepExecutor for real runs. */
  executor?: StepExecutor;
  newId?: () => string;
}

/** REST + SSE surface the Angular UI consumes (DECISIONS §13), backed by Postgres. */
export function createRestApi(sql: SQL, deps: RestDeps = {}) {
  const flowHub = new FlowHub();
  const stepHub = new StepStreamHub();
  const store = new PgOrchestratorStore(sql);
  const newId = deps.newId ?? (() => crypto.randomUUID());
  // HITL: decisionId -> resolver that resumes the suspended flow.
  const pendingDecisions = new Map<string, (answer: string) => void>();

  const toDecisionDto = (row: Record<string, unknown>) => {
    const raw = row.options;
    const opts: string[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? (JSON.parse(raw) as string[]) : [];
    return {
    id: row.id as string,
    flowId: (row.flow_id as string) ?? '',
    requestingAgent: 'decide',
    status: row.status as string,
    requestType: row.request_type as string,
    question: row.question as string,
    options: opts.map((o) => ({ label: o, value: o })),
    context: {},
    blocking: true,
    createdAt: new Date(row.created_at as string).toISOString(),
    ...(row.answered_at ? { answeredAt: new Date(row.answered_at as string).toISOString() } : {}),
    ...(row.answer ? { answer: row.answer as string } : {}),
    };
  };

  return new Elysia()
    .onAfterHandle(({ set }) => {
      for (const [k, v] of Object.entries(CORS)) set.headers[k] = v;
    })
    .options('/api/*', ({ set }) => {
      for (const [k, v] of Object.entries(CORS)) set.headers[k] = v;
      return '';
    })
    .get('/api/projects', async () => {
      const rows = (await sql`
        select project_id, count(*) filter (where state = 'in_flow')::int as active
        from work_items group by project_id
      `) as Array<Record<string, unknown>>;
      return rows.map((p) => ({ id: p.project_id as string, name: p.project_id as string, status: 'up', activeCount: p.active as number }));
    })
    .get('/api/connections', () => [])
    .get('/api/decisions', async () => {
      const rows = (await sql`select * from decisions where status = 'open' order by created_at`) as Array<Record<string, unknown>>;
      return rows.map(toDecisionDto);
    })
    .post('/api/decisions/:id/answer', async ({ params, body }) => {
      const answer = typeof body === 'object' && body && 'answer' in body ? String((body as { answer: unknown }).answer) : '';
      await sql`update decisions set answer = ${answer}, status = 'answered', answered_at = now() where id = ${params.id}`;
      pendingDecisions.get(params.id)?.(answer); // resume the suspended flow
      pendingDecisions.delete(params.id);
      flowHub.publish({ type: 'decision-answered', id: params.id, answer });
      const row = ((await sql`select * from decisions where id = ${params.id}`) as Array<Record<string, unknown>>)[0];
      return row ? toDecisionDto(row) : { id: params.id, answer };
    })
    .get('/api/learnings', async () => {
      const rows = (await sql`select * from learnings order by created_at desc`) as Array<Record<string, unknown>>;
      return rows.map((l) => ({
        id: l.id as string,
        flowId: l.flow_id as string,
        text: l.text as string,
        createdAt: new Date(l.created_at as string).toISOString(),
      }));
    })
    .get('/api/work-items', async () => {
      const rows = (await sql`
        select w.id, w.project_id, w.type, w.state, w.title, w.created_at, f.id as active_flow_id
        from work_items w
        left join flows f on f.work_item_id = w.id
        order by w.created_at desc
      `) as Array<Record<string, unknown>>;
      return rows.map((w) => {
        const created = new Date(w.created_at as string).toISOString();
        return {
          id: w.id as string,
          projectId: w.project_id as string,
          title: (w.title as string) ?? '(untitled)',
          description: '',
          type: w.type as string,
          labels: [] as string[],
          state: w.state as string,
          priority: 0,
          source: 'user',
          activeFlowId: (w.active_flow_id as string) ?? undefined,
          createdAt: created,
          updatedAt: created,
          ...(w.state === 'done' ? { completedAt: created } : {}),
        };
      });
    })
    .get('/api/flows', async () => {
      const rows = (await sql`select * from flows order by created_at`) as FlowRow[];
      return rows.map(toFlowDto);
    })
    .get('/api/flows/:id/step-runs', async ({ params }) => {
      const rows = (await sql`
        select id, flow_id, step_name, role, attempt_no, status, verdict, started_at, ended_at
        from step_runs where flow_id = ${params.id} order by started_at, id
      `) as StepRunRow[];
      return rows.map(toStepRunDto);
    })
    .get('/api/stream', () => {
      let unsub = () => {};
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
          unsub = flowHub.subscribe((line) => controller.enqueue(line));
        },
        cancel() {
          unsub();
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', ...CORS } });
    })
    .get('/api/step-runs/:id/stream', ({ params }) => {
      let unsub = () => {};
      const stream = new ReadableStream({
        start(controller) {
          const send = (event: string, data: object) =>
            controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          unsub = stepHub.subscribe(
            params.id,
            (dto) => send('agent-event', dto),
            () => {
              send('done', {});
              controller.close();
            },
          );
        },
        cancel() {
          unsub();
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', ...CORS } });
    })
    .post('/api/run', async ({ body }) => {
      const request = typeof body === 'object' && body && 'request' in body ? String((body as { request: unknown }).request) : '';
      const hitl = typeof body === 'object' && body && 'hitl' in body ? Boolean((body as { hitl: unknown }).hitl) : false;
      const flowType = new StubTriage().classify(request);
      if (!getWorkflow(flowType)) return { error: 'no workflow for flow type', flowType };

      // Meta routing: pick (or create) the target project from the intent.
      const existing = ((await sql`select distinct project_id from work_items`) as Array<Record<string, unknown>>).map(
        (r) => r.project_id as string,
      );
      const route = routeProject(request, existing);
      const projectId = route.project;

      const workItemId = newId();
      await sql`insert into work_items (id, project_id, type, state, title) values (${workItemId}, ${projectId}, ${'feature'}, ${'in_flow'}, ${request})`;
      flowHub.publish({ type: 'routed', workItemId, project: projectId, created: route.kind === 'create' });

      void runFlow(flowType, {
        store: publishing(store, flowHub, stepHub),
        executor: deps.executor ?? new PacedStepExecutor(),
        newId,
        request,
        workItemId,
        onAgentEvent: (stepRunId, event) => stepHub.record(stepRunId, event),
        hitl,
        requestDecision: async (d) => {
          const id = newId();
          await sql`insert into decisions (id, flow_id, status, request_type, question, options) values (${id}, ${d.flowId}, ${'open'}, ${'single_choice'}, ${d.question}, ${JSON.stringify(d.options)})`;
          flowHub.publish({ type: 'decision-open', id, flowId: d.flowId });
          return new Promise<string>((resolve) => pendingDecisions.set(id, resolve));
        },
        onLearning: async (l) => {
          await sql`insert into learnings (id, flow_id, project_id, text) values (${newId()}, ${l.flowId}, ${projectId}, ${l.text})`;
          flowHub.publish({ type: 'learning', flowId: l.flowId });
        },
      })
        .then(async (result) => {
          await sql`update work_items set state = ${result.status === 'completed' ? 'done' : 'blocked'} where id = ${workItemId}`;
          flowHub.publish({ type: 'flow-finished', workItemId, flowId: result.flowId, status: result.status });
        })
        .catch((err) => flowHub.publish({ type: 'flow-error', workItemId, message: String(err) }));

      return { accepted: true, workItemId };
    });
}
