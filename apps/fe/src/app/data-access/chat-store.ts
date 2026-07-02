import { Injectable, computed, inject, signal } from '@angular/core';
import { BlazewritApi, type IntentVm, type TableVm } from './api';
import { WorkspaceStore } from './workspace-store';
import { UiState } from './ui-state';

/** One message in a dock chat thread. */
export interface ChatMsg {
  readonly role: 'me' | 'agent';
  readonly text: string;
  /** Declarative table the agent rendered with this message (show_table). */
  readonly table?: TableVm;
}

/** A dock conversation: 똘이(central) or one per in-flow work item. */
export interface Thread {
  readonly id: string;
  readonly label: string;
  readonly kind: 'central' | 'task';
  readonly project?: string;
}

const CENTRAL: Thread = { id: 'central', label: '똘이', kind: 'central' };
const MAX_TASK_TABS = 8;

/**
 * Conversation state for the bottom chat dock (SRP: domain/chat state only — dock layout
 * state like open/height lives in the ChatDock component). Threads = 똘이 + one per
 * in-flow work item; each thread keeps its own history, proposed intent, and last request.
 */
@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly api = inject(BlazewritApi);
  private readonly workspace = inject(WorkspaceStore);
  private readonly ui = inject(UiState);

  readonly activeId = signal<string>('central');
  readonly thinking = signal(false);
  readonly chatError = signal<string | null>(null);
  readonly dispatching = signal(false);

  /** Per-thread message history, proposed intent, and the request the intent was derived from. */
  private readonly msgs = signal<Record<string, ChatMsg[]>>({ central: [] });
  private readonly intents = signal<Record<string, IntentVm | null>>({});
  private readonly requests = signal<Record<string, string>>({});

  readonly threads = computed<Thread[]>(() => {
    const tasks = this.workspace
      .workItems()
      .filter((w) => w.state === 'in_flow')
      .slice(0, MAX_TASK_TABS)
      .map<Thread>((w) => ({ id: w.id, label: w.title, kind: 'task', project: w.projectId }));
    return [CENTRAL, ...tasks];
  });
  readonly active = computed<Thread>(
    () => this.threads().find((t) => t.id === this.activeId()) ?? CENTRAL,
  );
  readonly activeMsgs = computed<ChatMsg[]>(() => this.msgs()[this.activeId()] ?? []);
  readonly activeIntent = computed<IntentVm | null>(() => this.intents()[this.activeId()] ?? null);

  setActive(id: string): void {
    this.activeId.set(id);
    this.chatError.set(null);
  }

  /** Send to the active thread. Task threads scope the message to that work item for 똘이. */
  send(text: string): void {
    const body = text.trim();
    if (!body || this.thinking()) return;
    const id = this.activeId();
    const t = this.active();
    const request = t.kind === 'task' ? `[작업: ${t.label}] ${body}` : body;
    this.pushMsg(id, { role: 'me', text: body });
    this.setIntent(id, null);
    this.requests.update((r) => ({ ...r, [id]: request }));
    this.thinking.set(true);
    this.chatError.set(null);
    this.api.triage(request).subscribe({
      next: ({ reply, intent, view }) => {
        this.pushMsg(id, { role: 'agent', text: reply, ...(view ? { table: view } : {}) });
        this.setIntent(id, intent);
        this.thinking.set(false);
      },
      error: (err) => {
        this.chatError.set(this.errText(err, '응답에 실패했습니다'));
        this.thinking.set(false);
      },
    });
  }

  /** Approve the proposed intent: dispatch to the resolved project, or propose a new one. */
  proceed(): void {
    const id = this.activeId();
    const i = this.intents()[id];
    const request = this.requests()[id];
    if (!i || !request || this.dispatching()) return;
    this.dispatching.set(true);
    this.chatError.set(null);
    const opts =
      i.isNewProject || !i.targetProject
        ? { newProjectName: i.suggestedProjectName ?? request.slice(0, 24) }
        : { targetProject: i.targetProject };
    this.api.dispatch(request, opts).subscribe({
      next: () => {
        this.afterAct(id, '✓ 실행했습니다.');
        this.workspace.reload();
      },
      error: (err) => {
        this.chatError.set(this.errText(err, '실행에 실패했습니다'));
        this.dispatching.set(false);
      },
    });
  }

  /** Ambiguous intent: send 똘이's question to the drawer inbox (answering it re-triages + routes). */
  askClarification(): void {
    const id = this.activeId();
    const i = this.intents()[id];
    const request = this.requests()[id];
    if (!i?.clarifyingQuestion || !request || this.dispatching()) return;
    this.dispatching.set(true);
    this.chatError.set(null);
    this.api.clarify(request, i.clarifyingQuestion, i.clarifyOptions ?? []).subscribe({
      next: () => {
        this.afterAct(id, '❓ 질문함에 등록했습니다.');
        this.workspace.reload();
        this.ui.openQuestions();
      },
      error: (err) => {
        this.chatError.set(this.errText(err, '질문 등록에 실패했습니다'));
        this.dispatching.set(false);
      },
    });
  }

  clearIntent(): void {
    this.setIntent(this.activeId(), null);
  }

  private afterAct(id: string, note: string): void {
    this.dispatching.set(false);
    this.setIntent(id, null);
    this.pushMsg(id, { role: 'agent', text: note });
  }

  private pushMsg(id: string, m: ChatMsg): void {
    this.msgs.update((s) => ({ ...s, [id]: [...(s[id] ?? []), m] }));
  }
  private setIntent(id: string, i: IntentVm | null): void {
    this.intents.update((s) => ({ ...s, [id]: i }));
  }
  private errText(err: unknown, fallback: string): string {
    const e = err as { error?: { error?: unknown } };
    return typeof e?.error?.error === 'string' ? e.error.error : fallback;
  }
}
