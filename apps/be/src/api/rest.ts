import { Elysia } from 'elysia';
import type { SQL } from 'bun';
import { runFlow } from '../orchestrator/orchestrator';
import { PgOrchestratorStore } from '../orchestrator/infra/pg-store';
import { PacedStepExecutor } from '../orchestrator/paced-executor';
import { StubFlowClassifier } from '../triage/triage';
import { WORKFLOWS } from '../harness/workflows';
import { buildWorkflow } from '../harness/build-workflow';
import { assembleFlow } from '../harness/assemble-flow';
import type { AssembleDeps } from '../harness/assemble-chain';
import { reAskSession } from '../harness/reask-session';
import { gatherFacts } from '../harness/gather-facts';
import type { TriageAgent } from '../triage/triage-agent';
import { recordTurn, isValidScope } from '../triage/chat/turns';
import { runTriageTurn, assembleHistory } from '../triage/chat/turn-runner';
import { maybeSummarize, makeLlmSummarizer, type Summarizer } from '../triage/chat/summarize';
import { ScopeQueue } from '../triage/chat/scope-queue';
import { seedProjectCard } from '../a2a/agent-card';
import { parseJsonRpc } from '../a2a/jsonrpc';
import { errorResponse } from '../a2a/types';
import { JSON_RPC_ERRORS, A2A_ERRORS, FLOW_TYPES, type FlowType } from '@bw/dto';
import { toFlowDto, toStepRunDto, type FlowRow, type StepRunRow } from './mappers';
import { FlowHub, StepStreamHub, publishing } from './streams';
import { createProposals } from '../meta/proposals';
import { insertJob } from '../graph/store';
import { assembleJobs, validateAssembly } from '../graph/assemble-jobs';
import { reconcileTask } from '../graph/reconcile';
import type { StepExecutor } from '../orchestrator/types';

/** Origins allowed to call the API — NEVER '*': any web page the user visits must not read the chat log. */
export const ALLOWED_ORIGINS = ['http://localhost:4200', 'http://127.0.0.1:4200'];

