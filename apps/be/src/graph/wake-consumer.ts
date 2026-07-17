import type { SQL } from 'bun';
import type { WakeInput } from './wake';
import { runWakeSession } from './wake-session';
import { resolveRepoCwd } from '../api/rest';
import type { QueryFn } from '../orchestrator/infra/agent-step-executor';

export interface WakeConsumerDeps {
  sql: SQL;
  /** Forwarded into every runWakeSession call — the real SDK `query` in serve.ts, a fake in tests. */
  queryFn: QueryFn;
  newId: () => string;
  /** Autonomy gate (harness/job-graph.md P4: "에이전트 wake 배선" — the toggle UI itself is P5).
   * Read fresh on every wake, not captured once at wiring time, so a future P5 UI can flip it live
   * without restarting the process. Defaults to OFF in serve.ts — this round only wires the pipe,
   * it does not turn autonomous wakes on. */
  autonomyEnabled: () => boolean;
  /** Test injection point; defaults to the real runWakeSession (P4-2a). */
  runWake?: typeof runWakeSession;
  /** Test injection point; defaults to the real resolveRepoCwd (api/rest.ts). */
  resolveCwd?: typeof resolveRepoCwd;
}

/**
 * Builds the controller's `onWake` handler (graph/controller.ts's `opts.onWake`) — the P4-2c wiring
 * from a raised wake record (spec E2: dedup-suppressed repeats never reach here) to an actual
 * runWakeSession (P4-2a) kickoff. serve.ts is a process entry point and can't be unit-tested
 * directly, so this factory is the seam: it takes its collaborators as deps and returns the bare
 * `(w: WakeInput) => void` shape controller.ts already calls.
 *
 * Scope this round (job-graph.md:175-176 — P4 = wake 배선/이유전달, 자율모드 토글 UI = P5):
 *  - Gate default OFF: with autonomyEnabled() false (serve.ts's BW_AUTONOMY!=='1' default), every
 *    wake is a pure no-op here — the human drawer inbox (raiseWake's own decisions row) stays the
 *    ONLY consumer, exactly as before this round. Characterization, not a new feature, until a
 *    project flips the gate on.
 *  - Job-level only: a wake with no jobId (unresolvable_task, spec C2) has no unambiguous repo to
 *    act as — a task can span multiple repos' jobs, so picking one would be a guess. Left for P5,
 *    once there's an actual per-project/per-repo selection surface to decide with.
 *  - Wake record lifetime: raiseWake's decisions row is never touched here even when a session
 *    fires for it — no decisionId flows through WakeInput, and once the underlying condition
 *    clears, controller.ts's own dedup (raiseWake, spec E2) simply stops re-raising it; nothing
 *    marks it 'answered'. Explicit lifecycle management (and the toggle UI to go with it) is P5.
 */
export function makeWakeConsumer(deps: WakeConsumerDeps): (w: WakeInput) => void {
  // Closure-scoped per makeWakeConsumer call (one real instance per process, from serve.ts) — a
  // synchronous Set so the coalesce check below is race-free against the async lookup it guards.
  const active = new Set<string>();

  return (w: WakeInput): void => {
    if (!deps.autonomyEnabled()) return; // gate OFF (default): no-op, human inbox unaffected

    const key = w.jobId ?? w.taskId;
    if (active.has(key)) return; // coalesce: an in-flight session for this key already owns it
    active.add(key); // synchronous add closes the window before the async lookup below even starts

    if (!w.jobId) {
      // Task-level wake (unresolvable_task): no single repo to act as. P5.
      active.delete(key);
      return;
    }
    const jobId = w.jobId;

    // Fire-and-forget: runWakeSession is already self-contained (never rethrows), but the repo
    // lookup/cwd resolution in front of it is this module's own code, so it gets the same
    // try/catch/finally guarantee — nothing here may ever throw back into controller.ts's tick().
    void (async () => {
      try {
        const rows = (await deps.sql`select repo_id from jobs where id = ${jobId}`) as Array<{ repo_id: string }>;
        const repoId = rows[0]?.repo_id;
        if (!repoId) return; // job vanished/never existed by the time this ran — nothing to act as
        const cwd = await (deps.resolveCwd ?? resolveRepoCwd)(deps.sql, repoId);
        await (deps.runWake ?? runWakeSession)({
          sql: deps.sql,
          actorRepoId: repoId,
          taskId: w.taskId,
          reason: w.reason,
          cwd,
          newId: deps.newId,
          queryFn: deps.queryFn,
        });
      } catch (e) {
        console.error(`wake consumer(job=${jobId}) failed: ${String(e)}`);
      } finally {
        active.delete(key);
      }
    })();
  };
}
