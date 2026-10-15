// Exercise the real Workers Request implementation; do not contact live services.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

test('signing-key fetch is Workers-compatible and rejects redirects and errors', async () => {
  const source = ts.transpileModule(readFileSync(require.resolve('../src/memory.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const script = source + `
    let status = 200;
    let calls = 0;
    const fetch = async (url, options) => {
      // Real workerd constructor catches unsupported options even with offline I/O.
      const request = new Request(url, options);
      if (request.redirect !== 'manual') throw new Error('Redirects must not be followed');
      calls++;
      return new Response(JSON.stringify({keys:[{kty:'RSA',kid:'offline-test'}]}), {status});
    };
    export default {async fetch() {
      const results = [];
      for (status of [200, 301, 302, 307, 308, 500]) {
        cachedKeys = undefined;
        try { await getKeys('https://test.cloudflareaccess.com'); results.push(true); }
        catch { results.push(false); }
      }
      return Response.json({results,calls});
    }};
  `;
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script,
    compatibilityDate: '2025-10-08', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
  }));
  try {
    const response = await mf.dispatchFetch('http://localhost');
    assert.deepEqual(await response.json(), { results: [true, false, false, false, false, false], calls: 6 });
  } finally { await mf.dispose(); }
});