/** Reflect the origin only when allow-listed (else emit no CORS headers at all). */
function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    vary: 'origin',
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
  /** Flow assembler agent (QueryFn); when absent, assembly degrades to the grammar skeleton. */
  assembler?: AssembleDeps;
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
  // Job-graph reconcile handoff (harness/job-graph.md migration step 8): jobId -> the
  // dispatchTask call's own executeJobFlow closure. Two dispatches sharing a contextId land
  // under the SAME task, so reconcileTask(sql, ctx, ...) run from EITHER one can see (and claim)
  // the OTHER's job too — whichever dispatch's reconcile pass wins that race must still run the
  // claimed job's OWN flow (its flowType/request/dbFacts), not the caller's. This registry is
  // that indirection: each dispatchTask registers its closure under its own workItemId before
  // ever calling reconcileTask, so runRegisteredJob (below) always resolves a claimed job id back
  // to the executor that actually knows how to run it, regardless of which pass claimed it.
  const jobExecutors = new Map<string, () => Promise<void>>();
  const runRegisteredJob = async (job: { id: string }): Promise<void> => {
    const exec = jobExecutors.get(job.id);
    jobExecutors.delete(job.id);
    await exec?.();
  };
  const { proposeNewProject, proposeConnection, openClarification } = createProposals({
    sql,
    newId,
    publish: (e) => flowHub.publish(e),
  });
  // Per-scope turn serialization (single Bun process — a second instance would need a DB lock).
  const chatQueue = new ScopeQueue();
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
  const dispatchTask = (projectId: string, request: string, contextId?: string, carriedFlowType?: FlowType): string => {
    // Intent custody: the flowType the user APPROVED rides in A2A metadata and wins over the
    // keyword fallback — otherwise the approved card is decorative. Fallback serves
    // project-origin traffic that carries no intent.
    const flowType = carriedFlowType ?? new StubFlowClassifier().classify(request);
    const workItemId = newId();
    const ctx = contextId ?? workItemId; // correlate cross-project realizations of one intent

    // Runs this job's flow to completion (harness/job-graph.md migration step 8): extracted out
    // of the dispatch IIFE so it can be handed to reconcileTask as its dispatch callback instead
    // of only ever running inline. Self-contained — catches its OWN errors and marks both
    // work_items and jobs terminal on failure — because reconcileTask's own dispatch try/catch
    // only marks the jobs-table row 'failed' on a thrown error; if this function let an exception
    // escape instead of handling it here, the legacy work_items row would be left stuck at
    // 'in_flow' forever when run through reconcile. Direct-call and reconcile-call must behave
    // identically either way, so all terminal bookkeeping lives here, not in the caller.
    const executeJobFlow = async (): Promise<void> => {
      try {
        // TWO-PHASE AGENT-ASSEMBLED flow: with an assembler injected, seed ground-only and compose
        // the rest AFTER ground runs — the agent picks steps from ground's real output, not just the
        // seed. With none, run the curated workflow for this flow type (no network at boot).
        const dbFacts = await gatherFacts(sql, projectId, flowType, request);
        const seedWorkflow = deps.assembler
          ? { flowType, steps: [{ name: 'ground', reviewer: true }] }
          : buildWorkflow(flowType, WORKFLOWS[flowType].steps.map((s) => s.name));
        const composeRest = deps.assembler
          ? async ({ groundOutput }: { groundOutput: unknown }) => {
              const groundReport = typeof groundOutput === 'string' ? groundOutput : JSON.stringify(groundOutput);
              const a = await assembleFlow({ seed: flowType, facts: { ...dbFacts, groundReport } }, deps.assembler!);
              return { steps: a.workflow.steps, sessionId: a.sessionId };
            }
          : undefined;
        const result = await runFlow(seedWorkflow, {
          store: publishing(store, flowHub, stepHub),
          executor: deps.executor ?? new PacedStepExecutor(),
          newId,
          request,
          workItemId,
          // Job-graph mirror (harness/job-graph.md migration step 4): the job id mirrors the
          // work_item id one-to-one (commit 3's backfill convention). Since migration step 6
          // (above), the dual-write block already creates this job row up front, so this is now
          // a real live reference rather than an eventually-consistent one.
          jobId: workItemId,
          composeRest,
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
        // Job-graph mirror: a raw status update, not the state-machine (canTransitionJob /
        // bumpJobGeneration) — routing this through the proper transition machinery is P2
        // reconcile's job. This is best-effort bookkeeping so the mirror doesn't silently drift
        // while dispatch predates reconcile; a failure here must not affect the legacy path above.
        await sql`update jobs set status = ${result.status === 'completed' ? 'done' : 'failed'} where id = ${workItemId}`.catch(() => undefined);
        flowHub.publish({ type: 'flow-finished', workItemId, flowId: result.flowId, status: result.status });
      } catch (err) {
        await sql`update work_items set state = 'blocked' where id = ${workItemId}`.catch(() => undefined);
        await sql`update jobs set status = 'failed' where id = ${workItemId}`.catch(() => undefined);
        flowHub.publish({ type: 'flow-error', workItemId, message: String(err) });
      }
    };
    // Registered synchronously, before any await below — so if another dispatch under the SAME
    // ctx wins the reconcile claim race on THIS job (see jobExecutors above), it can still find
    // and run this exact closure the instant the row it's looking up could possibly exist.
    jobExecutors.set(workItemId, executeJobFlow);

    // Background execution. Guarded so a failed task never crashes the server process.
    void (async () => {
      try {
        await sql`insert into work_items (id, project_id, type, state, title, context_id) values (${workItemId}, ${projectId}, ${workItemType(flowType)}, ${'in_flow'}, ${request}, ${ctx})`;
        flowHub.publish({ type: 'routed', workItemId, project: projectId });

        // Job-graph dual-write (harness/job-graph.md migration step 6, moved ahead of step 5's
        // read-projection cutover): mirrors this dispatch into tasks/jobs live, at creation time,
        // instead of waiting for the next boot's work_items→jobs backfill (schema.ts) to self-heal
        // it — a project/task created after boot would otherwise stay invisible to the graph until
        // a restart. Best-effort: any failure here must never abort the legacy dispatch below (the
        // acceptance bar is "동작 현행 동일" — e.g. a re-dispatch into an already-terminal task ctx
        // is rejected by insertJob's rule-9 check, but the legacy work_items/runFlow path still
        // proceeds exactly as it does today).
        let graphWriteOk = false;
        try {
          // repos mirror: a project registered while the server was already running (this
          // dispatch's own project may be exactly that) has no repos row from boot's backfill yet.
          await sql`insert into repos (id, product_id, name, cwd) values (${projectId}, 'legacy', ${projectId}, '.') on conflict (id) do nothing`;
          // task upsert: the first dispatch under this ctx creates the task; a later dispatch
          // sharing the same ctx (a cross-repo realization of one intent) just adds a job under
          // the task that's already there — this is where "tasks span repos" becomes live, not
          // just boot-backfilled.
          await sql`insert into tasks (id, title, status) values (${ctx}, ${request}, 'open') on conflict (id) do nothing`;
          // Decomposition (migration step 7): dispatchTask no longer inserts a hard-coded single
          // job — it goes through the assembler + grammar check, so N>1 decomposition (migration
          // step 9) only has to change assembleJobs, not this call site. `[], []` stands in for
          // "this task's current jobs/deps" — always empty for now because N=1 means every task
          // has exactly one job at this point in dispatch; migration 9 replaces it with the
          // task's real loaded graph once a second decomposition could actually collide with one.
          const assembled = assembleJobs({ taskId: ctx, repoId: projectId, workItemId, request });
          const validation = validateAssembly([], [], assembled);
          if (!validation.ok) {
            flowHub.publish({ type: 'flow-error', workItemId, message: `graph mirror: invalid assembly: ${validation.reason}` });
          } else {
            for (const job of assembled.jobs) {
              await insertJob(sql, projectId, job);
            }
            graphWriteOk = true;
          }
        } catch (err) {
          flowHub.publish({ type: 'flow-error', workItemId, message: `graph mirror: ${String(err)}` });
        }

        // Reconcile (harness/job-graph.md migration step 8): dispatchTask no longer decides
        // ready→running inline — it hands the job off to the reconcile controller, which is the
        // only place that transition happens now. Only reachable when the graph write above
        // actually landed a jobs row for workItemId; if it didn't (best-effort catch or an
        // invalid assembly), there is nothing under `ctx` for reconcile to find, so this dispatch
        // falls back to running its flow directly — same "legacy path survives a dead graph"
        // guarantee migration step 6 already established, just phrased against reconcile instead
        // of insertJob.
        if (graphWriteOk) {
          await reconcileTask(sql, ctx, runRegisteredJob);
        } else {
          jobExecutors.delete(workItemId); // never reconciled — run it directly instead
          await executeJobFlow();
        }
      } catch (err) {
        jobExecutors.delete(workItemId);
        await sql`update work_items set state = 'blocked' where id = ${workItemId}`.catch(() => undefined);
        await sql`update jobs set status = 'failed' where id = ${workItemId}`.catch(() => undefined);
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
  const dispatchViaA2A = async (projectId: string, intent: string, meta?: { flowType?: FlowType }): Promise<{ taskId?: string }> => {
    const envelope = {
      jsonrpc: '2.0',
      id: newId(),
      method: 'message/send',
      params: {
        message: {
          kind: 'message',
          messageId: newId(),
          role: 'user',
          parts: [{ kind: 'text', text: intent }],
          ...(meta?.flowType ? { metadata: { flowType: meta.flowType } } : {}),
        },
      },
    };
    const res = await fetch(`${selfBaseUrl}/agents/${encodeURIComponent(projectId)}/a2a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    const json = (await res.json()) as { result?: { id?: string } };
    return { taskId: json.result?.id };
  };




  return new Elysia()
    .onAfterHandle(({ request, set }) => {
      for (const [k, v] of Object.entries(corsHeaders(request.headers.get('origin')))) set.headers[k] = v;
    })
    .options('/api/*', ({ request, set }) => {
      for (const [k, v] of Object.entries(corsHeaders(request.headers.get('origin')))) set.headers[k] = v;
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
        const message = (req.params as { message?: { contextId?: string; parts?: Array<{ kind: string; text?: string }>; metadata?: Record<string, unknown> } } | undefined)?.message;
        const intent = message?.parts?.find((p) => p.kind === 'text')?.text ?? '';
        // Trust boundary: only an enum-valid carried flowType is honored; anything else falls back.
        const rawFlow = message?.metadata?.flowType;
        const carried = typeof rawFlow === 'string' && (FLOW_TYPES as readonly string[]).includes(rawFlow) ? (rawFlow as FlowType) : undefined;
        const taskId = dispatchTask(params.projectId, intent, message?.contextId, carried);
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
    .get('/api/decisions', async () => {
      const rows = (await sql`select * from decisions where status = 'open' order by created_at`) as Array<Record<string, unknown>>;
      return rows.map(toDecisionDto);
    })
    .post('/api/decisions/:id/answer', async ({ params, body, set }) => {
      const answer = typeof body === 'object' && body && 'answer' in body ? String((body as { answer: unknown }).answer) : '';
      // Idempotent claim: only an OPEN decision can be answered, exactly once — a replay
      // (double-click / resent request) must never re-fire dispatch/registration side effects.
      const claimed = (await sql`
        update decisions set answer = ${answer}, status = 'answered', answered_at = now()
        where id = ${params.id} and status = 'open'
        returning *
      `) as Array<Record<string, unknown>>;
      if (claimed.length === 0) {
        const exists = (await sql`select 1 from decisions where id = ${params.id}`) as Array<unknown>;
        set.status = exists.length ? 409 : 404;
        return { error: exists.length ? 'decision already answered' : 'decision not found' };
      }
      const before = claimed[0];

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
          // Same runner as /api/triage — feedback/view/summaries must not silently diverge here.
          void chatQueue.run(scope, async () => {
            try {
              const { intent } = await runTriageTurn(sql, deps.triage!, {
                scope,
                request: combined,
                textPrefix: '(질문함 답변) ',
              });
              kickSummarize(scope);
              if (!intent || intent.needsClarification) {
                await openClarification(combined, intent?.clarifyingQuestion ?? '추가 설명이 필요합니다', intent?.clarifyOptions ?? [], scope);
              } else if (intent.targetProject) {
                const active = (await sql`select id from projects where id = ${intent.targetProject} and status = 'active'`) as Array<unknown>;
                if (active.length) {
                  await dispatchViaA2A(intent.targetProject, combined, { flowType: intent.flowType });
                  await recordTurn(sql, { scope, role: 'agent', text: `✓ «${intent.targetProject}»에서 실행했습니다.` });
                } else {
                  await proposeNewProject(intent.suggestedProjectName ?? intent.targetProject, combined);
                }
              } else {
                await proposeNewProject(intent.suggestedProjectName ?? `project-${newId().slice(0, 4)}`, combined);
              }
            } catch (err) {
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
    // Projection (harness/job-graph.md migration step 5, moved after step 6 — dispatchTask's
    // dual-write already guarantees a jobs row exists at creation time, so this cutover never
    // has to read a not-yet-mirrored work_item). DTO shape is byte-for-byte the WorkItemDto FE
    // contract; only the source tables changed, from work_items to jobs+flows.
    //
    // flows join: a live-dispatched flow carries BOTH job_id and work_item_id set to the same
    // id (pg-store.ts createFlow, jobId === workItemId by dispatchTask's convention), so the OR
    // matches that single row twice-over, not two rows. A legacy (pre-migration-4) flow has only
    // work_item_id set — the OR's second arm is what still finds it. Either way: one flow per job.
    //
    // state reverse-map: jobs.status is richer than the old work_items.state (which only ever
    // took in_flow/done/blocked), so 'done' stays 'done', 'failed'/'cancelled' collapse to
    // 'blocked' (mirrors dispatchTask's own failure mapping), everything else (pending/ready/
    // running/blocked) reads as 'in_flow' — the busy state the FE already knows how to render.
    //
    // Known divergence from the pre-swap projection: a legacy work_item with a null title showed
    // as '(untitled)' before; schema.ts's jobs backfill mirrors title as coalesce(w.title, w.id),
    // so the same row now shows its own id as the title. A job with no flow row at all (never
    // observed live, only theoretically possible for a hand-inserted/backfilled orphan) falls
    // back to type 'task', same fallback the old workItemType() used for unrecognized flow types.
    .get('/api/work-items', async () => {
      const rows = (await sql`
        select j.id, j.repo_id, j.title, j.status, j.task_id, j.created_at, f.id as flow_id, f.flow_type
        from jobs j
        left join flows f on (f.job_id = j.id or f.work_item_id = j.id)
        order by j.created_at desc
      `) as Array<Record<string, unknown>>;
      const jobStateToWorkItemState = (status: string): string =>
        status === 'done' ? 'done' : status === 'failed' || status === 'cancelled' ? 'blocked' : 'in_flow';
      return rows.map((j) => {
        const created = new Date(j.created_at as string).toISOString();
        const state = jobStateToWorkItemState(j.status as string);
        const flowType = j.flow_type as ReturnType<StubFlowClassifier['classify']> | null;
        return {
          id: j.id as string,
          projectId: j.repo_id as string,
          title: j.title as string,
          description: '',
          type: flowType ? workItemType(flowType) : 'task',
          labels: [] as string[],
          state,
          priority: 0,
          source: 'user',
          activeFlowId: (j.flow_id as string) ?? undefined,
          contextId: (j.task_id as string) ?? undefined,
          createdAt: created,
          updatedAt: created,
          ...(state === 'done' ? { completedAt: created } : {}),
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
    // Re-ask a flow's recorded assemble session — put a follow-up to the agent that composed the
    // flow, resuming its full context. The concrete debugging path the session ids exist for.
    .post('/api/flows/:id/assemble/ask', async ({ params, body, set }) => {
      const rows = (await sql`select assemble_session_id from flows where id = ${params.id}`) as Array<{ assemble_session_id: string | null }>;
      if (!rows[0]) { set.status = 404; return { error: 'flow not found' }; }
      const sessionId = rows[0].assemble_session_id;
      if (!sessionId) { set.status = 409; return { error: 'flow has no recorded assemble session' }; }
      const question = typeof body === 'object' && body ? String((body as { question?: unknown }).question ?? '') : '';
      if (!question) { set.status = 400; return { error: 'question required' }; }
      try {
        return await reAskSession(sessionId, question, deps.assembler ?? {});
      } catch (e) {
        set.status = 502;
        return { error: (e as Error).message };
      }
    })
    .get('/api/stream', ({ request }) => {
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
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', ...corsHeaders(request.headers.get('origin')) } });
    })
    .get('/api/step-runs/:id/stream', ({ params, request }) => {
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
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', ...corsHeaders(request.headers.get('origin')) } });
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
        try {
          const { reply, intent, feedback, view } = await runTriageTurn(sql, deps.triage!, { scope, request, clientMsgId });
          kickSummarize(scope);
          if (feedback) flowHub.publish({ type: 'agent-feedback', category: feedback.category });
          return { reply, intent, feedback, view };
        } catch (err) {
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
      // Same usable-turn predicate as recentWindow; summaries are internal, never shown to the user.
      const rows = (before !== undefined && Number.isFinite(before)
        ? await sql`select seq, role, text, payload, created_at from chat_messages
            where scope = ${scope} and status <> 'failed' and redacted_at is null and role <> 'summary' and seq < ${before}
            order by seq desc limit ${limit}`
        : await sql`select seq, role, text, payload, created_at from chat_messages
            where scope = ${scope} and status <> 'failed' and redacted_at is null and role <> 'summary'
            order by seq desc limit ${limit}`) as Array<Record<string, unknown>>;
      return rows.reverse().map((r) => ({
        seq: Number(r.seq),
        role: r.role as string,
        text: r.text as string,
        payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload ?? null),
        createdAt: new Date(r.created_at as string).toISOString(),
      }));
    })
    // Secret kill-switch: tombstone one turn — vanishes from hydration, the prompt window and
    // the agent view, and the text itself is scrubbed (filtering alone would leave the secret at rest).
    .post('/api/chat/:scope/:seq/redact', async ({ params, set }) => {
      const scope = decodeURIComponent(params.scope);
      const seq = Number(params.seq);
      if (!Number.isFinite(seq)) {
        set.status = 400;
        return { error: 'invalid seq' };
      }
      const rows = (await sql`
        update chat_messages set redacted_at = now(), text = '[삭제됨]'
        where seq = ${seq} and scope = ${scope} and redacted_at is null
        returning seq
      `) as Array<unknown>;
      if (rows.length === 0) {
        set.status = 404;
        return { error: 'turn not found in this scope' };
      }
      return { redacted: true, seq };
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
    // Intent-resolved dispatch: the user approved a triage analysis, so route to the project the
    // central agent already resolved (re-validated here) instead of re-running the meta router.
    .post('/api/dispatch', async ({ body, set }) => {
      const b = (typeof body === 'object' && body ? body : {}) as Record<string, unknown>;
      const request = typeof b.request === 'string' ? b.request : '';
      const targetProject = typeof b.targetProject === 'string' ? b.targetProject : '';
      const newProjectName = typeof b.newProjectName === 'string' ? b.newProjectName.trim() : '';
      const scope = typeof b.scope === 'string' && b.scope ? b.scope : 'central';
      // The approved card's flowType rides along; enum-validated at this trust boundary.
      const rawFlow = b.flowType;
      const flowType = typeof rawFlow === 'string' && (FLOW_TYPES as readonly string[]).includes(rawFlow) ? (rawFlow as FlowType) : undefined;
      if (!request.trim()) {
        set.status = 400;
        return { error: 'request is required' };
      }
      if (!(await isValidScope(sql, scope))) {
        set.status = 400;
        return { error: `unknown scope: ${scope}` };
      }
      if (targetProject) {
        const active = (await sql`select id from projects where id = ${targetProject} and status = 'active'`) as Array<unknown>;
        if (active.length === 0) {
          set.status = 409;
          return { error: `target project «${targetProject}» not found or not active` };
        }
        const { taskId } = await dispatchViaA2A(targetProject, request, { flowType });
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
      if (!(await isValidScope(sql, scope))) {
        set.status = 400;
        return { error: `unknown scope: ${scope}` };
      }
      const decisionId = await openClarification(request, question, options, scope);
      return { accepted: true, decisionId };
    });
}
