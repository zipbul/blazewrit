import { Elysia } from 'elysia';
import type { SQL } from 'bun';
import { runFlow } from '../orchestrator/orchestrator';
import { PgOrchestratorStore } from '../orchestrator/infra/pg-store';
import { PacedStepExecutor } from '../orchestrator/paced-executor';
import { StubFlowClassifier } from '../triage/triage';
import type { TriageAgent } from '../triage/triage-agent';
import { recordTurn, isValidScope, recentWindow, threadIndexCard, markFailed } from '../triage/chat/turns';
import { maybeSummarize, latestSummary, makeLlmSummarizer, type Summarizer } from '../triage/chat/summarize';
import { ScopeQueue } from '../triage/chat/scope-queue';
import { routeProject } from '../meta/router';
import { seedProjectCard } from '../a2a/agent-card';
import { parseJsonRpc } from '../a2a/jsonrpc';
import { errorResponse } from '../a2a/types';
import { JSON_RPC_ERRORS, A2A_ERRORS } from '@bw/dto';
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
  /** Origin used for the central→project A2A call (real HTTP message/send to our own endpoint). */
  selfBaseUrl?: string;
  /** Central triage agent: structures a raw request into an Intent by reading the DB read-only. */
  triage?: TriageAgent;
  /** Chat compaction (defaults to one-shot LLM summarizer; tests inject a fake). */
  summarizer?: Summarizer;
}

