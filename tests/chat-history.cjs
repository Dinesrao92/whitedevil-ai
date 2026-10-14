const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(require.resolve('../public/chat.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const json = value => ({ ok: true, json: async () => copy(value) });

function element() {
  return {
    children: [], style: {}, dataset: {}, value: '', textContent: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); },
    replaceChildren(...items) { this.children = items; },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, focus() {},
  };
}

function dashboard({ initialList, failChat = false, failSave = false, unavailable = false, store = new Map() } = {}) {
  const elements = new Map();
  const requests = [];
  let firstList = true;
  const context = vm.createContext({
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      createElement: element, createElementNS: element,
      querySelectorAll: () => [], addEventListener() {},
    },
    TextDecoder, console: { warn() {}, error() {} },
    setTimeout: () => 0, clearTimeout() {},
    fetch: async (path, options = {}) => {
      const method = options.method || 'GET';
      const body = options.body && JSON.parse(options.body);
      requests.push({ path, method, body });
      if (path === '/api/chat') {
        if (failChat) throw new Error('AI unavailable');
        const text = `reply to ${body.messages.at(-1).content}`;
        let read = false;
        return { ok: true, body: { getReader: () => ({ read: async () => {
          if (read) return { done: true };
          read = true;
          return { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ response: text })}\n\ndata: [DONE]\n\n`) };
        } }) } };
      }
      if (unavailable) return { ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) };
      if (path === '/api/history' && method === 'GET') {
        if (firstList && initialList) { firstList = false; return initialList; }
        return json({ conversations: [...store.values()].map(({ id, title }) => ({ id, title })) });
      }
      if (method === 'POST') {
        const id = `chat-${store.size + 1}`;
        store.set(id, { id, title: body.title, messages: [] });
        return json({ id });
      }
      const id = path.slice('/api/history/'.length);
      if (method === 'PUT') {
        if (failSave) return { ok: false, status: 503, json: async () => ({ error: 'Save unavailable' }) };
        if (body.messages.length > 80) return { ok: false, status: 400, json: async () => ({ error: 'Invalid or oversized history' }) };
        store.set(id, { id, ...copy(body) });
        return json({ saved: true });
      }
      return json({ conversation: store.get(id) });
    },
  });
  vm.runInContext(source, context);
  return { context, elements, requests, store, run: code => vm.runInContext(code, context) };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('25 exchanges survive save, fresh-page reopen, and a further reply', async () => {
  const app = dashboard();
  await settle();
  for (let n = 1; n <= 25; n++) await app.context.sendMessage(`question ${n}`);
  const saved = copy(app.store.get('chat-1'));
  assert.equal(saved.messages.length, 50);
  assert.equal(saved.title, 'question 1');
  assert.equal(saved.messages[0].content, 'question 1');
  const requests = app.requests.filter(r => r.path === '/api/chat');
  assert.ok(requests.every(r => r.body.messages.length <= 38));
  assert.deepEqual(requests.at(-1).body.messages, saved.messages.slice(0, -1).slice(-38));

  const reopened = dashboard({ store: app.store });
  await settle();
  await reopened.context.openSavedConversation('chat-1');
  assert.deepEqual(copy(reopened.run('chatHistory')), saved.messages);
  assert.equal(reopened.elements.get('chat-messages').children.length, 50);
  await reopened.context.sendMessage('question 26');
  const updated = reopened.store.get('chat-1');
  assert.equal(updated.messages.length, 52);
  assert.deepEqual(updated.messages.slice(0, 50), saved.messages);
  assert.equal(updated.title, 'question 1');
  assert.equal(reopened.requests.find(r => r.path === '/api/chat').body.messages.length, 38);
});

test('completed reply saves even while the initial history listing is pending', async () => {
  let resolveList;
  const app = dashboard({ initialList: new Promise(resolve => { resolveList = resolve; }) });
  await app.context.sendMessage('early question');
  assert.equal(app.store.get('chat-1').messages.length, 2);
  assert.equal(app.requests.filter(r => r.method === 'PUT').length, 1);
  resolveList(json({ conversations: [] }));
  await settle();
  assert.equal(app.requests.filter(r => r.path === '/api/history' && r.method === 'POST').length, 1);
});

test('history unavailable is reported without losing the completed reply', async () => {
  const app = dashboard({ unavailable: true });
  await settle();
  await app.context.sendMessage('keep this reply');
  assert.equal(app.run('chatHistory.length'), 2);
  assert.equal(app.elements.get('memory-status').textContent, 'Not saved · Chat continues');
  assert.equal(app.run('isProcessing'), false);
});

test('failed AI request does not truncate or overwrite an existing transcript', async () => {
  const app = dashboard({ failChat: true });
  await settle();
  const messages = Array.from({ length: 50 }, (_, n) => ({ role: n % 2 ? 'assistant' : 'user', content: `message ${n}` }));
  app.context.saved = copy(messages);
  app.run('chatHistory = saved');
  await app.context.sendMessage('failed question');
  assert.deepEqual(copy(app.run('chatHistory')), messages);
  assert.equal(app.requests.filter(r => r.method === 'PUT').length, 0);
});

test('existing 80-message limit rejects a new save without replacing older saved history', async () => {
  const app = dashboard();
  await settle();
  for (let n = 1; n <= 40; n++) await app.context.sendMessage(`question ${n}`);
  const saved = copy(app.store.get('chat-1'));
  assert.equal(saved.messages.length, 80);
  await app.context.sendMessage('question 41');
  assert.deepEqual(app.store.get('chat-1'), saved);
  assert.equal(app.run('chatHistory.length'), 82);
  assert.equal(app.elements.get('memory-status').textContent, 'Not saved · Chat continues');
});


test('late initial listing cannot clear a failed-save warning', async () => {
  let resolveList;
  const app = dashboard({ failSave: true, initialList: new Promise(resolve => { resolveList = resolve; }) });
  await app.context.sendMessage('unsaved reply');
  assert.equal(app.elements.get('memory-status').textContent, 'Not saved · Chat continues');
  resolveList(json({ conversations: [] }));
  await settle();
  assert.equal(app.elements.get('memory-status').textContent, 'Not saved · Chat continues');
  assert.equal(app.run('chatHistory.length'), 2);
});
