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
import { errorResponse, type JsonRpcErrorResponse } from '../a2a/types';
import { JSON_RPC_ERRORS, A2A_ERRORS, FLOW_TYPES, type FlowType } from '@bw/dto';
import { toFlowDto, toStepRunDto, type FlowRow, type StepRunRow } from './mappers';
import { FlowHub, StepStreamHub, publishing } from './streams';
import { createProposals } from '../meta/proposals';
import {
  insertJob,
  WriteAclError,
  TerminalTaskError,
  SliceSealedError,
  DepCycleError,
  JobNotFoundError,
  WaiterNotWaitingError,
  DepWaiterTaskMismatchError,
  DepTargetNotFoundError,
} from '../graph/store';
import { assembleJobs, validateAssembly } from '../graph/assemble-jobs';
import { loadTaskGraph } from '../graph/load-task-graph';
import { insertProposal, materializeAskTx, TaskNotOpenError, EmptyAskError, ProposalIdConflictError, type NegotiationAsk } from '../graph/negotiation';
import { consumeJobEvents, reconcileTask, type ReconcileJob } from '../graph/reconcile';
import { withLeaseHeartbeat, renewLease, DEFAULT_LEASE_TTL_MS } from '../graph/lease';
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
  /** Builds a step executor bound to one repo's cwd (real mode). Wins over `executor` when set. */
  executorFor?: (cwd: string) => StepExecutor;
  newId?: () => string;
  /** Origin used for the central→project A2A call (real HTTP message/send to our own endpoint). */
  selfBaseUrl?: string;
  /** Central triage agent: structures a raw request into an Intent by reading the DB read-only. */
  triage?: TriageAgent;
  /** Chat compaction (defaults to one-shot LLM summarizer; tests inject a fake). */
  summarizer?: Summarizer;
  /** Flow assembler agent (QueryFn); when absent, assembly degrades to the grammar skeleton. */
  assembler?: AssembleDeps;
  /** Reconcile claim lease TTL (harness/job-graph.md P2). Defaults to lease.ts's DEFAULT_LEASE_TTL_MS. */
  leaseTtlMs?: number;
  /**
   * Called once, synchronously, during setup with the registry-aware reconcile dispatch callback
   * (the same one dispatchTask's own inline reconcile call uses) — the caller's hook for wiring up
   * graph/controller.ts's startGraphController without createRestApi needing to import or know
   * about the controller itself. Keeps createRestApi's public surface (still a bare Elysia app)
   * unchanged.
   */
  onReconcileDispatch?: (dispatch: (job: ReconcileJob) => Promise<void>) => void;
}

/**
 * repos.cwd is the executor-binding source of truth for a dispatch (harness/job-graph.md "주권
 * 단위 = 레포" + its 배선점 note: "실행기 cwd가 현재 프로세스당 고정 → dispatch 시 repos.cwd로
 * 레포별 cwd 해석 배선 필요" — this is that wiring). Resolved fresh per dispatch instead of once
 * per process, so each repo's jobs run pinned to their own checkout.
 *
 * Module-level (not a createRestApi closure) so it's unit-testable with a bare fake `sql`, no live
 * Postgres required (수정 B2-3, minor 묶음). Only "no repos row for this id yet" reads as '.' —
 * an honest "not configured yet" signal, the same one serve.ts's real executorFor already treats
 * specially. A genuine query failure is NOT swallowed into that same '.' anymore (it used to be) —
 * that made a broken DB connection indistinguishable from "not configured", silently running a
 * job's flow pinned to the wrong (process-default) directory instead of surfacing the failure;
 * executeJobFlow's own top-level try/catch already handles a thrown error correctly (marks the
 * job/work_item failed), so there's no need to pre-swallow it here.
 */
export async function resolveRepoCwd(sql: SQL, repoId: string): Promise<string> {
  const rows = (await sql`select cwd from repos where id = ${repoId}`) as Array<{ cwd: string }>;
  return rows[0]?.cwd ?? '.';
}

/** Short, fixed backoff between job_events insert retries (F1, 3자 리뷰 수정 라운드) — this is a
 * local transient-error retry, not a long-horizon recovery mechanism (the periodic controller tick
 * already provides that safety net via consumeJobEvents' global sweep), so the total added latency
 * stays small. */
export const DEFAULT_RECORD_OUTCOME_RETRY_DELAYS_MS = [50, 100];

export type InsertJobEventResult = { ok: true } | { ok: false; error: unknown };

/**
 * F1 (3자 리뷰 수정 라운드): the durable-fact insert must never be silently swallowed — a job_events
 * row IS the only record this generation's outcome will ever get (the CAS/generation guards that
 * used to live on the completion WRITE are gone; there is nothing else to fall back on). Retries a
 * bounded number of times against transient failures (connection blip, deadlock) before giving up;
 * `on conflict do nothing`'s own duplicate-suppression never throws, so every caught error here is
 * a REAL failure, not a normal "someone else already recorded this" outcome.
 *
 * Module-level (not a createRestApi closure), same reasoning as resolveRepoCwd right above: unit
 * testable with a bare fake `sql` that injects a failure, no live Postgres required. The caller
 * (createRestApi's recordJobOutcome) is what turns `{ ok: false }` into the actual
 * console.error + flow-error publish — this function only owns the retry loop itself, so a test can
 * assert the retry COUNT and the returned error without needing a real flowHub/publish wiring.
 */
export async function insertJobEventWithRetry(
  sql: SQL,
  workItemId: string,
  jobGeneration: number,
  kind: 'succeeded' | 'failed',
  retryDelaysMs: number[] = DEFAULT_RECORD_OUTCOME_RETRY_DELAYS_MS,
): Promise<InsertJobEventResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      await sql`insert into job_events (job_id, generation, kind) values (${workItemId}, ${jobGeneration}, ${kind}) on conflict do nothing`;
      return { ok: true };
    } catch (err) {
      lastErr = err;
      const delay = retryDelaysMs[attempt];
      if (delay !== undefined) await new Promise((r) => setTimeout(r, delay));
    }
  }
  return { ok: false, error: lastErr };
}

/** Whether `job_events`'s row for this exact (job, generation, kind) fact has been consumed
 * (`processed_at` set) — R1's own verification point: reconcileTask's inline consumeJobEvents call
 * can fail on THIS specific event's own transaction (logged internally, not rethrown — see
 * consumeJobEvents' own doc comment) and still let reconcileTask resolve normally, so a caller that
 * only checked "did reconcileTask throw" would miss it entirely. */
