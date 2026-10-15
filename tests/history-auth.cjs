// Offline synthetic tokens only. Never send these test identities to a live service.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const source = ts.transpileModule(readFileSync(require.resolve('../src/memory.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

test('valid signed owner accepted; bad claims/signature rejected without logging private values', async () => {
  const keys = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', keys.publicKey);
  jwk.kid = 'test-key'; jwk.alg = 'RS256';
  const logs = [];
  const exports = {};
  const context = vm.createContext({ exports, Request, Response, TextDecoder, TextEncoder, Uint8Array, atob, crypto: webcrypto,
    console: { warn: (...args) => logs.push(args), error() {} },
    fetch: async () => Response.json({ keys: [jwk] }),
  });
  vm.runInContext(source, context);
  const env = { ACCESS_TEAM_DOMAIN: 'https://test.cloudflareaccess.com', ACCESS_AUD: 'test-audience', MEMORY_OWNER_EMAIL: 'owner@example.invalid' };
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: env.ACCESS_TEAM_DOMAIN, sub: 'synthetic-subject', aud: [env.ACCESS_AUD], email: env.MEMORY_OWNER_EMAIL, iat: now, exp: now + 600 };
  async function token(changes = {}) {
    const data = encode({ alg: 'RS256', kid: 'test-key' }) + '.' + encode({ ...claims, ...changes });
    const signature = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(data));
    return data + '.' + Buffer.from(signature).toString('base64url');
  }
  async function verify(jwt, config = env) {
    context.request = new Request('https://test.invalid/api/history', { headers: { 'cf-access-jwt-assertion': jwt } });
    context.env = config;
    return vm.runInContext('verifyAccess(request, env)', context);
  }
  const valid = await token();
  assert.equal((await verify(valid)).sub, claims.sub);
  assert.equal(logs.length, 0);
  for (const [changes, reason] of [
    [{ aud: ['wrong-audience'] }, 'audience_mismatch'],
    [{ iss: 'https://other.cloudflareaccess.com' }, 'issuer_or_subject_mismatch'],
    [{ email: 'other@example.invalid' }, 'owner_mismatch'],
    [{ exp: now - 1 }, 'expired_or_missing_exp'],
    [{ iat: now + 120 }, 'invalid_iat'],
    [{ nbf: now + 120 }, 'not_yet_valid'],
  ]) {
    assert.equal(await verify(await token(changes)), null);
    assert.equal(logs.at(-1)[1], reason);
  }
  assert.equal(await verify(valid, { ...env, MEMORY_OWNER_EMAIL: '' }), null);
  assert.equal(logs.at(-1)[1], 'missing_config');
  const parts = valid.split('.');
  const signature = Buffer.from(parts[2], 'base64url'); signature[0] ^= 1;
  assert.equal(await verify(parts.slice(0, 2).join('.') + '.' + signature.toString('base64url')), null);
  assert.equal(logs.at(-1)[1], 'invalid_signature');
  const logText = JSON.stringify(logs);
  for (const privateValue of [valid, claims.email, claims.sub, claims.iss, claims.aud[0]]) assert.ok(!logText.includes(privateValue));
});
