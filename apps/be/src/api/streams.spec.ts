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
});