async function isJobEventProcessed(sql: SQL, workItemId: string, jobGeneration: number, kind: 'succeeded' | 'failed'): Promise<boolean> {
  const rows = (await sql`
    select 1 from job_events where job_id = ${workItemId} and generation = ${jobGeneration} and kind = ${kind} and processed_at is not null
  `) as unknown[];
  return rows.length > 0;
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
  // Job-graph reconcile handoff (harness/job-graph.md migration step 8): jobId -> the executor
  // closure for that job. Two dispatches sharing a contextId land under the SAME task, so
  // reconcileTask(sql, ctx, ...) run from EITHER one can see (and claim) the OTHER's job too —
  // whichever dispatch's reconcile pass wins that race must still run the claimed job's OWN flow
  // (its flowType/request/dbFacts), not the caller's. This registry is that indirection: each
  // dispatchTask registers its closure under its own workItemId before ever calling
  // reconcileTask, so runRegisteredJob (below) always resolves a claimed job id back to the
  // executor that actually knows how to run it, regardless of which pass claimed it. A registry
  // MISS (below) no longer means "nobody will ever run this" (P4-2b) — it's reconstructed
  // straight from the jobs row instead.
  const jobExecutors = new Map<string, () => Promise<void>>();
  const leaseTtlMs = deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;

  /**
   * 단일 기록자 통합 Phase 1 (job-graph.md C1): execution never writes jobs/work_items status
   * directly anymore — reconcile's serial loop (graph/reconcile.ts's consumeJobEvents) is the only
   * writer of a jobs status transition. This records the fact ("this generation ended succeeded/
   * failed") as an append-only `job_events` row — the PK (job_id, generation, kind) makes a
   * duplicate report of the SAME fact a safe no-op (`on conflict do nothing`), which is what lets
   * every CAS/generation guard that used to live on the completion WRITE itself (3자 리뷰 수정
   * A라운드 A1, E1) disappear: there is no longer a write here for a late/stale report to clobber
   * anything with.
   *
   * F3 (3자 리뷰 수정 라운드): reconcileTask is AWAITED here, not fire-and-forget — so a caller that
   * only publishes 'flow-finished'/'flow-error' AFTER this returns is publishing it once the state
   * this event describes has actually been (attempted to be) applied, not merely recorded. This is
   * safe for controller.tick()'s own non-blocking contract (3자 리뷰 수정 B1-2b): makeJobFlow's
   * returned closure is ALWAYS run fire-and-forget one layer up (runRegisteredJob's `void exec()` /
   * `void reconstructed()`), so awaiting inside it never blocks tick() itself.
   *
   * R1 (3자 리뷰 수정 라운드, Codex 재검증): a failure INSIDE reconcileTask's own consumeJobEvents
   * call is caught and logged AT THAT LEVEL, not rethrown (consumeJobEvents' own per-event try/catch
   * — see its doc comment) — so `await reconcileTask(...)` above resolving without throwing does NOT
   * mean THIS event was actually applied; it could have failed its own claim/apply transaction and
   * simply moved on to the next event. Checking `processed_at` explicitly (isJobEventProcessed) is
   * what catches that gap — without it, a caller would report 'flow-finished' while the job sits
   * 'running' forever, a false success. Retries a short, bounded number of times (2, 100ms apart) by
   * calling consumeJobEvents directly — a transient failure (lock contention, a momentary connection
   * blip) often clears within that window. If it's STILL unprocessed after that, this is NOT a lost
   * fact (the job_events row is durably committed; the next periodic controller tick's global sweep
   * will still apply it eventually) — only the IMMEDIATE report is downgraded from success to
   * flow-error, so nothing downstream is told "done" before the DB agrees.
   *
   * Falls back to the LEGACY direct work_items write only when no jobs row was ever mirrored for
   * this id at all (dispatchTask's own "legacy path survives a dead graph" carve-out — e.g.
   * insertJob rejected the dispatch's ctx as already-terminal, so `graphWriteOk` stayed false and
   * this ran through executeJobFlow() directly, never through reconcile). A job_events row would
   * violate its own FK (job_id references jobs(id)) in that case, and even if it didn't, reconcile
   * has no jobs row to reconcile FOR this id — nothing would ever consume the event and work_items
   * would sit 'in_flow' forever. This is the one remaining raw work_items write in this file.
   *
   * R3 (3자 리뷰 수정 라운드, Codex 재검증): that legacy write used to be `.catch(() => undefined)` —
   * for a job the graph never knew about, THIS write is the only record its outcome will ever get
   * (there is no job_events fallback to fall back on a second time), so swallowing its failure was
   * exactly F1's original bug in a different guise. Same surfacing pattern: console.error + a
   * flow-error publish + false, never silent.
   *
   * Returns whether the outcome is now durably recorded AND (for the graph-backed path) actually
   * applied — callers use this to decide whether their OWN completion event ('flow-finished'/
   * 'flow-error') is safe to publish. When it isn't, THIS function has already surfaced why —
   * console.error + a flow-error publish of its own — never silently.
   */
  const recordJobOutcome = async (workItemId: string, taskId: string, jobGeneration: number, kind: 'succeeded' | 'failed'): Promise<boolean> => {
    const mirrored = ((await sql`select 1 from jobs where id = ${workItemId}`) as unknown[]).length > 0;
    if (!mirrored) {
      try {
        await sql`update work_items set state = ${kind === 'succeeded' ? 'done' : 'blocked'} where id = ${workItemId} and state = 'in_flow'`;
        return true;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`legacy work_items completion write failed (job=${workItemId} kind=${kind}) — this job has no jobs-graph mirror, so there is nothing else to fall back on:`, err);
        flowHub.publish({
          type: 'flow-error',
          workItemId,
          message: `legacy work_items completion write failed — outcome (${kind}) was NOT recorded: ${String(err)}`,
        });
        return false;
      }
    }
    const inserted = await insertJobEventWithRetry(sql, workItemId, jobGeneration, kind);
    if (!inserted.ok) {
      // eslint-disable-next-line no-console
      console.error(`job_events insert failed after retries (job=${workItemId} generation=${jobGeneration} kind=${kind}):`, inserted.error);
      flowHub.publish({
        type: 'flow-error',
        workItemId,
        message: `job_events insert failed after retries — outcome (${kind}) for generation ${jobGeneration} was NOT durably recorded: ${String(inserted.error)}`,
      });
      return false;
    }
    try {
      await reconcileTask(sql, taskId, runRegisteredJob, { leaseTtlMs });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`inline reconcileTask failed after recording job=${workItemId} generation=${jobGeneration} kind=${kind} — the fact is durable, the next controller tick will still consume it:`, err);
    }

    let processed = await isJobEventProcessed(sql, workItemId, jobGeneration, kind);
    for (let attempt = 0; !processed && attempt < 2; attempt++) {
      await new Promise((r) => setTimeout(r, 100));
      await consumeJobEvents(sql, taskId).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`retry consumeJobEvents failed (job=${workItemId} generation=${jobGeneration} kind=${kind}, attempt ${attempt + 1}):`, err);
      });
      processed = await isJobEventProcessed(sql, workItemId, jobGeneration, kind);
    }
    if (!processed) {
      // eslint-disable-next-line no-console
      console.error(`job_events row for job=${workItemId} generation=${jobGeneration} kind=${kind} is durable but still unprocessed after retries — not reporting success; the next controller tick's global sweep will still apply it.`);
      flowHub.publish({
        type: 'flow-error',
        workItemId,
        message: `outcome (${kind}) for generation ${jobGeneration} is durably recorded but not yet applied — the state transition is delayed, not lost; the next controller tick will apply it.`,
      });
      return false;
    }
    return true;
  };

  /**
   * Builds one job's runnable flow-to-completion closure (harness/job-graph.md migration step 8)
   * — a factory (P4-2b), not a plain closure, so the exact same terminal-write/heartbeat contract
   * can be built from TWO different origins: `dispatchTask` below builds one bound to the job it
   * just created itself (jobGeneration always 1 — insertJob's own convention for a brand-new
   * job), and runRegisteredJob (below) builds one bound to a job it had to RECONSTRUCT from the
   * jobs table — a job dispatchTask never touched at all (an A2A-accept or agent job_add job —
   * graph/negotiation.ts's materializeAskTx and the job_add MCP tool both call insertJob(Tx)
   * directly, never dispatchTask) or a dispatchTask job whose in-memory closure was lost to a
   * process restart. That reconstruction path passes the row's REAL `generation`, not a guess —
   * closing 3자 리뷰 수정 E1's `jobGeneration = 1` constant, which was only ever an approximation
   * true for the one caller (dispatchTask) that existed until now; a reconstructed gen>1 job
   * (re-run via bumpJobGeneration, then reclaimed) now records its outcome fact tagged with the
   * generation it actually ran at, instead of one that would never match by construction.
   *
   * Self-contained — catches its OWN errors and records the outcome fact (recordJobOutcome, see
   * its own doc comment above) on failure — because reconcileTask's own dispatch try/catch only
   * marks the jobs-table row 'failed' on a thrown error; if this let an exception escape instead
   * of handling it here, the legacy work_items row would be left stuck at 'in_flow' forever when
   * run through reconcile. Direct-call and reconcile-call must behave identically either way, so
   * all terminal bookkeeping lives here, not in either caller.
   */
  const makeJobFlow = (p: { workItemId: string; projectId: string; request: string; flowType: FlowType; jobGeneration: number; taskId: string }) => async (): Promise<void> => {
    const { workItemId, projectId, request, flowType, jobGeneration, taskId } = p;
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
      // Real mode (deps.executorFor set) builds this job's own executor bound to its repo's
      // cwd; everything else (tests, the paced stub) keeps using the one shared executor.
      const executor = deps.executorFor ? deps.executorFor(await resolveRepoCwd(sql, projectId)) : (deps.executor ?? new PacedStepExecutor());
      // Heartbeat (harness/job-graph.md P2 spec A2): one more wrapper OUTSIDE publishing()'s SSE
      // layer — every step transition also renews this job's claim lease. A stalled/crashed flow
      // simply stops calling setCurrentStep, so its lease lapses on its own; orchestrator.ts
      // itself never learns the graph exists.
      const result = await runFlow(seedWorkflow, {
        store: withLeaseHeartbeat(publishing(store, flowHub, stepHub), sql, workItemId, leaseTtlMs, jobGeneration),
        executor,
        newId,
        request,
        workItemId,
        // Job-graph mirror (harness/job-graph.md migration step 4): the job id mirrors the
        // work_item id one-to-one (commit 3's backfill convention). Since migration step 6
        // (above), the dual-write block already creates this job row up front, so this is now
        // a real live reference rather than an eventually-consistent one.
        jobId: workItemId,
        composeRest,
        // 3자 리뷰 수정 C2 (Grok F4): the heartbeat above only renews at STEP BOUNDARIES
        // (setCurrentStep) — a single step running longer than leaseTtlMs (default 10 min; a
        // real implement/investigate step against the Agent SDK plausibly does) got its lease
        // flagged expired and the job failed by controller.ts's A3 scan, even with a live worker
        // still emitting the whole time. The lease's job is "detect a CRASHED worker", not
        // "detect a slow step" — so every live agent event (tool_use/thinking/assistant, fired
        // well within one step) also renews it. Fire-and-forget: onAgentEvent's own contract is
        // synchronous/void (orchestrator.ts calls it uncaught, unawaited), and renewLease's own
        // `where status = 'running'` guard already makes a stray late renewal harmless.
        onAgentEvent: (stepRunId, event) => {
          stepHub.record(stepRunId, event);
          void renewLease(sql, workItemId, leaseTtlMs, jobGeneration).catch(() => undefined);
        },
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
      // Single-writer round (job-graph.md C1): record the fact, don't write the state — see
      // recordJobOutcome's own doc comment above for why the CAS/generation guard that used to
      // live on this write is gone (there's no longer a write here for a stale report to clobber).
      // F1/F3: only publish 'flow-finished' once the outcome is durably recorded — recordJobOutcome
      // itself already published a flow-error (and logged) when it isn't, so this must not ALSO
      // claim success on top of that.
      const durable = await recordJobOutcome(workItemId, taskId, jobGeneration, result.status === 'completed' ? 'succeeded' : 'failed');
      if (durable) flowHub.publish({ type: 'flow-finished', workItemId, flowId: result.flowId, status: result.status });
    } catch (err) {
      const durable = await recordJobOutcome(workItemId, taskId, jobGeneration, 'failed');
      if (durable) flowHub.publish({ type: 'flow-error', workItemId, message: String(err) });
    }
  };

  const runRegisteredJob = async (job: ReconcileJob): Promise<void> => {
    const exec = jobExecutors.get(job.id);
    if (!exec) {
      // Registry miss (harness/job-graph.md P2 spec B2's origin — P4-2b closes it): no
      // dispatchTask call in THIS process ever registered a closure for this job. Two real
      // sources: (a) an A2A-accept or agent job_add job — neither ever calls dispatchTask, they
      // write straight to the jobs table (graph/negotiation.ts's materializeAskTx, the job_add
      // MCP tool), so NO process, ever, has a registered closure for it; (b) a dispatchTask job
      // whose in-memory closure was lost to THIS process's own restart.
      //
      // Superseded here (3자 리뷰 수정 B1-2a/B2's revert-to-pending-and-wake, and the
      // orphanedOnce ping-pong guard it needed): reverting to pending only ever bought source
      // (a)'s job another claim that would hit this exact same registry miss again, forever —
      // there is no future registration ever coming for a job dispatchTask never created.
      // Reconstructing and actually RUNNING the flow to a terminal state instead means there is
      // no ping-pong left to guard against — the job either finishes or fails, either way it
      // stops being reclaimable, so orphanedOnce's whole reason to exist is gone with it.
      const rows = (await sql`
        select id, repo_id, task_id, title, generation, flow_type from jobs where id = ${job.id} and status = 'running'
      `) as Array<{ id: string; repo_id: string; task_id: string; title: string; generation: number; flow_type: string | null }>;
      const row = rows[0];
      if (!row) return; // the claim this reconcile pass granted already flipped or vanished under us — nothing to run
      // repo mirror (same as dispatchTask's own dual-write below): a provider whose only prior
      // activity was graph-native (no dispatchTask call ever ran its repos insert) may have no
      // repos row yet — resolveRepoCwd would otherwise silently pin this run to '.'.
      await sql`insert into repos (id, product_id, name, cwd) values (${row.repo_id}, 'legacy', ${row.repo_id}, '.') on conflict (id) do nothing`;
      const request = String(row.title ?? row.id);
      // P4-2b 후속 (Fable+Codex 3자 리뷰): dispatchTask now writes its own job's flow_type
      // (below) — that's the human-APPROVED flowType (A2A metadata's carriedFlowType), and it
      // must win here over a fresh re-classify, which can genuinely disagree with what was
      // approved (a different step sequence, an unwanted/missing HITL 'decide' pause). Only
      // falls back to classify(request) when flow_type is null — an A2A-accept/job_add job
      // (insertJobTx never writes one; there was no approved flowType for those to begin with)
      // or a legacy pre-migration row.
      const carriedFlowType = row.flow_type as FlowType | null;
      const flowType = carriedFlowType && (FLOW_TYPES as readonly string[]).includes(carriedFlowType) ? carriedFlowType : new StubFlowClassifier().classify(request);
      const reconstructed = makeJobFlow({
        workItemId: row.id,
        projectId: row.repo_id,
        request,
        flowType,
        // ★ the row's REAL generation, not a guess — closes 3자 리뷰 수정 E1's approximation (it
        // hardcoded 1, true only for dispatchTask's own fresh-job caller). A reconstructed gen>1
        // job (re-run via bumpJobGeneration, then reclaimed) now completes with a CAS write that
        // actually matches its own row instead of losing the race by construction.
        jobGeneration: row.generation,
        taskId: row.task_id,
      });
      void reconstructed().catch(() => undefined); // fire-and-forget — same contract as the registered-closure branch below
      return;
    }
    jobExecutors.delete(job.id);
    // 3자 리뷰 수정 B1-2b (Fable#4+#7): fire-and-forget, not awaited — the flow closure is
    // self-contained (catches its own errors, marks work_items/jobs terminal itself; see
    // makeJobFlow's own comment above), so nothing here depends on it settling. Awaiting it made
    // every caller of this function — including graph/controller.ts's always-on tick(), which
    // single-flights and processes every open task's ready jobs in one sequential pass — block
    // for as long as THIS ONE job's entire flow took, stalling lease-expiry/wake scans and every
    // other task's own reconcile behind it for that whole time.
    void exec().catch(() => undefined);
  };
  // F: the caller's hook for wiring graph/controller.ts's startGraphController to this API
  // instance's own registry-aware dispatch, without createRestApi returning anything but a bare
  // Elysia app (see RestDeps.onReconcileDispatch).
  deps.onReconcileDispatch?.(runRegisteredJob);
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
    // Wake records (harness/job-graph.md P2, graph/wake.ts) are surfaced in the same drawer inbox
    // but block nothing — no flow is suspended waiting on an answer, unlike a real decide-step
    // gate or a meta approval.
    const isWake = dbType === 'agent_wake';
    return {
      id: row.id as string,
      flowId: (row.flow_id as string) ?? '',
      requestingAgent: isMeta ? '메타' : isWake ? '하네스' : 'decide',
      status: row.status as string,
      requestType: isMeta ? 'approval' : dbType,
      question: row.question as string,
      options: opts.map((o) => ({ label: o, value: o })),
      context: meta,
      blocking: !isMeta && !isWake,
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

    // 3자 리뷰 수정 E1 (Fable M1): insertJob (graph/store.ts) always creates a NEW job row at
    // generation=1, and this dispatchTask call is the ONLY thing that ever creates the jobs row
    // for workItemId — so the generation this specific dispatch's flow is running is always
    // exactly this. Passed to makeJobFlow (P4-2b factory, defined above) below, and referenced
    // directly by this function's own outer catch (the graph-write/reconcile IIFE's catch,
    // further down) for the exact same "guard every CAS write against a later generation, not
    // just a later status" reason makeJobFlow's own doc comment explains in full.
    const jobGeneration = 1;

    // Runs this job's flow to completion (harness/job-graph.md migration step 8) — built by
    // makeJobFlow (P4-2b) bound to the job THIS call just created, so it can be handed to
    // reconcileTask as its dispatch callback instead of only ever running inline. Self-contained:
    // catches its own errors and marks both work_items and jobs terminal on failure (see
    // makeJobFlow's own doc comment above for why that bookkeeping has to live there, not here).
    const executeJobFlow = makeJobFlow({ workItemId, projectId, request, flowType, jobGeneration, taskId: ctx });
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
          // step 9) only has to change assembleJobs, not this call site.
          const assembled = assembleJobs({ taskId: ctx, repoId: projectId, workItemId, request });
          // Migration 9: validated against the REAL current jobs/edges (loadTaskGraph), replacing
          // the earlier `[], []` stand-in — a second decomposition landing under a task that
          // already has jobs/deps (cross-repo dispatch, or a future N>1 assembler) is now checked
          // against what's actually there, not an empty placeholder. Inert for today's N=1
          // assembleJobs (it never proposes a dep), so no observable behavior change; it only
          // matters once an assembler can propose edges that might collide with existing ones.
          // GLOBAL, not scoped to `ctx` (3자 리뷰 수정 B1-3): rule 7's cycle check has to see edges
          // from OTHER tasks too — a task-scoped load can't detect a cross-task cycle where the
          // OTHER task is the one holding the pre-existing edge (see load-task-graph.ts).
          const loaded = await loadTaskGraph(sql);
          const validation = validateAssembly(loaded.jobs, loaded.edges, assembled);
          if (!validation.ok) {
            flowHub.publish({ type: 'flow-error', workItemId, message: `graph mirror: invalid assembly: ${validation.reason}` });
          } else {
            for (const job of assembled.jobs) {
              await insertJob(sql, projectId, job);
            }
            graphWriteOk = true;
            // P4-2b 후속 (Fable+Codex 3자 리뷰): persists the human-APPROVED flowType onto the
            // job row itself — best-effort, not folded into insertJob/assembleJobs (both stay
            // flowType-agnostic; N=1 today makes a targeted update the smaller change than
            // threading an optional field through two extra signatures for one caller). A failure
            // here must never undo the graph write that already landed above; it only means a
            // registry-miss reconstruction of THIS job (runRegisteredJob, below) falls back to
            // re-classifying the title instead of reusing the exact approved flowType.
            await sql`update jobs set flow_type = ${flowType} where id = ${workItemId}`.catch(() => undefined);
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
          await reconcileTask(sql, ctx, runRegisteredJob, { leaseTtlMs });
        } else {
          jobExecutors.delete(workItemId); // never reconciled — run it directly instead
          await executeJobFlow();
        }
      } catch (err) {
        jobExecutors.delete(workItemId);
        // recordJobOutcome (single-writer round, job-graph.md C1) — same rationale as
        // executeJobFlow's own catch above; a jobs row for workItemId, if it exists at all at
        // this point, was only ever created by THIS dispatch's own graph write above, at
        // generation 1. F1/F3: only publish once the outcome is durably recorded.
        const durable = await recordJobOutcome(workItemId, ctx, jobGeneration, 'failed');
        if (durable) flowHub.publish({ type: 'flow-error', workItemId, message: String(err) });
      }
    })();
    return workItemId;
  };

  /** A negotiation reply is either a normal JSON-RPC success shape or errorResponse()'s own fixed shape. */
  type NegotiationResponse = Record<string, unknown> | JsonRpcErrorResponse;

  /** Errors materializeAskTx (or the checks around it) can throw that mean "this ask is rejected, decisively" — accept records 'rejected' and returns a graceful JSON-RPC error, never a 500. */
  const isRejectableAskError = (
    err: unknown,
  ): err is WriteAclError | TerminalTaskError | SliceSealedError | DepCycleError | EmptyAskError | JobNotFoundError | WaiterNotWaitingError | DepWaiterTaskMismatchError | DepTargetNotFoundError =>
    err instanceof WriteAclError ||
    err instanceof TerminalTaskError ||
    err instanceof SliceSealedError ||
    err instanceof DepCycleError ||
    err instanceof EmptyAskError ||
    err instanceof JobNotFoundError ||
    err instanceof WaiterNotWaitingError ||
    err instanceof DepWaiterTaskMismatchError ||
    err instanceof DepTargetNotFoundError;

  /**
   * request (kind='request'): records the ask as 'proposed'. Never materializes — accept does.
   * The write itself is insertProposal (graph/negotiation.ts, P4-1 extraction) — shared with the
   * a2a_request agent tool, which calls it directly (no JSON-RPC envelope to unwrap here).
   */
  const requestProposal = async (
    toRepo: string,
    rpcId: string | number | null,
    proposalId: string,
    fromRepo: string | undefined,
    ask: NegotiationAsk | undefined,
  ): Promise<NegotiationResponse> => {
    if (!fromRepo || !ask || !ask.taskId) {
      return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, 'negotiation.fromRepo and ask.taskId are required for a request');
    }
    try {
      // on conflict do nothing (A3: a different messageId with the SAME proposalId+ask is
      // processed again, since the idempotency key is messageId, not proposalId) — re-recording an
      // identical proposal row is a safe no-op, not a duplicate-key crash. (insertProposal's own doc.)
      await insertProposal(sql, { id: proposalId, taskId: ask.taskId, fromRepo, toRepo, kind: 'request', ask });
    } catch (err) {
      if (err instanceof TaskNotOpenError) {
        // D-round task #19 / Fable m1: "task not open" is TRANSIENT, not a permanent verdict (the
        // task may not exist YET, or existed and is terminal — either way, a later retry with the
        // same messageId could legitimately see a different outcome once conditions change). The
        // `data: { transient: true }` marker is what tells the a2a message/send handler NOT to
        // cache this response in a2a_inbox (unlike a deterministic rejection — ACL, rule 9 at
        // accept time, cycle — which always reproduces the same outcome and IS safe to cache).
        return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, err.message, { transient: true });
      }
      if (err instanceof ProposalIdConflictError) {
        return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, err.message);
      }
      throw err;
    }
    return { jsonrpc: '2.0', id: rpcId, result: { kind: 'negotiation', proposalId, status: 'proposed' } };
  };

  /**
   * accept (kind='accept'): materializes the referenced proposal's ask, or rejects it.
   *
   * D-round task #7 (Codex critical rest.ts:526 + Grok F-B1/B2/B3/B5): rewritten as ONE
   * transaction — FOR UPDATE locks the proposal row for the whole call, so nothing else can flip
   * its status out from under this check-then-act. materializeAskTx runs inside a SAVEPOINT: on a
   * rejectable failure, the savepoint rolls back (undoing whatever job/dep/gate writes it made)
   * while the OUTER transaction stays alive to record 'rejected' and commit normally — one
   * transaction, not "materialize commits, then a separate statement flips status" (the old F-B1/
   * F-B3 bug: a crash between those two steps left an orphan materialized job with no accepted
   * proposal, and the unconditional 'rejected' write could clobber a since-accepted status).
   *
   * D-round task #12a (Codex major): ACL (actorRepoId === proposal.to_repo) is now checked BEFORE
   * the alreadyAccepted short-circuit — an unauthorized accept must never be told "yes that
   * succeeded" (even idempotently) just because someone else already accepted it first.
   */
  const acceptProposal = async (actorRepoId: string, rpcId: string | number | null, proposalId: string): Promise<NegotiationResponse> => {
    return sql.begin(async (tx) => {
      const rows = (await tx`select task_id, from_repo, to_repo, ask, status from a2a_proposals where id = ${proposalId} for update`) as Array<{
        task_id: string;
        from_repo: string;
        to_repo: string;
        ask: unknown;
        status: string;
      }>;
      const proposal = rows[0];
      if (!proposal) {
        return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, `proposal ${proposalId} not found`);
      }
      if (actorRepoId !== proposal.to_repo) {
        return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, `${actorRepoId} is not the provider of proposal ${proposalId}`);
      }
      if (proposal.status === 'accepted') {
        // B7: a re-accept of an ALREADY-accepted proposal (different messageId — the same messageId
        // never reaches here, a2a_inbox already sealed it). insertJob has no upsert, so re-running
        // materialize isn't safe; this is the "존재 검사" the spec calls for instead.
        return { jsonrpc: '2.0', id: rpcId, result: { kind: 'negotiation', proposalId, status: 'accepted', alreadyAccepted: true } };
      }
      if (proposal.status !== 'proposed') {
        return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, `proposal ${proposalId} is ${proposal.status}, not acceptable`);
      }
      const ask = parseJson(proposal.ask, {}) as NegotiationAsk;
      try {
        const materialized = await tx.savepoint((sp) => materializeAskTx(sp, actorRepoId, ask, newId));
        // CAS, not an unconditional write: the FOR UPDATE lock held since this call's own SELECT
        // makes a lost CAS structurally impossible here (nothing else can touch `status` inside
        // that lock's lifetime) — kept as belt-and-suspenders, matching every other write path's
        // own `where status = ...` convention rather than trusting the lock alone.
        await tx`update a2a_proposals set status = 'accepted' where id = ${proposalId} and status = 'proposed'`;
        return { jsonrpc: '2.0', id: rpcId, result: { kind: 'negotiation', proposalId, status: 'accepted', ...materialized } };
      } catch (err) {
        if (isRejectableAskError(err)) {
          // The savepoint above already rolled back any partial job/dep/gate writes — this update
          // is the OUTER transaction, still open, recording the decisive rejection and committing.
          await tx`update a2a_proposals set status = 'rejected' where id = ${proposalId} and status = 'proposed'`;
          return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, err.message);
        }
        throw err; // unexpected failure: whole tx rolls back, proposal stays 'proposed' — retryable, not stored in a2a_inbox (A5)
      }
    });
  };

  /**
   * counter (kind='counter'): the original proposal -> 'countered'; a NEW, direction-reversed
   * proposal is recorded (not materialized).
   *
   * D-round task #7 (D2, Grok F-B5): rewritten as ONE transaction, FOR UPDATE on the original
   * proposal + a CAS (`and status = 'proposed'`) on the countered-flip — an accept and a counter
   * racing the same proposal now serialize on the row lock instead of both succeeding.
   * D-round task #19 / Fable m5: two checks now symmetric with request's own — the counter's new
   * ask must target the SAME task as the original (not a smuggled redirect to an unrelated task),
   * and that task must still be open.
   */
  const counterProposal = async (
    requesterRepoId: string,
    rpcId: string | number | null,
    originalProposalId: string,
    ask: NegotiationAsk | undefined,
  ): Promise<NegotiationResponse> => {
    if (!ask || !ask.taskId) {
      return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, 'ask is required for a counter');
    }
    return sql.begin(async (tx) => {
      const rows = (await tx`select task_id, from_repo, to_repo, status from a2a_proposals where id = ${originalProposalId} for update`) as Array<{
        task_id: string;
        from_repo: string;
        to_repo: string;
        status: string;
      }>;
      const original = rows[0];
      if (!original) {
        return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, `proposal ${originalProposalId} not found`);
      }
      if (original.status !== 'proposed') {
        return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, `proposal ${originalProposalId} is ${original.status}, not counterable`);
      }
      // :projectId (URL) is "whoever must decide next" — for a counter, that's the ORIGINAL
      // requester (roles reversed), so the call must land at THEIR endpoint.
      if (requesterRepoId !== original.from_repo) {
        return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, `${requesterRepoId} did not originate proposal ${originalProposalId}`);
      }
      // m5: a counter that redirects to a DIFFERENT task than the one being negotiated would be a
      // smuggled cross-task request riding the counter protocol — reject it symmetrically with how
      // a brand-new request's own ask.taskId is trusted at face value only for ITS OWN task.
      if (ask.taskId !== original.task_id) {
        return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, `counter ask.taskId ${ask.taskId} does not match proposal ${originalProposalId}'s task ${original.task_id}`);
      }
      const taskRows = (await tx`select status from tasks where id = ${ask.taskId}`) as Array<{ status: string }>;
      if (!taskRows[0] || taskRows[0].status !== 'open') {
        return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, `task ${ask.taskId} is not open for negotiation`, { transient: true });
      }
      const counterProposalId = newId();
      const flipped = (await tx`
        update a2a_proposals set status = 'countered' where id = ${originalProposalId} and status = 'proposed' returning id
      `) as unknown[];
      if (flipped.length === 0) {
        // Structurally shouldn't happen (same FOR UPDATE-lock reasoning as accept's CAS) — kept as
        // an explicit guard rather than silently inserting a counter against a proposal that lost
        // the race to (e.g.) a concurrent accept.
        return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, `proposal ${originalProposalId} is ${original.status}, not counterable`);
      }
      await tx`
        insert into a2a_proposals (id, task_id, from_repo, to_repo, kind, ask, status)
        values (${counterProposalId}, ${ask.taskId}, ${original.to_repo}, ${original.from_repo}, 'counter', ${ask}, 'proposed')
      `;
      return { jsonrpc: '2.0', id: rpcId, result: { kind: 'negotiation', proposalId: originalProposalId, status: 'countered', counterProposalId } };
    });
  };

  /**
   * P3 migration 10/11 (harness/job-graph.md), rule 8's negotiation half: routed here INSTEAD of
   * dispatchTask when message.metadata.negotiation is present (F2 — the intent path is untouched,
   * this never creates a work_item). At most one round-trip per the frozen protocol decision — no
   * FSM, a counter is just a direction-reversed new request.
   *
   * fromRepo (judgment call, not among the wire shape's shown fields): the endpoint's URL
   * :projectId only ever identifies the PROVIDER — the recipient for 'request', the acting party
   * for 'accept', and (roles reversed) the ORIGINAL requester for 'counter'. Nothing else in the
   * message identifies the OTHER side of a brand-new request, so 'request' alone carries it
   * explicitly; 'accept'/'counter' both derive it from the already-stored proposal row instead.
   *
   * D-round task #12b (Codex major, carried to P4-2): `fromRepo` on a 'request' is CALLER-SUPPLIED
   * message content, not an authenticated identity — A2A is still loopback/unauthenticated, so
   * nothing here stops a caller from claiming to BE some other repo. It is recorded verbatim
   * (a2a_proposals.from_repo) and later used ONLY as a value to check against — never as a live
   * assertion of "I am this repo right now" the way `providerRepoId` (this handler's OWN
   * :projectId param, at least self-consistent per endpoint) is used for accept/counter's ACL.
   * The real fix is P4-2's session-repo binding (harness/job-graph.md 배선 노트 decision 2's same
   * principle, applied to A2A callers): a repo's identity should come from WHICH endpoint/session
   * made the call, never from a field inside the call's own payload.
   */
  const handleNegotiation = async (
    providerRepoId: string,
    rpcId: string | number | null,
    negotiation: { kind?: unknown; proposalId?: unknown; fromRepo?: unknown; ask?: unknown },
  ): Promise<NegotiationResponse> => {
    const { kind, proposalId } = negotiation;
    if (typeof proposalId !== 'string' || !proposalId) {
      return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, 'negotiation.proposalId is required');
    }
    const fromRepo = typeof negotiation.fromRepo === 'string' ? negotiation.fromRepo : undefined;
    const ask = negotiation.ask as NegotiationAsk | undefined;
    if (kind === 'request') return requestProposal(providerRepoId, rpcId, proposalId, fromRepo, ask);
    if (kind === 'accept') return acceptProposal(providerRepoId, rpcId, proposalId);
    if (kind === 'counter') return counterProposal(providerRepoId, rpcId, proposalId, ask);
    return errorResponse(rpcId, JSON_RPC_ERRORS.INVALID_PARAMS, `unknown negotiation.kind: ${String(kind)}`);
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
    // 단일 기록자 통합 Phase 3 (job-graph.md P4/P5): the P5 autonomy-toggle UI's backend — flips
    // repos.autonomy, which graph/wake-consumer.ts reads fresh on every wake (per repo), so this
    // takes effect on the very next wake for this repo, no restart needed and no effect on any
    // other repo.
    .patch('/api/repos/:id/autonomy', async ({ params, body, set }) => {
      const enabled = typeof body === 'object' && body && 'enabled' in body ? (body as { enabled: unknown }).enabled : undefined;
      if (typeof enabled !== 'boolean') {
        set.status = 400;
        return { error: 'body.enabled must be a boolean' };
      }
      const rows = (await sql`update repos set autonomy = ${enabled} where id = ${params.id} returning id, autonomy`) as Array<{
        id: string;
        autonomy: boolean;
      }>;
      if (!rows[0]) {
        set.status = 404;
        return { error: 'repo not found' };
      }
      return { id: rows[0].id, autonomy: rows[0].autonomy };
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
        const message = (req.params as
          | { message?: { messageId?: string; contextId?: string; parts?: Array<{ kind: string; text?: string }>; metadata?: { flowType?: unknown; negotiation?: Record<string, unknown> } } }
          | undefined)?.message;
        // messageId idempotency (harness/job-graph.md P3 migration 10, rule 8): required, not
        // just conventional — the A2A spec's MessageDto already declares it a mandatory field,
        // and every real caller in this codebase (dispatchViaA2A + every live test) already sends
        // one, so enforcing it here rejects a malformed caller rather than silently degrading to
        // "no idempotency for this message".
        const messageId = message?.messageId;
        if (typeof messageId !== 'string' || !messageId) {
          set.status = 400;
          return errorResponse(req.id ?? null, JSON_RPC_ERRORS.INVALID_PARAMS, 'message.messageId is required');
        }
        // D-round task #10 (Codex critical rest.ts:718 + Grok F-C1): insert-first CLAIM, not
        // check-then-act. The old shape (SELECT for a stored response, THEN run the side effect,
        // THEN INSERT) left a gap between the SELECT and the INSERT that two concurrent requests
        // for the SAME messageId could both walk through — both seeing "nothing stored yet", both
        // running dispatchTask/handleNegotiation, `on conflict do nothing` only ever suppressing
        // the SECOND insert's write, not the second run's side effect. Now the INSERT (a pending
        // sentinel, not the real response) IS the claim — it happens before any side effect, so
        // only the request that wins the insert ever gets to run one.
        const PENDING = { pending: true };
        const claimed = (await sql`
          insert into a2a_inbox (message_id, response) values (${messageId}, ${PENDING})
          on conflict (message_id) do nothing
          returning message_id
        `) as unknown[];
        if (claimed.length === 0) {
          // Lost the claim — someone else already holds this messageId. Two cases, both read from
          // the SAME row so there's nothing further to decide:
          //   - the row holds the REAL final response (a genuine SEQUENTIAL replay, A1/A4: the
          //     first call already finished) -> return it verbatim, same as before.
          //   - the row still holds PENDING (a genuine CONCURRENT duplicate racing the winner,
          //     which hasn't finished yet) -> tell the caller to retry rather than block or
          //     silently re-run the side effect a second time (spec's own judgment call: a short
          //     poll-and-wait was considered and rejected as unneeded complexity for this round).
          const rows = (await sql`select response from a2a_inbox where message_id = ${messageId}`) as Array<{ response: unknown }>;
          const stored = parseJson(rows[0]?.response, PENDING) as Record<string, unknown>;
          if (stored.pending === true) {
            set.status = 409;
            return errorResponse(req.id ?? null, JSON_RPC_ERRORS.INTERNAL_ERROR, `message ${messageId} is already being processed, retry`);
          }
          return { ...stored, id: req.id ?? null };
        }

        // Won the claim — process for real.
        let response: NegotiationResponse;
        try {
          // Negotiation routing (F2): metadata.negotiation present -> the negotiation handler
          // INSTEAD of dispatchTask. The intent path below is otherwise completely untouched (F1).
          const negotiation = message?.metadata?.negotiation;
          if (negotiation && typeof negotiation === 'object') {
            response = await handleNegotiation(params.projectId, req.id ?? null, negotiation);
          } else {
            const intent = message?.parts?.find((p) => p.kind === 'text')?.text ?? '';
            // Trust boundary: only an enum-valid carried flowType is honored; anything else falls back.
            const rawFlow = message?.metadata?.flowType;
            const carried = typeof rawFlow === 'string' && (FLOW_TYPES as readonly string[]).includes(rawFlow) ? (rawFlow as FlowType) : undefined;
            const taskId = dispatchTask(params.projectId, intent, message?.contextId, carried);
            response = { jsonrpc: '2.0', id: req.id ?? null, result: { kind: 'task', id: taskId, status: { state: 'working' } } };
          }
        } catch (err) {
          // A5 preserved: a throw during processing must leave NO row here (delete our own pending
          // claim), so a retry with the same messageId actually gets to process, not permanently
          // wedged behind a claim its own owner never finished.
          await sql`delete from a2a_inbox where message_id = ${messageId}`.catch(() => undefined);
          throw err;
        }
        // D-round task #19 / Fable m1: a TRANSIENT rejection (requestProposal's own "task not
        // open" — see its `data: { transient: true }` marker) must NOT be cached here — the
        // decisive-vs-transient distinction lives at the negotiation layer, this just honors it by
        // deleting the claim instead of storing the response, so a retry once conditions change
        // actually reprocesses instead of forever replaying the same stale rejection.
        const errData = (response as Partial<JsonRpcErrorResponse>).error?.data;
        const transient = !!errData && typeof errData === 'object' && (errData as { transient?: boolean }).transient === true;
        if (transient) {
          await sql`delete from a2a_inbox where message_id = ${messageId}`.catch(() => undefined);
        } else {
          // Plain object, NOT JSON.stringify'd — bun's SQL driver double-encodes a string parameter
          // into a jsonb column as a jsonb STRING SCALAR (see graph/wake.ts's raiseWake for the
          // full story); a plain object binds correctly as a genuine jsonb object.
          await sql`update a2a_inbox set response = ${response} where message_id = ${messageId}`;
        }
        return response;
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
      // D-round task #13 (Codex+Grok major rest.ts:875): the jobs query and the legacyOnly query
      // below used to run as two independent READ COMMITTED statements — each one gets its OWN
      // snapshot, so a mirror-write (dispatchTask's insertJob) landing in the gap BETWEEN them
      // could make a work item vanish from BOTH: the jobs query's snapshot predates the insert (job
      // not visible yet), and the legacyOnly query's snapshot postdates it (its own `not exists
      // (select 1 from jobs ...)` filter now excludes the work_item row too, since the job DOES
      // exist by the time legacyOnly runs) — the row falls through the crack between the two
      // queries' own definitions of "which side owns it". Wrapping both in ONE REPEATABLE READ
      // transaction gives them the SAME snapshot, closing that gap without restructuring either
      // query's shape.
      const { rows, legacyOnly } = await sql.begin('isolation level repeatable read read only', async (tx) => {
        // distinct on (j.id) (3자 리뷰 수정 B2-3, minor 묶음): the OR join below is 1:N the moment
        // more than one flow row ever matches the same job (e.g. a retry/duplicate flow row) —
        // without this, each extra match duplicated that job in the response. Picks the
        // most-recently-created matching flow per job; the outer query re-sorts the deduped set by
        // the job's own created_at for display order (distinct on requires ordering by its own key first).
        const rows = (await tx`
          select * from (
            select distinct on (j.id) j.id, j.repo_id, j.title, j.status, j.task_id, j.created_at, f.id as flow_id, f.flow_type
            from jobs j
            left join flows f on (f.job_id = j.id or f.work_item_id = j.id)
            order by j.id, f.created_at desc nulls last
          ) deduped
          order by created_at desc
        `) as Array<Record<string, unknown>>;
        // 3자 리뷰 수정 B2-1 (Codex major #21): dispatchTask's graph-mirror insertJob can reject
        // (e.g. rule 9 — the dispatch's contextId names an already-terminal task) while the LEGACY
        // work_items/flows write still proceeds via the direct-run fallback (see dispatchTask). That
        // work item then has NO jobs row at all, so the query above can never find it — it would
        // silently vanish from the FE despite having actually run. Mapped with the exact PRE-migration-5
        // DTO shape (dcb9ac4~1) — that was the last shape describing a work_items row on its own,
        // with no jobs-table concept to borrow from.
        // Same distinct-on dedup as the jobs query above — a legacy work_item with more than one
        // matching flow row (e.g. a pre-graph retry) must not duplicate in the response either.
        const legacyOnly = (await tx`
          select * from (
            select distinct on (w.id) w.id, w.project_id, w.type, w.state, w.title, w.context_id, w.created_at, f.id as active_flow_id
            from work_items w
            left join flows f on f.work_item_id = w.id
            where not exists (select 1 from jobs j where j.id = w.id or j.legacy_work_item_id = w.id)
            order by w.id, f.created_at desc nulls last
          ) deduped
          order by created_at desc
        `) as Array<Record<string, unknown>>;
        return { rows, legacyOnly };
      });
      // cancelled -> 'blocked' (not a distinct FE state): kept as-is (3자 리뷰 수정 B2-3, minor
      // 묶음, judgment call) — the WorkItemDto contract only ever had in_flow/done/blocked, and a
      // cancelled job is unambiguously "not done", same bucket a failed one already renders in.
      // Distinguishing cancelled from failed in the FE would need a new DTO state, out of scope here.
      const jobStateToWorkItemState = (status: string): string =>
        status === 'done' ? 'done' : status === 'failed' || status === 'cancelled' ? 'blocked' : 'in_flow';
      const fromJobs = rows.map((j) => {
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

      const fromLegacy = legacyOnly.map((w) => {
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

      return [...fromJobs, ...fromLegacy].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
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
    // external_gates firing (harness/job-graph.md P3 migration 10, spec D): webhook/human/cron all
    // land here — the one write path that flips a gate pending -> fired. Idempotent: firing an
    // already-fired gate is a 200 no-op (the real-world event it represents may itself be
    // redelivered), not an error. This does NOT touch job/task status itself (D6) — it only writes
    // the gate; reconcileTask (graph/reconcile.ts) is what derives a waiting job's readiness from
    // the fired gate on its next pass, same as any other dep target.
    .post('/api/gates/:id/fire', async ({ params, set }) => {
      const fired = (await sql`update external_gates set status = 'fired' where id = ${params.id} and status = 'pending' returning id`) as Array<{ id: string }>;
      if (fired.length > 0) return { id: params.id, status: 'fired' };
      const rows = (await sql`select status from external_gates where id = ${params.id}`) as Array<{ status: string }>;
      if (!rows[0]) {
        set.status = 404;
        return { error: 'gate not found' };
      }
      return { id: params.id, status: rows[0].status }; // already fired — idempotent no-op
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
