import { describe, expect, it } from 'bun:test';
import { ScopeQueue } from './scope-queue';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ScopeQueue (per-scope turn serialization)', () => {
  it('serializes tasks within one scope — a slow first turn blocks the second', async () => {
    const q = new ScopeQueue();
    const order: string[] = [];
    const p1 = q.run('a', async () => {
      await sleep(30);
      order.push('a1');
    });
    const p2 = q.run('a', async () => {
      order.push('a2');
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual(['a1', 'a2']);
  });

  it('does NOT block across scopes', async () => {
    const q = new ScopeQueue();
    const order: string[] = [];
    const pa = q.run('a', async () => {
      await sleep(30);
      order.push('a');
    });
    const pb = q.run('b', async () => {
      order.push('b');
    });
    await Promise.all([pa, pb]);
    expect(order).toEqual(['b', 'a']);
  });

  it('keeps serving a scope after a task throws', async () => {
    const q = new ScopeQueue();
    await expect(q.run('a', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const v = await q.run('a', async () => 42);
    expect(v).toBe(42);
  });

  it('returns the task value', async () => {
    const q = new ScopeQueue();
    expect(await q.run('a', async () => 'ok')).toBe('ok');
  });
});
