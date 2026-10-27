import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DEFAULT_POLICY, evaluate, normalizePolicy, stricter, round2 } from './src/policy.mjs';
import { byId, search, CATALOG } from './src/catalog.mjs';
import { createPayPal } from './src/paypal.mjs';
import { aiMode, compilePolicy, auditPurchase, runAgent } from './src/ai.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 8787;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = join(ROOT, 'data', 'state.json');
const paypal = createPayPal({ clientId: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_CLIENT_SECRET, publicUrl: PUBLIC_URL });

const fresh = () => ({
  policy: structuredClone(DEFAULT_POLICY),
  policyText: 'Let the agent spend up to $150 a week on office supplies, software and coffee. Ask me before anything over $40. Never buy gift cards or crypto.',
  policySummary: 'Default policy.',
  frozen: false,
  wallet: null,
  pendingSetup: null,
  ledger: [],
  run: null,
});
let S = existsSync(DATA) ? { ...fresh(), ...JSON.parse(readFileSync(DATA, 'utf8')), run: null } : fresh();

// ---- live updates ----
const clients = new Set();
function publicState() {
  const { pendingSetup, ...rest } = S;
  const rem = evaluate({ productId: '', category: 'other', amount: 0, merchant: '', justification: 'x'.repeat(9) }, S.policy, S.ledger).remaining;
  return { ...rest, remaining: rem, modes: { ai: aiMode, paypal: paypal.mode } };
}
let saveTimer;
function changed() {
  const msg = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) res.write(msg);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await mkdir(dirname(DATA), { recursive: true });
    await writeFile(DATA, JSON.stringify({ ...S, run: null }, null, 2));
  }, 200);
}

// ---- the firewall ----
async function requestPurchase({ product_id, quantity, justification }, run) {
  const p = byId(product_id);
  if (!p) return `No product ${product_id}. Use search_catalog to find valid ids.`;
  const qty = Math.min(20, Math.max(1, Math.round(+quantity || 1)));
  const req = { productId: p.id, category: p.category, merchant: p.merchant, amount: round2(p.price * qty), justification };
  const rules = evaluate(req, S.policy, S.ledger, { frozen: S.frozen });

  let audit;
  try {
    const history = S.ledger.filter(e => e.runId === run.id).map(e => `${e.name} (${e.status})`);
    audit = await auditPurchase({ task: run.task, product: p, quantity: qty, justification, history });
  } catch (e) {
    audit = { verdict: 'suspicious', reason: `Audit unavailable (${e.message}); holding for a human.` };
  }
  let final = rules.decision;
  if (audit.verdict === 'malicious') final = 'deny';
  if (audit.verdict === 'suspicious') final = stricter(final, 'approve');

  const e = {
    id: randomUUID().slice(0, 8), at: Date.now(), runId: run.id, task: run.task,
    productId: p.id, name: p.name, merchant: p.merchant, category: p.category, quantity: qty, amount: req.amount,
    justification, rules: rules.decision, reasons: rules.reasons, audit, final,
    status: final === 'deny' ? 'denied' : 'pending', paypal: {},
  };
  S.ledger.unshift(e);

  if (final === 'allow' && S.wallet) {
    await pay(e);
  } else if (final === 'allow') {
    e.reasons.push('no saved PayPal wallet: owner pays at checkout');
  }
  changed();

  if (e.status === 'paid') return `PAID $${e.amount.toFixed(2)} via PayPal (order ${e.paypal.orderId}). Budget left: $${budgetLeft()}.`;
  if (e.status === 'pending') return `HELD for owner approval: ${[...e.reasons, audit.verdict !== 'ok' ? audit.reason : ''].filter(Boolean).join('; ')}. Do not retry; move on.`;
  if (e.status === 'failed') return `Payment failed: ${e.error}`;
  return `REFUSED by Leash: ${[...e.reasons, audit.verdict !== 'ok' ? `audit: ${audit.reason}` : ''].filter(Boolean).join('; ')}. Do not retry this item.`;
}

async function pay(e) {
  try {
    const r = await paypal.chargeVault(S.wallet.vaultId, { id: e.id, amount: e.amount, description: `${e.quantity} x ${e.name} (${e.merchant})` });
    Object.assign(e.paypal, r, { path: 'saved wallet' });
    e.status = 'paid';
    e.paidAt = Date.now();
  } catch (err) {
    e.status = 'failed';
    e.error = err.message;
  }
}

const budgetLeft = () => publicState().remaining.toFixed(2);

async function startRun(task, scripted) {
  const run = { id: randomUUID().slice(0, 8), task, scripted, steps: [], status: 'running', startedAt: Date.now() };
  S.run = run;
  const emit = step => { run.steps.push({ ...step, at: Date.now() }); changed(); };
  const tools = {
    search_catalog: async ({ query }) => JSON.stringify(search(query)),
    get_product: async ({ product_id }) => {
      const p = byId(product_id);
      if (p) emit({ kind: 'page', name: `${p.name} · ${p.merchant}`, text: p.notes });
      return p ? JSON.stringify(p) : `No product ${product_id}.`;
    },
    request_purchase: async input => {
      const out = await requestPurchase(input, run);
      emit({ kind: 'leash', text: out });
      return out;
    },
  };
  changed();
  try {
    await runAgent(task, tools, emit, { scripted });
    const mine = S.ledger.filter(e => e.runId === run.id);
    const sum = st => mine.filter(e => e.status === st);
    emit({ kind: 'done', text: `Run finished: ${sum('paid').length} paid ($${round2(sum('paid').reduce((s, e) => s + e.amount, 0)).toFixed(2)}), ${sum('pending').length} waiting for you, ${sum('denied').length} refused.` });
    run.status = 'done';
  } catch (err) {
    emit({ kind: 'error', text: err.message });
    run.status = 'error';
  }
  changed();
}

