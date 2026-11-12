// Tests de l'authentification du transport HTTP MCP (mesure ANSSI 5.4).
// Exécutés avec `node --test` sur le build TypeScript : npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTokens,
  tokenMatches,
  extractToken,
  isAuthorized,
  createAuthMiddleware,
} from './httpAuth.js';

const TOKENS = ['jeton-courant-123', 'jeton-precedent-456'];

test('parseTokens découpe, nettoie et ignore les vides', () => {
  assert.deepEqual(parseTokens(' a , b ,, c '), ['a', 'b', 'c']);
  assert.deepEqual(parseTokens(undefined), []);
  assert.deepEqual(parseTokens(''), []);
});

test('tokenMatches est strict (longueur et contenu)', () => {
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abc', 'abd'), false);
  assert.equal(tokenMatches('abc', 'abcd'), false);
  assert.equal(tokenMatches('', ''), false);
});

test('extractToken lit Authorization: Bearer (insensible à la casse)', () => {
  assert.equal(extractToken({ authorization: 'Bearer secret-1' }), 'secret-1');
  assert.equal(extractToken({ authorization: 'bearer   secret-2  ' }), 'secret-2');
  assert.equal(extractToken({ authorization: 'Basic xyz' }), null);
  assert.equal(extractToken({}), null);
});

test('extractToken accepte aussi X-MCP-Token', () => {
  assert.equal(extractToken({ 'x-mcp-token': 'secret-3' }), 'secret-3');
});

test('isAuthorized refuse sans jeton, refuse un jeton faux, accepte les deux jetons de rotation', () => {
  assert.equal(isAuthorized({}, TOKENS).ok, false);
  assert.equal(isAuthorized({}, TOKENS).reason, 'missing_token');

  assert.equal(isAuthorized({ authorization: 'Bearer faux' }, TOKENS).ok, false);
  assert.equal(isAuthorized({ authorization: 'Bearer faux' }, TOKENS).reason, 'invalid_token');

  assert.equal(isAuthorized({ authorization: 'Bearer jeton-courant-123' }, TOKENS).ok, true);
  assert.equal(isAuthorized({ authorization: 'Bearer jeton-precedent-456' }, TOKENS).ok, true);
  assert.equal(isAuthorized({ 'x-mcp-token': 'jeton-courant-123' }, TOKENS).ok, true);
});

test('isAuthorized refuse tout si aucun jeton n’est configuré (fail-closed)', () => {
  const result = isAuthorized({ authorization: 'Bearer n-importe-quoi' }, []);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_tokens_configured');
});

test('le middleware renvoie 401 sans jeton et laisse passer avec le bon jeton', () => {
  const middleware = createAuthMiddleware(TOKENS);

  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(body: string) {
      this.body = body;
    },
  };

  let nextCalled = 0;
  middleware({ headers: {} }, res, () => {
    nextCalled += 1;
  });
  assert.equal(nextCalled, 0);
  assert.equal(res.statusCode, 401);
  assert.ok(String(res.headers['WWW-Authenticate']).startsWith('Bearer'));
  const payload = JSON.parse(res.body);
  assert.equal(payload.error.code, -32001);

  const okRes = { statusCode: 0, setHeader() {}, end() {} };
  middleware({ headers: { authorization: 'Bearer jeton-courant-123' } }, okRes, () => {
    nextCalled += 1;
  });
  assert.equal(nextCalled, 1);
  assert.equal(okRes.statusCode, 0);
});
