import type { SQL } from 'bun';
import { recordTurn } from '../triage/chat/turns';

/** What the proposal services need from their host (routes own the hubs/id source). */
export interface ProposalDeps {
  sql: SQL;
  newId: () => string;
  /** Publishes a flow event to the UI SSE stream (decision-open etc.). */
  publish: (event: object) => void;
}

/**
 * Meta-agent proposal services — the agent-proposes / user-approves side of the platform:
 * registering a project, wiring two projects, opening a clarification question. Each opens a
 * decision in the drawer inbox; conversational surfaces also land a turn in chat memory.
 */
export function createProposals({ sql, newId, publish }: ProposalDeps) {
  /** Register a project as 'proposed' and open its approval decision. */
  const proposeNewProject = async (projectId: string, request: string) => {
    await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, ${'proposed'}) on conflict (id) do nothing`;
    const decId = newId();
    // Plain object, NOT JSON.stringify'd — bun's SQL driver double-encodes a string param into a
    // jsonb column (see graph/wake.ts's raiseWake for the full story); a plain object binds correctly.
    const meta = { kind: 'project_registration', projectId, request };
    await sql`insert into decisions (id, status, request_type, question, options, meta) values (${decId}, ${'open'}, ${'project_registration'}, ${`새 프로젝트 «${projectId}»를 등록할까요?`}, ${'[]'}, ${meta})`;
    publish({ type: 'decision-open', id: decId, project: projectId });
    return { accepted: true, pendingRegistration: true, projectId };
  };

  /** Propose wiring a newly-registered project to the most recent active sibling. */
  const proposeConnection = async (newProjectId: string): Promise<void> => {
    const others = (await sql`
      select id from projects where status = 'active' and id <> ${newProjectId} order by created_at desc limit 1
    `) as Array<Record<string, unknown>>;
    const target = others[0]?.id as string | undefined;
    if (!target) return;
    const relId = newId();
    await sql`insert into relationships (id, from_project, to_project, type, status) values (${relId}, ${newProjectId}, ${target}, ${'depends'}, ${'proposed'})`;
    const decId = newId();
    // Plain object, not JSON.stringify'd (jsonb double-encoding — see graph/wake.ts's raiseWake).
    const meta = { kind: 'connection', relationshipId: relId, from: newProjectId, to: target };
    await sql`insert into decisions (id, status, request_type, question, options, meta) values (${decId}, ${'open'}, ${'connection'}, ${`«${newProjectId}» → «${target}» 두 프로젝트를 연결할까요?`}, ${'[]'}, ${meta})`;
    publish({ type: 'decision-open', id: decId });
  };

  /** Open a free-text clarification question in the drawer inbox (the graceful tail for ambiguous intent). */
  const openClarification = async (request: string, question: string, options: string[] = [], scope = 'central'): Promise<string> => {
    const decId = newId();
    // Plain object/array, not JSON.stringify'd (jsonb double-encoding — see graph/wake.ts's raiseWake).
    const meta = { kind: 'clarification', request, scope };
    // free_text → drawer always shows a text box; stored options add clickable choices alongside it.
    await sql`insert into decisions (id, status, request_type, question, options, meta) values (${decId}, ${'open'}, ${'free_text'}, ${question}, ${options}, ${meta})`;
    // The question is a conversational turn — memory must include it (no turn bypasses chat_messages).
    await recordTurn(sql, { scope, role: 'agent', text: `❓ ${question} (질문함에 등록됨)` });
    publish({ type: 'decision-open', id: decId });
    return decId;
  };

  return { proposeNewProject, proposeConnection, openClarification };
}
