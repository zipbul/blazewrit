import type { MessageDto, TaskDto, A2AStreamEvent } from '@bw/dto';
import type { TaskRunner } from '../methods/message-send';
import type { StreamRunner } from '../methods/message-stream';
import type { TaskStore } from './task-store';

/** Injected id source (UUIDs in production) so task/context ids are testable. */
export type IdGen = () => string;

/**
 * TEMPORARY runner: drives a Task submitted -> working -> completed and persists it.
 * Replaced by Triage -> orchestrator. Shape-faithful so the transport is exercisable now.
 */
export class StubTaskRunner implements TaskRunner, StreamRunner {
  constructor(
    private readonly store: TaskStore,
    private readonly newId: IdGen,
  ) {}

  run(message: MessageDto): TaskDto {
    const { id, contextId } = this.identity(message);
    this.store.save({ kind: 'task', id, contextId, status: { state: 'submitted' } });
    const completed: TaskDto = { kind: 'task', id, contextId, status: { state: 'completed' } };
    this.store.save(completed);
    return completed;
  }

  async *stream(message: MessageDto): AsyncIterable<A2AStreamEvent> {
    const { id, contextId } = this.identity(message);
    this.store.save({ kind: 'task', id, contextId, status: { state: 'submitted' } });
    yield { kind: 'status-update', taskId: id, contextId, status: { state: 'working' }, final: false };
    this.store.save({ kind: 'task', id, contextId, status: { state: 'completed' } });
    yield { kind: 'status-update', taskId: id, contextId, status: { state: 'completed' }, final: true };
  }

  private identity(message: MessageDto): { id: string; contextId: string } {
    return { id: this.newId(), contextId: message.contextId ?? this.newId() };
  }
}
