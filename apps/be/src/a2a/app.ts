import { Elysia } from 'elysia';
import type { AgentCard } from '@bw/dto';
import { parseJsonRpc } from './jsonrpc';
import { dispatch, type MethodHandler } from './dispatch';
import type { StreamHandler } from './methods/message-stream';
import type { Authenticator } from './auth/authenticate';
import type { Authorizer } from './auth/authorize';

export interface A2ADeps {
  /** Resolve a project's Agent Card, or undefined when the project is unknown. */
  card: (projectId: string) => AgentCard | undefined;
  /** JSON-RPC method handlers (message/send, tasks/get, tasks/cancel, push-config, ...). */
  handlers: Map<string, MethodHandler>;
  /** Optional SSE handler for message/stream. */
  stream?: StreamHandler;
  /** Optional bearer authentication; when set, an unauthenticated POST gets 401. */
  authenticate?: Authenticator;
  /** Optional relationship authorization; when set, a disallowed caller gets 403. */
  authorize?: Authorizer;
}

/**
 * A2A transport over Elysia (TEMPORARY framework choice): Agent Card discovery +
 * JSON-RPC endpoint. Workflow/auth live behind injected deps (SRP).
 */
export function createA2AApp(deps: A2ADeps) {
  return new Elysia()
    .get('/agents/:projectId/.well-known/agent.json', ({ params, set }) => {
      const card = deps.card(params.projectId);
      if (!card) {
        set.status = 404;
        return { error: 'unknown project' };
      }
      return card;
    })
    .post(
      '/agents/:projectId/a2a',
      ({ body, params, request, set }) => {
        if (deps.authenticate) {
          const principal = deps.authenticate(request.headers.get('authorization') ?? undefined);
          if (!principal) {
            set.status = 401;
            return { error: 'unauthorized' };
          }
          if (deps.authorize && !deps.authorize(principal, params.projectId)) {
            set.status = 403;
            return { error: 'forbidden' };
          }
        }

        const parsed = parseJsonRpc(typeof body === 'string' ? body : '');
        if (!parsed.ok) return parsed.response;

        if (parsed.request.method === 'message/stream' && deps.stream) {
          const gen = deps.stream(parsed.request);
          const sse = new ReadableStream({
            async pull(controller) {
              try {
                const { value, done } = await gen.next();
                if (done) {
                  controller.close();
                  return;
                }
                controller.enqueue(`data: ${JSON.stringify(value)}\n\n`);
              } catch (err) {
                controller.error(err);
              }
            },
          });
          return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
        }

        return dispatch(parsed.request, deps.handlers);
      },
      { parse: 'text' },
    );
}
