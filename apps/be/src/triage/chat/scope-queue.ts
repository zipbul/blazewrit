/**
 * Per-scope promise queue: turns within one conversation scope run strictly in order
 * (a rapid double-send cannot interleave as user1,user2,agent2,agent1), while different
 * scopes stay concurrent. In-process only — assumes a SINGLE Bun process (true today);
 * a second instance would need a DB-level lock instead.
 */
export class ScopeQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(scope: string, task: () => Promise<T>): Promise<T> {
    const tail = this.tails.get(scope) ?? Promise.resolve();
    const next = tail.then(task, task); // a failed predecessor must not poison the queue
    // Keep the chain alive regardless of this task's outcome.
    this.tails.set(scope, next.catch(() => undefined));
    return next;
  }
}
