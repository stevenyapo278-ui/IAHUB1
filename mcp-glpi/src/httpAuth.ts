// ── Authentification du transport HTTP MCP ─────────────────────────────────
// Mesure ANSSI 5.4 (Q-5.4-02) : les échanges entre agents et outils sont
// authentifiés comme ceux d'une entité non fiable. Aucun appel n'est accepté
// au seul motif qu'il provient du réseau interne.
//
// Choix de conception :
//  - jeton porteur obligatoire (`Authorization: Bearer` ou `X-MCP-Token`) ;
//  - liste de jetons acceptés : permet une rotation sans coupure (ancien + nouveau) ;
//  - comparaison à temps constant (pas de fuite par mesure de durée) ;
//  - refus par défaut : si aucun jeton n'est configuré, le mode HTTP refuse de démarrer.
import { timingSafeEqual } from 'node:crypto';

export interface AuthResult {
  ok: boolean;
  reason?: 'missing_token' | 'invalid_token' | 'no_tokens_configured';
}

/** Lit MCP_AUTH_TOKEN / MCP_AUTH_TOKENS (liste séparée par des virgules). */
export function parseTokens(raw?: string | null): string[] {
  return String(raw || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Comparaison à temps constant ; les longueurs différentes échouent immédiatement. */
export function tokenMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(String(candidate), 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Extrait le jeton d'un en-tête `Authorization: Bearer …` ou `X-MCP-Token`. */
export function extractToken(headers: Record<string, unknown> = {}): string | null {
  const auth = headers['authorization'];
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  const custom = headers['x-mcp-token'];
  if (typeof custom === 'string' && custom.trim()) return custom.trim();
  return null;
}

export function isAuthorized(headers: Record<string, unknown>, tokens: string[]): AuthResult {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { ok: false, reason: 'no_tokens_configured' };
  }
  const presented = extractToken(headers);
  if (!presented) return { ok: false, reason: 'missing_token' };
  // Aucun court-circuit : on compare à tous les jetons (rotation) sans s'arrêter au premier.
  let matched = false;
  for (const expected of tokens) {
    if (tokenMatches(presented, expected)) matched = true;
  }
  return matched ? { ok: true } : { ok: false, reason: 'invalid_token' };
}

/** Middleware Express (types volontairement larges : express est chargé dynamiquement). */
export function createAuthMiddleware(tokens: string[]) {
  return (req: any, res: any, next: () => void): void => {
    const result = isAuthorized(req.headers || {}, tokens);
    if (result.ok) {
      next();
      return;
    }
    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', 'Bearer realm="mcp-glpi"');
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32001, message: 'Unauthorized' },
      })
    );
  };
}
