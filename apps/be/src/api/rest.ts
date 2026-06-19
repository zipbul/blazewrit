import { Elysia } from 'elysia';
import type { SQL } from 'bun';
import { runFlow } from '../orchestrator/orchestrator';
import { PgOrchestratorStore } from '../orchestrator/infra/pg-store';
import { PacedStepExecutor } from '../orchestrator/paced-executor';
import { StubTriage } from '../triage/triage';
import { getWorkflow } from '../harness/workflows';
import { routeProject } from '../meta/router';
import { seedProjectCard } from '../a2a/agent-card';
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

  const parseJson = (raw: unknown, fallback: unknown) =>
    Array.isArray(raw) || (typeof raw === 'object' && raw !== null)
      ? raw
      : typeof raw === 'string' && raw
        ? JSON.parse(raw)
        : fallback;

  // Meta-agent decisions (registration/connection) render as approve/reject in the UI.
  const META_TYPES = new Set(['project_registration', 'connection']);

  const toDecisionDto = (row: Record<string, unknown>) => {
    const dbType = row.request_type as string;
    const opts = parseJson(row.options, []) as string[];
    const meta = parseJson(row.meta, {}) as Record<string, unknown>;
    const isMeta = META_TYPES.has(dbType);
    return {
      id: row.id as string,
      flowId: (row.flow_id as string) ?? '',
      requestingAgent: isMeta ? '메타' : 'decide',
      status: row.status as string,
      requestType: isMeta ? 'approval' : dbType,
      question: row.question as string,
      options: opts.map((o) => ({ label: o, value: o })),
      context: meta,
      blocking: !isMeta,
      createdAt: new Date(row.created_at as string).toISOString(),
      ...(row.answered_at ? { answeredAt: new Date(row.answered_at as string).toISOString() } : {}),
      ...(row.answer ? { answer: row.answer as string } : {}),
    };
  };

  // Map the classified flow type to the work_item type enum (bug | feature | task).
  const workItemType = (flowType: ReturnType<StubTriage['classify']>): string =>
    flowType === 'bugfix' ? 'bug' : flowType === 'feature' ? 'feature' : 'task';

  /** Create the work item for a (now active) project and run its flow in the background. */
  const launchFlow = (projectId: string, request: string, flowType: ReturnType<StubTriage['classify']>): string => {
    const workItemId = newId();
    void (async () => {
      await sql`insert into work_items (id, project_id, type, state, title) values (${workItemId}, ${projectId}, ${workItemType(flowType)}, ${'in_flow'}, ${request})`;
      flowHub.publish({ type: 'routed', workItemId, project: projectId });
      runFlow(flowType, {
        store: publishing(store, flowHub, stepHub),
        executor: deps.executor ?? new PacedStepExecutor(),
        newId,
        request,
        workItemId,
        onAgentEvent: (stepRunId, event) => stepHub.record(stepRunId, event),
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
    })();
    return workItemId;
  };

  /** Resolve a project's served Agent Card (stored domain card, or a name-derived fallback). */
  const serveCard = async (projectId: string, set: { status?: number | string }) => {
    const rows = (await sql`select id, name, card from projects where id = ${projectId}`) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) {
      set.status = 404;
      return { error: 'project not found', projectId };
    }
    const stored = parseJson(row.card, {}) as Record<string, unknown>;
    return stored.name ? stored : seedProjectCard({ projectId: row.id as string, name: row.name as string, intent: row.name as string });
  };

  /** Meta agent proposes wiring a newly-registered project to an existing one (agent-driven, user-approved). */
  const proposeConnection = async (newProjectId: string): Promise<void> => {
    const others = (await sql`
      select id from projects where status = 'active' and id <> ${newProjectId} order by created_at desc limit 1
    `) as Array<Record<string, unknown>>;
    const target = others[0]?.id as string | undefined;
    if (!target) return;
    const relId = newId();
    await sql`insert into relationships (id, from_project, to_project, type, status) values (${relId}, ${newProjectId}, ${target}, ${'depends'}, ${'proposed'})`;
    const decId = newId();
    const meta = JSON.stringify({ kind: 'connection', relationshipId: relId, from: newProjectId, to: target });
    await sql`insert into decisions (id, status, request_type, question, options, meta) values (${decId}, ${'open'}, ${'connection'}, ${`«${newProjectId}» → «${target}» 두 프로젝트를 연결할까요?`}, ${'[]'}, ${meta})`;
    flowHub.publish({ type: 'decision-open', id: decId });
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
        select p.id, p.name, p.status as reg_status,
               coalesce(c.active, 0)::int as active
        from projects p
        left join (
          select project_id, count(*) filter (where state = 'in_flow') as active
          from work_items group by project_id
        ) c on c.project_id = p.id
        order by p.created_at
      `) as Array<Record<string, unknown>>;
      return rows.map((p) => ({
        id: p.id as string,
        name: p.name as string,
        status: 'up',
        regStatus: p.reg_status as string, // 'proposed' | 'active'
        activeCount: p.active as number,
      }));
    })
    // A2A Agent Card discovery (spec §5). Standard path is agent-card.json; agent.json kept as a legacy alias.
    .get('/agents/:projectId/.well-known/agent-card.json', ({ params, set }) => serveCard(params.projectId, set))
    .get('/agents/:projectId/.well-known/agent.json', ({ params, set }) => serveCard(params.projectId, set))
    .get('/api/relationships', async () => {
      const rows = (await sql`select * from relationships order by created_at`) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: r.id as string,
        from: r.from_project as string,
        to: r.to_project as string,
        type: r.type as string,
        status: r.status as string, // 'proposed' | 'confirmed'
      }));
    })
    .get('/api/connections', () => [])
    .get('/api/decisions', async () => {
      const rows = (await sql`select * from decisions where status = 'open' order by created_at`) as Array<Record<string, unknown>>;
      return rows.map(toDecisionDto);
    })
    .post('/api/decisions/:id/answer', async ({ params, body }) => {
      const answer = typeof body === 'object' && body && 'answer' in body ? String((body as { answer: unknown }).answer) : '';
      const before = ((await sql`select * from decisions where id = ${params.id}`) as Array<Record<string, unknown>>)[0];
      await sql`update decisions set answer = ${answer}, status = 'answered', answered_at = now() where id = ${params.id}`;

      const dbType = before?.request_type as string | undefined;
      const meta = (parseJson(before?.meta, {}) as Record<string, unknown>) ?? {};
      const approved = answer === 'approved' || answer === 'approve';

      if (dbType === 'project_registration') {
        const projectId = meta.projectId as string;
        if (approved) {
          // Activate + seed the project's A2A Agent Card (common base + a domain skill from the intent).
          const card = seedProjectCard({ projectId, name: projectId, intent: meta.request as string });
          await sql`update projects set status = 'active', card = ${JSON.stringify(card)} where id = ${projectId}`;
          flowHub.publish({ type: 'project-activated', project: projectId });
          launchFlow(projectId, meta.request as string, meta.flowType as ReturnType<StubTriage['classify']>);
          await proposeConnection(projectId); // agent now proposes wiring it to a sibling project
        } else {
          await sql`delete from projects where id = ${projectId} and status = 'proposed'`;
          flowHub.publish({ type: 'project-rejected', project: projectId });
        }
      } else if (dbType === 'connection') {
        const relId = meta.relationshipId as string;
        if (approved) await sql`update relationships set status = 'confirmed' where id = ${relId}`;
        else await sql`delete from relationships where id = ${relId}`;
      } else {
        pendingDecisions.get(params.id)?.(answer); // resume the suspended flow
        pendingDecisions.delete(params.id);
      }

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
      const flowType = new StubTriage().classify(request);
      if (!getWorkflow(flowType)) return { error: 'no workflow for flow type', flowType };

      // Meta routing: route to an existing ACTIVE project, or propose a new one for approval.
      const existing = ((await sql`select id from projects where status = 'active'`) as Array<Record<string, unknown>>).map(
        (r) => r.id as string,
      );
      const route = routeProject(request, existing);

      if (route.kind === 'existing') {
        const workItemId = launchFlow(route.project, request, flowType);
        return { accepted: true, workItemId };
      }

      // New project: register as 'proposed' and ask the user (agent-proposes / user-approves).
      const projectId = route.project;
      await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, ${'proposed'}) on conflict (id) do nothing`;
      const decId = newId();
      const meta = JSON.stringify({ kind: 'project_registration', projectId, request, flowType });
      await sql`insert into decisions (id, status, request_type, question, options, meta) values (${decId}, ${'open'}, ${'project_registration'}, ${`새 프로젝트 «${projectId}»를 등록할까요?`}, ${'[]'}, ${meta})`;
      flowHub.publish({ type: 'decision-open', id: decId, project: projectId });
      return { accepted: true, pendingRegistration: true, projectId };
    });
}