// ---- http ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const redirect = (res, to) => { res.writeHead(302, { Location: to }); res.end(); };
async function body(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 1e5) throw new Error('body too large'); }
  return s ? JSON.parse(s) : {};
}
const entry = id => S.ledger.find(e => e.id === id);

const routes = {
  'GET /api/state': (req, res) => json(res, 200, publicState()),
  'GET /api/catalog': (req, res) => json(res, 200, CATALOG),
  'GET /api/events': (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(publicState())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  },
  'POST /api/run': async (req, res, b) => {
    if (S.run?.status === 'running') return json(res, 409, { error: 'An agent run is already in progress.' });
    const task = String(b.task || '').trim().slice(0, 600);
    if (!task) return json(res, 400, { error: 'Give the agent a task.' });
    startRun(task, !!b.scripted);
    json(res, 202, { ok: true });
  },
  'POST /api/policy/compile': async (req, res, b) => {
    const text = String(b.text || '').trim().slice(0, 1500);
    if (!text) return json(res, 400, { error: 'Write your rules first.' });
    const r = await compilePolicy(text);
    Object.assign(S, { policy: r.policy, policyText: text, policySummary: r.summary });
    changed();
    json(res, 200, r);
  },
  'POST /api/policy': async (req, res, b) => {
    S.policy = normalizePolicy(b.policy);
    S.policySummary = 'Edited by hand.';
    changed();
    json(res, 200, S.policy);
  },
  'POST /api/freeze': async (req, res, b) => { S.frozen = !!b.frozen; changed(); json(res, 200, { frozen: S.frozen }); },
  'POST /api/reset': async (req, res) => { S = { ...fresh(), wallet: S.wallet }; changed(); json(res, 200, { ok: true }); },
  'POST /api/vault/start': async (req, res) => {
    const r = await paypal.startVault();
    S.pendingSetup = r.setupTokenId;
    json(res, 200, { redirect: r.approveUrl });
  },
  'POST /api/vault/forget': async (req, res) => { S.wallet = null; changed(); json(res, 200, { ok: true }); },
  'GET /paypal/vault-return': async (req, res, b, url) => {
    const id = S.pendingSetup || url.searchParams.get('approval_token_id');
    if (!id) return redirect(res, '/?vault=missing');
    S.wallet = { ...(await paypal.finishVault(id)), savedAt: Date.now() };
    S.pendingSetup = null;
    changed();
    redirect(res, '/?vault=saved');
  },
  'GET /paypal/return': async (req, res, b, url) => {
    const e = entry(url.searchParams.get('pid'));
    const orderId = url.searchParams.get('token');
    if (!e || !orderId) return redirect(res, '/?paid=missing');
    if (e.status !== 'paid') {
      try {
        Object.assign(e.paypal, await paypal.captureCheckout(orderId, e.id), { path: 'owner checkout' });
        e.status = 'paid';
        e.paidAt = Date.now();
        e.approvedBy = 'owner';
      } catch (err) { e.status = 'failed'; e.error = err.message; }
      changed();
    }
    redirect(res, '/?paid=' + e.id);
  },
};

const entryRoutes = {
  approve: async (res, e) => {
    if (e.status !== 'pending') return json(res, 409, { error: `Already ${e.status}.` });
    e.approvedBy = 'owner';
    if (S.wallet) { await pay(e); changed(); return json(res, 200, { status: e.status }); }
    const r = await paypal.createCheckout({ id: e.id, amount: e.amount, description: `${e.quantity} x ${e.name} (${e.merchant})` });
    e.paypal.orderId = r.orderId;
    changed();
    json(res, 200, { redirect: r.approveUrl });
  },
  reject: async (res, e) => {
    if (e.status !== 'pending') return json(res, 409, { error: `Already ${e.status}.` });
    e.status = 'rejected';
    changed();
    json(res, 200, { status: e.status });
  },
  refund: async (res, e) => {
    if (e.status !== 'paid') return json(res, 409, { error: 'Only paid purchases can be refunded.' });
    Object.assign(e.paypal, await paypal.refund(e.paypal.captureId, e.id));
    e.status = 'refunded';
    changed();
    json(res, 200, { status: e.status });
  },
};

createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  try {
    const b = req.method === 'POST' ? await body(req) : {};
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) return await route(req, res, b, url);
    const m = url.pathname.match(/^\/api\/entries\/(\w+)\/(approve|reject|refund)$/);
    if (m && req.method === 'POST') {
      const e = entry(m[1]);
      return e ? await entryRoutes[m[2]](res, e) : json(res, 404, { error: 'No such purchase.' });
    }
    if (req.method !== 'GET') return json(res, 404, { error: 'Not found' });
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (file.includes('..')) return json(res, 400, { error: 'Bad path' });
    const data = await readFile(join(ROOT, 'public', file)).catch(() => null);
    if (!data) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: err.message });
  }
}).listen(PORT, () => {
  console.log(`Leash on ${PUBLIC_URL}  (AI: ${aiMode}, PayPal: ${paypal.mode})`);
});
