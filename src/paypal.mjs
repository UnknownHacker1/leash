// PayPal sandbox client (Orders v2, Vault v3, Payments v2) with a mock of the same shape for keyless demos.
import { randomUUID } from 'node:crypto';

const BASE = 'https://api-m.sandbox.paypal.com';

export function createPayPal({ clientId, secret, publicUrl }) {
  if (!clientId || !secret) return mockPayPal(publicUrl);
  let token = null, tokenExp = 0;

  async function auth() {
    if (token && Date.now() < tokenExp - 60e3) return token;
    const r = await fetch(`${BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`PayPal auth failed: ${j.error_description || r.status}`);
    token = j.access_token;
    tokenExp = Date.now() + j.expires_in * 1000;
    return token;
  }

  async function call(method, path, body, requestId) {
    const r = await fetch(BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${await auth()}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': requestId || randomUUID(),
        Prefer: 'return=representation',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    const j = text ? JSON.parse(text) : {};
    if (!r.ok) {
      const why = j.details?.map(d => d.issue + (d.description ? ` (${d.description})` : '')).join('; ') || j.message || r.status;
      throw new Error(`PayPal ${method} ${path}: ${why}`);
    }
    return j;
  }

  const unit = p => ({
    reference_id: p.id,
    custom_id: p.id,
    description: p.description.slice(0, 127),
    amount: { currency_code: 'USD', value: p.amount.toFixed(2) },
  });
  const captureOf = o => o.purchase_units?.[0]?.payments?.captures?.[0];

  return {
    mode: 'sandbox',

    // Step 1 of saving the owner's PayPal wallet for agent use: buyer approves once.
    async startVault() {
      const st = await call('POST', '/v3/vault/setup-tokens', {
        payment_source: {
          paypal: {
            description: 'Leash: let your AI agents pay within the rules you set',
            usage_type: 'MERCHANT',
            usage_pattern: 'IMMEDIATE',
            customer_type: 'CONSUMER',
            permit_multiple_payment_tokens: false,
            experience_context: {
              brand_name: 'Leash',
              shipping_preference: 'NO_SHIPPING',
              return_url: `${publicUrl}/paypal/vault-return`,
              cancel_url: `${publicUrl}/?vault=cancelled`,
            },
          },
        },
      });
      return { setupTokenId: st.id, approveUrl: st.links.find(l => l.rel === 'approve')?.href };
    },

    async finishVault(setupTokenId) {
      const pt = await call('POST', '/v3/vault/payment-tokens', {
        payment_source: { token: { id: setupTokenId, type: 'SETUP_TOKEN' } },
      });
      return { vaultId: pt.id, email: pt.payment_source?.paypal?.email_address || 'sandbox buyer' };
    },

    // Merchant-initiated charge against the saved wallet: no buyer redirect.
    async chargeVault(vaultId, p) {
      let o = await call('POST', '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [unit(p)],
        payment_source: { paypal: { vault_id: vaultId } },
      }, `leash-${p.id}`);
      if (o.status === 'APPROVED') o = await call('POST', `/v2/checkout/orders/${o.id}/capture`, {}, `leash-cap-${p.id}`);
      const cap = captureOf(o);
      if (o.status !== 'COMPLETED' || !cap) throw new Error(`PayPal order ${o.id} ended ${o.status}`);
      return { orderId: o.id, captureId: cap.id };
    },

    // Human-approved path when no wallet is saved: owner pays through normal PayPal checkout.
    async createCheckout(p) {
      const o = await call('POST', '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [unit(p)],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'Leash',
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
              return_url: `${publicUrl}/paypal/return?pid=${encodeURIComponent(p.id)}`,
              cancel_url: `${publicUrl}/?cancelled=${encodeURIComponent(p.id)}`,
            },
          },
        },
      }, `leash-co-${p.id}`);
      const link = o.links.find(l => l.rel === 'payer-action' || l.rel === 'approve');
      return { orderId: o.id, approveUrl: link?.href };
    },

    async captureCheckout(orderId, pid) {
      const o = await call('POST', `/v2/checkout/orders/${orderId}/capture`, {}, `leash-cap-${pid}`);
      const cap = captureOf(o);
      if (o.status !== 'COMPLETED' || !cap) throw new Error(`PayPal order ${orderId} ended ${o.status}`);
      return { orderId: o.id, captureId: cap.id };
    },

    async refund(captureId, pid) {
      const r = await call('POST', `/v2/payments/captures/${captureId}/refund`, {}, `leash-ref-${pid}`);
      return { refundId: r.id, status: r.status };
    },
  };
}

// Same interface, no network. Lets judges run the whole flow without PayPal credentials.
function mockPayPal(publicUrl) {
  const id = p => `${p}-MOCK-${randomUUID().slice(0, 8).toUpperCase()}`;
  const pending = new Map();
  return {
    mode: 'mock',
    async startVault() {
      const setupTokenId = id('ST');
      return { setupTokenId, approveUrl: `${publicUrl}/paypal/vault-return?approval_token_id=${setupTokenId}` };
    },
    async finishVault() { return { vaultId: id('VT'), email: 'buyer@mock.paypal' }; },
    async chargeVault() { return { orderId: id('ORDER'), captureId: id('CAP') }; },
    async createCheckout(p) {
      const orderId = id('ORDER');
      pending.set(orderId, p.id);
      return { orderId, approveUrl: `${publicUrl}/paypal/return?pid=${encodeURIComponent(p.id)}&token=${orderId}` };
    },
    async captureCheckout(orderId) { return { orderId, captureId: id('CAP') }; },
    async refund() { return { refundId: id('REF'), status: 'COMPLETED' }; },
  };
}
