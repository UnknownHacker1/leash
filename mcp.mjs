#!/usr/bin/env node
// Leash as an MCP server (stdio). Point Claude Desktop, Claude Code, Cursor or any MCP client at this file
// and the agent shops through the same firewall as the built-in one. Needs `npm start` running.
import { createInterface } from 'node:readline';

const LEASH = (process.env.LEASH_URL || 'http://localhost:8787').replace(/\/$/, '');
const task = { type: 'string', description: "The request from your user that this purchase serves, in their words. Leash audits every purchase against it." };
const obj = (props, req) => ({ type: 'object', properties: props, required: req, additionalProperties: false });

const TOOLS = [
  { name: 'search_catalog', description: 'Search connected merchants for products. Returns id, name, merchant and price.',
    inputSchema: obj({ task, query: { type: 'string' } }, ['task', 'query']) },
  { name: 'get_product', description: 'Full product page for one product id, including the merchant listing text.',
    inputSchema: obj({ task, product_id: { type: 'string' } }, ['task', 'product_id']) },
  { name: 'request_purchase', description: "Pay for a product with the owner's PayPal through Leash. Leash checks the owner's rules and audits the purchase, then pays now, holds it for the owner's approval, or refuses. Never retry a refused or held purchase.",
    inputSchema: obj({ task, product_id: { type: 'string' }, quantity: { type: 'integer', minimum: 1 }, justification: { type: 'string', description: 'Why this purchase is needed.' } }, ['task', 'product_id', 'quantity', 'justification']) },
];

async function call(name, args) {
  const { task: t, ...input } = args || {};
  const r = await fetch(`${LEASH}/api/agent/call`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: name, task: t, input }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Leash returned ${r.status}`);
  return j.result;
}

const send = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

createInterface({ input: process.stdin }).on('line', async line => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return; // notifications need no reply
  try {
    if (m.method === 'initialize') {
      return send({ id: m.id, result: {
        protocolVersion: m.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'leash', version: '1.0.0' },
        instructions: 'Use these tools to buy things for the user. All payments go through Leash, which enforces the owner\'s spending rules.',
      } });
    }
    if (m.method === 'ping') return send({ id: m.id, result: {} });
    if (m.method === 'tools/list') return send({ id: m.id, result: { tools: TOOLS } });
    if (m.method === 'tools/call') {
      try {
        const text = await call(m.params.name, m.params.arguments);
        return send({ id: m.id, result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        return send({ id: m.id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
      }
    }
    send({ id: m.id, error: { code: -32601, message: `Unknown method ${m.method}` } });
  } catch (e) {
    send({ id: m.id, error: { code: -32603, message: e.message } });
  }
});
