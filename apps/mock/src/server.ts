/**
 * Temporary mock of the zipbul backend for front-end development.
 * REST snapshots + an SSE endpoint that replays a recorded agent-event stream,
 * so the live UI runs against realistic data before zipbul exists. Swap the FE
 * base URL to the real backend when ready (DECISIONS §13). Discard once zipbul lands.
 *
 * Plain Bun.serve (no zipbul framework dependency) — this is throwaway scaffolding.
 * Fixtures are validated against @bw/dto on startup so they cannot drift from the
 * shared contract the real backend will also implement (DECISIONS §13).
 */
import { seal, deserialize, isBakerIssueSet } from '@zipbul/baker';
import { WorkItemDto, FlowDto, StepRunDto, AgentEventDto, DecisionRequestDto } from '@bw/dto';
import projects from '../fixtures/projects.json' with { type: 'json' };
import workItems from '../fixtures/work-items.json' with { type: 'json' };
import flows from '../fixtures/flows.json' with { type: 'json' };
import stepRuns from '../fixtures/step-runs.json' with { type: 'json' };
import streamSr6 from '../fixtures/stream-sr6.json' with { type: 'json' };
import decisionsFixture from '../fixtures/decisions.json' with { type: 'json' };
import connections from '../fixtures/connections.json' with { type: 'json' };

const PORT = Number(process.env['MOCK_PORT'] ?? 4500);

// Mutable copy so the answer endpoint can update decision state in-memory.
// Derived from the contract (not restated) so it cannot drift from DecisionRequestDto.
type MutableDecision = { -readonly [K in keyof DecisionRequestDto]: DecisionRequestDto[K] };
const decisions: MutableDecision[] = decisionsFixture.map((d) => ({ ...d }) as MutableDecision);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** Fail fast if any fixture violates the shared DTO contract. */
async function assertFixtures(): Promise<void> {
  seal();
  const checks: Array<readonly [string, unknown[], (v: unknown) => unknown]> = [
    ['work-items', workItems, (v) => deserialize(WorkItemDto, v)],
    ['flows', flows, (v) => deserialize(FlowDto, v)],
    ['step-runs', stepRuns, (v) => deserialize(StepRunDto, v)],
    ['stream-sr6', streamSr6, (v) => deserialize(AgentEventDto, v)],
    ['decisions', decisionsFixture, (v) => deserialize(DecisionRequestDto, v)],
  ];
  for (const [name, rows, check] of checks) {
    for (const [i, row] of rows.entries()) {
      const r = await check(row);
      if (isBakerIssueSet(r)) {
        throw new Error(`[mock] fixture ${name}[${i}] violates DTO: ${JSON.stringify(r.errors)}`);
      }
    }
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/** Replays recorded agent events as SSE (~900ms apart), then closes the stream. */
function sseReplay(events: ReadonlyArray<unknown>): Response {
  let i = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const push = () => {
        if (i >= events.length) {
          clearInterval(timer);
          controller.enqueue(enc.encode(`event: done\ndata: {}\n\n`));
          controller.close();
          return;
        }
        controller.enqueue(enc.encode(`event: agent-event\ndata: ${JSON.stringify(events[i])}\n\n`));
        i++;
      };
      push();
      timer = setInterval(push, 900);
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...CORS,
    },
  });
}

await assertFixtures();

const server = Bun.serve({
  port: PORT,
  routes: {
    '/api/projects': { GET: () => json(projects), OPTIONS: preflight },
    '/api/work-items': { GET: () => json(workItems), OPTIONS: preflight },
    '/api/flows': { GET: () => json(flows), OPTIONS: preflight },
    '/api/flows/:flowId/step-runs': {
      GET: (req) => json(stepRuns.filter((s) => s.flowId === req.params.flowId)),
      OPTIONS: preflight,
    },
    // SSE: live agent output stream for a step run (mirrors A2A TaskArtifactUpdateEvent → bz → SSE).
    // Always responds as an event stream; unknown ids replay an empty stream that closes immediately.
    '/api/step-runs/:stepRunId/stream': {
      GET: (req) => sseReplay(req.params.stepRunId === 'sr6' ? streamSr6 : []),
      OPTIONS: preflight,
    },
    // HITL decision inbox (DECISIONS §10).
    '/api/decisions': { GET: () => json(decisions), OPTIONS: preflight },
    '/api/decisions/:id/answer': {
      OPTIONS: preflight,
      POST: async (req) => {
        const decision = decisions.find((d) => d.id === req.params.id);
        if (!decision) return new Response('not found', { status: 404, headers: CORS });
        const body = (await req.json().catch(() => ({}))) as { answer?: string };
        decision.status = 'answered';
        decision.answer = body.answer ?? '';
        decision.answeredAt = new Date().toISOString();
        return json(decision);
      },
    },
    // A2A connection / agent health monitor (distinguishes 'silent' from 'dead').
    '/api/connections': { GET: () => json(connections), OPTIONS: preflight },
  },
  fetch() {
    return new Response('not found', { status: 404, headers: CORS });
  },
});

console.log(`[mock] zipbul backend stand-in on http://localhost:${server.port}`);