/** REST + SSE surface the Angular UI consumes (DECISIONS §13), backed by Postgres. */
export function createRestApi(sql: SQL, deps: RestDeps = {}) {
  const flowHub = new FlowHub();
  const stepHub = new StepStreamHub();
  const store = new PgOrchestratorStore(sql);
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const selfBaseUrl = deps.selfBaseUrl ?? 'http://localhost:4500';
  // HITL: decisionId -> resolver that resumes the suspended flow.
  const pendingDecisions = new Map<string, (answer: string) => void>();
  // Per-scope turn serialization (single Bun process — a second instance would need a DB lock).
  const chatQueue = new ScopeQueue();
  /** Assemble one turn's history: latest summary (compacted past) + recent window + index card. */
  const chatHistory = async (scope: string) => {
    const s = await latestSummary(sql, scope);
    const window = await recentWindow(sql, scope, { maxTurns: 12 });
    return {
      window: s ? [{ seq: s.seq, role: 'summary', text: s.text }, ...window] : window,
      card: await threadIndexCard(sql),
    };
  };
  // Background compaction: keeps the primary (central) thread's context bounded as it grows.
  const summarizer = deps.summarizer ?? makeLlmSummarizer();
  const summarizing = new Set<string>();
  const kickSummarize = (scope: string): void => {
    if (summarizing.has(scope)) return;
    summarizing.add(scope);
    void maybeSummarize(sql, scope, summarizer)
      .catch((err) => flowHub.publish({ type: 'flow-error', message: `summarize: ${String(err)}` }))
      .finally(() => summarizing.delete(scope));
  };

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
  const workItemType = (flowType: ReturnType<StubFlowClassifier['classify']>): string =>
    flowType === 'bugfix' ? 'bug' : flowType === 'feature' ? 'feature' : 'task';

  /**
   * Project-side task handler (reached via the A2A message/send endpoint): triage the
   * inbound intent into a flow, then run it in the background. This is the single triage
   * call site — both human-origin (central router) and project-origin traffic land here.
   */
  const dispatchTask = (projectId: string, request: string, contextId?: string): string => {
    const flowType = new StubFlowClassifier().classify(request);
    const workItemId = newId();
    const ctx = contextId ?? workItemId; // correlate cross-project realizations of one intent
    // Background execution. Guarded so a failed task never crashes the server process.
    void (async () => {
      try {
        await sql`insert into work_items (id, project_id, type, state, title, context_id) values (${workItemId}, ${projectId}, ${workItemType(flowType)}, ${'in_flow'}, ${request}, ${ctx})`;
        flowHub.publish({ type: 'routed', workItemId, project: projectId });
        const result = await runFlow(flowType, {
          store: publishing(store, flowHub, stepHub),
          executor: deps.executor ?? new PacedStepExecutor(),
          newId,
          request,
          workItemId,
          onAgentEvent: (stepRunId, event) => stepHub.record(stepRunId, event),
          requestDecision: async (d) => {
            const id = newId();
            await sql`insert into decisions (id, flow_id, status, request_type, question, options) values (${id}, ${d.flowId}, ${'open'}, ${'single_choice'}, ${d.question}, ${JSON.stringify(d.options)})`;
            // The HITL question is a conversational turn in this task's thread.
            await recordTurn(sql, { scope: workItemId, role: 'agent', text: `❓ ${d.question} (질문함에서 답해주세요)` });
            flowHub.publish({ type: 'decision-open', id, flowId: d.flowId });
            return new Promise<string>((resolve) => pendingDecisions.set(id, resolve));
          },
          onLearning: async (l) => {
            await sql`insert into learnings (id, flow_id, project_id, text) values (${newId()}, ${l.flowId}, ${projectId}, ${l.text})`;
            flowHub.publish({ type: 'learning', flowId: l.flowId });
          },
        });
        await sql`update work_items set state = ${result.status === 'completed' ? 'done' : 'blocked'} where id = ${workItemId}`;
        flowHub.publish({ type: 'flow-finished', workItemId, flowId: result.flowId, status: result.status });
      } catch (err) {
        flowHub.publish({ type: 'flow-error', workItemId, message: String(err) });
      }
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

  /**
   * Central → project dispatch over REAL A2A: a JSON-RPC message/send HTTP call to the
   * target project's own /agents/:id/a2a endpoint (loopback). Same call shape a separate
   * process or a sibling project would use — splitting later is just a different host.
   */
  const dispatchViaA2A = async (projectId: string, intent: string): Promise<{ taskId?: string }> => {
    const envelope = {
      jsonrpc: '2.0',
      id: newId(),
      method: 'message/send',
      params: { message: { kind: 'message', messageId: newId(), role: 'user', parts: [{ kind: 'text', text: intent }] } },
    };
    const res = await fetch(`${selfBaseUrl}/agents/${encodeURIComponent(projectId)}/a2a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    const json = (await res.json()) as { result?: { id?: string } };
    return { taskId: json.result?.id };
  };

  /** Register a project as 'proposed' and open its approval decision (agent-proposes / user-approves). */
  const proposeNewProject = async (projectId: string, request: string) => {
    await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, ${'proposed'}) on conflict (id) do nothing`;
    const decId = newId();
    const meta = JSON.stringify({ kind: 'project_registration', projectId, request });
    await sql`insert into decisions (id, status, request_type, question, options, meta) values (${decId}, ${'open'}, ${'project_registration'}, ${`새 프로젝트 «${projectId}»를 등록할까요?`}, ${'[]'}, ${meta})`;
    flowHub.publish({ type: 'decision-open', id: decId, project: projectId });
    return { accepted: true, pendingRegistration: true, projectId };
  };

  /** Open a free-text clarification question in the drawer inbox (the graceful tail for ambiguous intent). */
  const openClarification = async (request: string, question: string, options: string[] = [], scope = 'central'): Promise<string> => {
    const decId = newId();
    const meta = JSON.stringify({ kind: 'clarification', request, scope });
    // free_text → drawer always shows a text box; stored options add clickable choices alongside it.
    await sql`insert into decisions (id, status, request_type, question, options, meta) values (${decId}, ${'open'}, ${'free_text'}, ${question}, ${JSON.stringify(options)}, ${meta})`;
    // The question is a conversational turn — memory must include it (no turn bypasses chat_messages).
    await recordTurn(sql, { scope, role: 'agent', text: `❓ ${question} (질문함에 등록됨)` });
    flowHub.publish({ type: 'decision-open', id: decId });
    return decId;
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
    // A2A JSON-RPC endpoint (spec §7): the project agent receives a task. message/send triages
    // the inbound intent and runs the flow; this is the one path human-origin + project-origin land on.
    .post(
      '/agents/:projectId/a2a',
      async ({ params, body, set }) => {
        const parsed = parseJsonRpc(typeof body === 'string' ? body : '');
        if (!parsed.ok) return parsed.response;
        const req = parsed.request;
        if (req.method !== 'message/send') {
          return errorResponse(req.id ?? null, JSON_RPC_ERRORS.METHOD_NOT_FOUND, 'Method not found');
        }
        const exists = ((await sql`select 1 from projects where id = ${params.projectId}`) as unknown[]).length > 0;
        if (!exists) {
          set.status = 404;
          return errorResponse(req.id ?? null, A2A_ERRORS.TASK_NOT_FOUND ?? -32001, 'unknown project');
        }
        const message = (req.params as { message?: { contextId?: string; parts?: Array<{ kind: string; text?: string }> } } | undefined)?.message;
        const intent = message?.parts?.find((p) => p.kind === 'text')?.text ?? '';
        const taskId = dispatchTask(params.projectId, intent, message?.contextId);
        return { jsonrpc: '2.0', id: req.id ?? null, result: { kind: 'task', id: taskId, status: { state: 'working' } } };
      },
      { parse: 'text' },
    )
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
          await dispatchViaA2A(projectId, meta.request as string); // dispatch the intent over real A2A
          await proposeConnection(projectId); // agent now proposes wiring it to a sibling project
        } else {
          await sql`delete from projects where id = ${projectId} and status = 'proposed'`;
          flowHub.publish({ type: 'project-rejected', project: projectId });
        }
      } else if (dbType === 'connection') {
        const relId = meta.relationshipId as string;
        if (approved) await sql`update relationships set status = 'confirmed' where id = ${relId}`;
        else await sql`delete from relationships where id = ${relId}`;
      } else if (meta.kind === 'clarification') {
        // The user clarified an ambiguous request: re-triage the combined text, then route it.
        const original = String(meta.request ?? '');
        const scope = typeof meta.scope === 'string' && meta.scope ? (meta.scope as string) : 'central';
        if (original && deps.triage) {
          const combined = `${original}\n\n[사용자 추가 설명] ${answer}`;
          // Serialized on the scope queue so it cannot interleave with a simultaneous dock send.
          void chatQueue.run(scope, async () => {
            const userTurn = await recordTurn(sql, { scope, role: 'user', text: `(질문함 답변) ${answer}` });
            try {
              const { reply, intent } = await deps.triage!.chat({ request: combined, scope, history: await chatHistory(scope) });
              await recordTurn(sql, { scope, role: 'agent', text: reply, payload: intent ? { intent } : undefined });
              if (!intent || intent.needsClarification) {
                await openClarification(combined, intent?.clarifyingQuestion ?? '추가 설명이 필요합니다', intent?.clarifyOptions ?? [], scope);
              } else if (intent.targetProject) {
                const active = (await sql`select id from projects where id = ${intent.targetProject} and status = 'active'`) as Array<unknown>;
                if (active.length) await dispatchViaA2A(intent.targetProject, combined);
                else await proposeNewProject(intent.suggestedProjectName ?? intent.targetProject, combined);
              } else {
                await proposeNewProject(intent.suggestedProjectName ?? `project-${newId().slice(0, 4)}`, combined);
              }
            } catch (err) {
              await markFailed(sql, userTurn.seq); // never strand a permanently-pending turn
              flowHub.publish({ type: 'flow-error', message: String(err) });
            }
          });
        }
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
        select w.id, w.project_id, w.type, w.state, w.title, w.context_id, w.created_at, f.id as active_flow_id
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
          contextId: (w.context_id as string) ?? undefined,
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
    // 똘이 conversation turn: persists both sides to chat_messages (memory = data), assembles
    // the history (recent window + thread index card), and runs the agent. Serialized per scope.
    .post('/api/triage', async ({ body, set }) => {
      const b = (typeof body === 'object' && body ? body : {}) as Record<string, unknown>;
      const request = typeof b.request === 'string' ? b.request : '';
      const scope = typeof b.scope === 'string' && b.scope ? b.scope : 'central';
      const clientMsgId = typeof b.clientMsgId === 'string' ? b.clientMsgId : undefined;
      if (!request.trim()) {
        set.status = 400;
        return { error: 'request is required' };
      }
      if (!(await isValidScope(sql, scope))) {
        set.status = 400;
        return { error: `unknown scope: ${scope}` };
      }
      if (!deps.triage) {
        set.status = 503;
        return { error: 'central agent not configured' };
      }
      return chatQueue.run(scope, async () => {
        const userTurn = await recordTurn(sql, { scope, role: 'user', text: request, clientMsgId });
        try {
          const { reply, intent, feedback, view } = await deps.triage!.chat({
            request,
            scope,
            history: await chatHistory(scope),
          });
          await recordTurn(sql, {
            scope,
            role: 'agent',
            text: reply,
            payload: intent || view ? { intent, view } : undefined,
          });
          kickSummarize(scope);
          if (feedback) {
            // Agent hit a platform limitation while serving this turn → append to the feedback board.
            await sql`insert into agent_feedback (id, category, content, request) values (${newId()}, ${feedback.category}, ${feedback.content}, ${request})`;
            flowHub.publish({ type: 'agent-feedback', category: feedback.category });
          }
          return { reply, intent, feedback, view };
        } catch (err) {
          await markFailed(sql, userTurn.seq); // exclude the orphaned user turn from future windows
          set.status = 500;
          return { error: String(err) };
        }
      });
    })
    // Conversation hydration for the FE dock: oldest-first page, before-cursor pagination.
    .get('/api/chat/:scope', async ({ params, query: q, set }) => {
      const scope = decodeURIComponent(params.scope);
      if (!(await isValidScope(sql, scope))) {
        set.status = 400;
        return { error: `unknown scope: ${scope}` };
      }
      const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50) || 50));
      const before = q.before !== undefined ? Number(q.before) : undefined;
      const rows = (before !== undefined && Number.isFinite(before)
        ? await sql`select seq, role, text, payload, created_at from chat_messages
            where scope = ${scope} and status <> 'failed' and redacted_at is null and seq < ${before}
            order by seq desc limit ${limit}`
        : await sql`select seq, role, text, payload, created_at from chat_messages
            where scope = ${scope} and status <> 'failed' and redacted_at is null
            order by seq desc limit ${limit}`) as Array<Record<string, unknown>>;
      return rows.reverse().map((r) => ({
        seq: Number(r.seq),
        role: r.role as string,
        text: r.text as string,
        payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload ?? null),
        createdAt: new Date(r.created_at as string).toISOString(),
      }));
    })
    // Agent self-improvement board: limitations the agent logged (ui/feature/unmet), newest first.
    .get('/api/feedback', async () => {
      const rows = (await sql`select * from agent_feedback order by created_at desc limit 200`) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: r.id as string,
        category: r.category as string,
        content: r.content as string,
        request: (r.request as string) ?? '',
        status: r.status as string,
        createdAt: new Date(r.created_at as string).toISOString(),
      }));
    })
    // Central META ROUTER: pick the target project, then dispatch the RAW intent to it over
    // real A2A (the project triages + runs). Central does not classify the flow type.
    .post('/api/run', async ({ body }) => {
      const request = typeof body === 'object' && body && 'request' in body ? String((body as { request: unknown }).request) : '';

      const existing = ((await sql`select id from projects where status = 'active'`) as Array<Record<string, unknown>>).map(
        (r) => r.id as string,
      );
      const route = routeProject(request, existing);

      if (route.kind === 'existing') {
        const { taskId } = await dispatchViaA2A(route.project, request);
        return { accepted: true, workItemId: taskId };
      }

      // New project: register as 'proposed' and ask the user (agent-proposes / user-approves).
      return proposeNewProject(route.project, request);
    })
    // Intent-resolved dispatch: the user approved a triage analysis, so route to the project the
    // central agent already resolved (re-validated here) instead of re-running the meta router.
    .post('/api/dispatch', async ({ body, set }) => {
      const b = (typeof body === 'object' && body ? body : {}) as Record<string, unknown>;
      const request = typeof b.request === 'string' ? b.request : '';
      const targetProject = typeof b.targetProject === 'string' ? b.targetProject : '';
      const newProjectName = typeof b.newProjectName === 'string' ? b.newProjectName.trim() : '';
      const scope = typeof b.scope === 'string' && b.scope ? b.scope : 'central';
      if (!request.trim()) {
        set.status = 400;
        return { error: 'request is required' };
      }
      if (targetProject) {
        const active = (await sql`select id from projects where id = ${targetProject} and status = 'active'`) as Array<unknown>;
        if (active.length === 0) {
          set.status = 409;
          return { error: `target project «${targetProject}» not found or not active` };
        }
        const { taskId } = await dispatchViaA2A(targetProject, request);
        // Confirmation is a conversational turn — server-side, so hydration shows what the user saw.
        await recordTurn(sql, { scope, role: 'agent', text: `✓ «${targetProject}»에서 실행했습니다.` });
        return { accepted: true, workItemId: taskId };
      }
      if (newProjectName) {
        // New project the agent named: register as 'proposed' and open the approval decision.
        const out = await proposeNewProject(newProjectName, request);
        await recordTurn(sql, { scope, role: 'agent', text: `➕ 새 프로젝트 «${newProjectName}» 등록을 제안했습니다 (승인 대기).` });
        return out;
      }
      set.status = 400;
      return { error: 'targetProject or newProjectName is required' };
    })
    // Open a clarification question (drawer inbox) for an ambiguous request; answering re-triages.
    .post('/api/clarify', async ({ body, set }) => {
      const b = (typeof body === 'object' && body ? body : {}) as Record<string, unknown>;
      const request = typeof b.request === 'string' ? b.request : '';
      const question = typeof b.question === 'string' ? b.question : '';
      const options = Array.isArray(b.options) ? b.options.filter((o): o is string => typeof o === 'string') : [];
      const scope = typeof b.scope === 'string' && b.scope ? b.scope : 'central';
      if (!request.trim() || !question.trim()) {
        set.status = 400;
        return { error: 'request and question are required' };
      }
      const decisionId = await openClarification(request, question, options, scope);
      return { accepted: true, decisionId };
    });
}
