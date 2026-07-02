import { Injectable, computed, inject, signal } from '@angular/core';
import { BlazewritApi, type ChatTurnVm, type IntentVm, type TableVm } from './api';
import { WorkspaceStore } from './workspace-store';
import { UiState } from './ui-state';

/** One message in a dock chat thread (server-hydrated; optimistic user echo while sending). */
export interface ChatMsg {
  readonly role: 'user' | 'agent' | 'summary';
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
 * Conversation state for the bottom chat dock. The SERVER is the source of truth
 * (chat_messages via GET /api/chat/:scope); this store hydrates per thread, echoes the
 * user's message optimistically while a turn runs, and re-hydrates after actions so
 * server-side confirmation turns appear. Dock layout state lives in ChatDock (SRP).
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

  /** Per-thread hydrated history + the latest proposed intent + the request it came from. */
  private readonly msgs = signal<Record<string, ChatMsg[]>>({});
  private readonly hydrated = new Set<string>();
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

  constructor() {
    this.hydrate('central');
  }

  setActive(id: string): void {
    this.activeId.set(id);
    this.chatError.set(null);
    if (!this.hydrated.has(id)) this.hydrate(id);
  }

  /** Load the persisted history of a thread (server truth). */
  hydrate(scope: string): void {
    this.hydrated.add(scope);
    this.api.chatHistory(scope).subscribe({
      next: (turns) => this.msgs.update((s) => ({ ...s, [scope]: turns.map(toMsg) })),
      error: () => this.hydrated.delete(scope), // retry on next activation
    });
  }

  /** Send to the active thread: optimistic echo, then replace with the agent turn. */
  send(text: string): void {
    const body = text.trim();
    if (!body || this.thinking()) return;
    const scope = this.activeId();
    const clientMsgId = crypto.randomUUID();
    this.pushMsg(scope, { role: 'user', text: body });
    this.setIntent(scope, null);
    this.requests.update((r) => ({ ...r, [scope]: body }));
    this.thinking.set(true);
    this.chatError.set(null);
    this.api.triage(body, scope, clientMsgId).subscribe({
      next: ({ reply, intent, view }) => {
        this.pushMsg(scope, { role: 'agent', text: reply, ...(view ? { table: view } : {}) });
        this.setIntent(scope, intent);
        this.thinking.set(false);
      },
      error: (err) => {
        this.chatError.set(this.errText(err, '응답에 실패했습니다'));
        this.thinking.set(false);
      },
    });
  }

  /** Approve the proposed intent: dispatch, then re-hydrate so the server confirmation turn shows. */
  proceed(): void {
    const scope = this.activeId();
    const i = this.intents()[scope];
    const request = this.requests()[scope];
    if (!i || !request || this.dispatching()) return;
    this.dispatching.set(true);
    this.chatError.set(null);
    const opts =
      i.isNewProject || !i.targetProject
        ? { newProjectName: i.suggestedProjectName ?? request.slice(0, 24) }
        : { targetProject: i.targetProject };
    this.api.dispatch(request, opts, scope).subscribe({
      next: () => {
        this.afterAct(scope);
        this.workspace.reload();
      },
      error: (err) => {
        this.chatError.set(this.errText(err, '실행에 실패했습니다'));
        this.dispatching.set(false);
      },
    });
  }

  /** Ambiguous intent: register 똘이's question in the drawer inbox (answering re-triages). */
  askClarification(): void {
    const scope = this.activeId();
    const i = this.intents()[scope];
    const request = this.requests()[scope];
    if (!i?.clarifyingQuestion || !request || this.dispatching()) return;
    this.dispatching.set(true);
    this.chatError.set(null);
    this.api.clarify(request, i.clarifyingQuestion, i.clarifyOptions ?? [], scope).subscribe({
      next: () => {
        this.afterAct(scope);
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

  /** After an action, the confirmation turn was written SERVER-side — pull the truth. */
  private afterAct(scope: string): void {
    this.dispatching.set(false);
    this.setIntent(scope, null);
    this.hydrate(scope);
  }

  private pushMsg(scope: string, m: ChatMsg): void {
    this.msgs.update((s) => ({ ...s, [scope]: [...(s[scope] ?? []), m] }));
  }
  private setIntent(scope: string, i: IntentVm | null): void {
    this.intents.update((s) => ({ ...s, [scope]: i }));
  }
  private errText(err: unknown, fallback: string): string {
    const e = err as { error?: { error?: unknown } };
    return typeof e?.error?.error === 'string' ? e.error.error : fallback;
  }
}

function toMsg(t: ChatTurnVm): ChatMsg {
  const view = t.payload?.view ?? undefined;
  return { role: t.role, text: t.text, ...(view ? { table: view } : {}) };
}
