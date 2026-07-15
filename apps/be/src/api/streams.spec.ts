import { describe, expect, it } from 'bun:test';
import { FlowHub, StepStreamHub } from './streams';

describe('FlowHub', () => {
  it('fans an event out to every subscriber as an SSE line, and unsubscribes cleanly', () => {
    const hub = new FlowHub();
    const a: string[] = [];
    const b: string[] = [];
    const offA = hub.subscribe((l) => a.push(l));
    hub.subscribe((l) => b.push(l));
    hub.publish({ type: 'x' });
    offA();
    hub.publish({ type: 'y' });
    expect(a).toEqual(['data: {"type":"x"}\n\n']);
    expect(b.length).toBe(2);
  });

  // A3 (3자 리뷰 수정 A라운드): a subscriber's own failure (e.g. enqueueing to an already-closed
  // SSE controller) must not propagate back into the write path that called publish() — that
  // write path is often mid-completion-dual-write in rest.ts, and an escaping exception there
  // flips a SUCCESSFUL flow into its catch block, clobbering done→failed for a reason that has
  // nothing to do with the flow itself.
  it('isolates a throwing subscriber — publish does not throw, and other subscribers still receive the event', () => {
    const hub = new FlowHub();
    const received: string[] = [];
    hub.subscribe(() => {
      throw new Error('boom');
    });
    hub.subscribe((l) => received.push(l));

    expect(() => hub.publish({ type: 'x' })).not.toThrow();
    expect(received).toEqual(['data: {"type":"x"}\n\n']);
  });
});

describe('StepStreamHub', () => {
  it('replays the buffer to a late subscriber, then streams live', () => {
    const hub = new StepStreamHub();
    hub.record('s1', { type: 'assistant', payload: { text: '먼저' } });
    const seen: string[] = [];
    hub.subscribe('s1', (e) => seen.push(String((e.payload as { text: string }).text)), () => seen.push('DONE'));
    hub.record('s1', { type: 'assistant', payload: { text: '나중' } });
    expect(seen).toEqual(['먼저', '나중']);
  });

  it('signals done to live subscribers and immediately to post-finish subscribers', () => {
    const hub = new StepStreamHub();
    const seen: string[] = [];
    hub.subscribe('s2', () => {}, () => seen.push('live-done'));
    hub.finish('s2');
    hub.subscribe('s2', () => {}, () => seen.push('late-done'));
    expect(seen).toEqual(['live-done', 'late-done']);
  });

  it('assigns monotonically increasing seq per stream', () => {
    const hub = new StepStreamHub();
    const seqs: number[] = [];
    hub.subscribe('s3', (e) => seqs.push(e.seq as number), () => {});
    hub.record('s3', { type: 'tool_use', payload: {} });
    hub.record('s3', { type: 'tool_use', payload: {} });
    expect(seqs).toEqual([1, 2]);
  });

  // A3 (3자 리뷰 수정 A라운드): same isolation as FlowHub — one subscriber's throw must not stop
  // record()/finish() from reaching the rest of the subscribers, or propagate to the caller.
  it('record() isolates a throwing onEvent subscriber — other subscribers still receive the event', () => {
    const hub = new StepStreamHub();
    const received: unknown[] = [];
    hub.subscribe(
      's4',
      () => {
        throw new Error('boom');
      },
      () => {},
    );
    hub.subscribe(
      's4',
      (dto) => received.push(dto),
      () => {},
    );

    expect(() => hub.record('s4', { type: 'assistant', payload: {} })).not.toThrow();
    expect(received).toHaveLength(1);
  });

  it('finish() isolates a throwing onDone subscriber — other subscribers still get done', () => {
    const hub = new StepStreamHub();
    let otherDone = false;
    hub.subscribe(
      's5',
      () => {},
      () => {
        throw new Error('boom');
      },
    );
    hub.subscribe(
      's5',
      () => {},
      () => {
        otherDone = true;
      },
    );

    expect(() => hub.finish('s5')).not.toThrow();
    expect(otherDone).toBe(true);
  });
});
