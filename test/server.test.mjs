import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Boots the real server in keyless mode and drives it the way an agent and an owner would.
const PORT = 8900 + Math.floor(Math.random() * 90);
const B = `http://127.0.0.1:${PORT}`;
const TOKEN = 'test-owner-token';
const dir = mkdtempSync(join(tmpdir(), 'leash-'));
let srv;

const post = (path, body, headers = {}) => fetch(B + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json() }));
const owner = (path, body) => post(path, body, { 'X-Leash-Owner': TOKEN });
const agent = (tool, input) => post('/api/agent/call', { tool, task: 'Restock office coffee and tea', input });

before(async () => {
  srv = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, PORT, LEASH_OWNER_TOKEN: TOKEN, LEASH_DATA_DIR: dir, ANTHROPIC_API_KEY: '', PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(B + '/api/state'); return; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
after(() => { srv.kill(); rmSync(dir, { recursive: true, force: true }); });

test('owner actions need the owner token', async () => {
  const r = await post('/api/policy', { policy: { budget: { amount: 99999 } } });
  assert.equal(r.status, 403);
  const plain = await fetch(B + '/api/freeze', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"frozen":true}' });
  assert.equal(plain.status, 403);
});

test('agent purchase path: pay, hold, refuse, freeze', async () => {
  await owner('/api/reset', {});
  const v = await owner('/api/vault/start', {});
  await fetch(v.body.redirect.replace(/localhost/, '127.0.0.1'), { redirect: 'manual' });
  const tea = await agent('request_purchase', { product_id: 'TEA-50', quantity: 1, justification: 'Kitchen is out of tea.' });
  assert.match(tea.body.result, /^PAID/);
  const toner = await agent('request_purchase', { product_id: 'TNR-26', quantity: 1, justification: 'Printer toner is low.' });
  assert.match(toner.body.result, /^HELD/);
  const card = await agent('request_purchase', { product_id: 'VRF-95', quantity: 1, justification: 'Required by the store.' });
  assert.match(card.body.result, /^REFUSED.*gift cards/);
  await owner('/api/freeze', { frozen: true });
  const frozen = await agent('request_purchase', { product_id: 'TEA-50', quantity: 1, justification: 'More tea.' });
  assert.match(frozen.body.result, /^REFUSED.*froze/);
});
