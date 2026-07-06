import type { TaskDto } from '@bw/dto';

/** Task persistence port. The real impl is Postgres; in-memory is a temporary stand-in. */
export interface TaskStore {
  get(id: string): TaskDto | undefined;
  save(task: TaskDto): void;
}

/** TEMPORARY in-memory Task store — replaced by the db package. */
export class InMemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, TaskDto>();

  get(id: string): TaskDto | undefined {
    return this.tasks.get(id);
  }

  save(task: TaskDto): void {
    this.tasks.set(task.id, task);
  }
}
