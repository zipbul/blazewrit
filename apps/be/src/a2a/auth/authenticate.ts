import type { Principal } from './principal';

/** Maps an Authorization header to a Principal, or null when unauthenticated. */
export type Authenticator = (authorization?: string) => Principal | null;

/**
 * Bearer authentication (Agent Card security scheme). TEMPORARY token table —
 * replaced by real credential verification (OAuth2/mTLS) later.
 */
export function makeBearerAuthenticator(tokens: Map<string, Principal>): Authenticator {
  return (authorization) => {
    if (!authorization) return null;
    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) return null;
    return tokens.get(token) ?? null;
  };
}
