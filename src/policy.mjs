// Deterministic spending rules. The AI layer can only make a decision stricter, never looser.

export const DEFAULT_POLICY = {
  currency: 'USD',
  budget: { amount: 150, period: 'week' },
  perPurchaseMax: 100,
  approvalAbove: 40,
  allowedCategories: ['office_supplies', 'software', 'food_beverage'],
  blockedCategories: ['gift_cards', 'crypto', 'gambling', 'cash_equivalents'],
  merchantAllowlist: [],
  maxPurchasesPerHour: 6,
  requireJustification: true,
};

export const CATEGORIES = [
  'office_supplies', 'software', 'food_beverage', 'electronics', 'travel',
  'gift_cards', 'crypto', 'gambling', 'cash_equivalents', 'other',
];

const PERIOD_MS = { day: 864e5, week: 7 * 864e5, month: 30 * 864e5 };
const RANK = { allow: 0, approve: 1, deny: 2 };

export const stricter = (a, b) => (RANK[a] >= RANK[b] ? a : b);

// Money that is spent or reserved: paid purchases plus ones waiting for a human.
export function committed(ledger, policy, now = Date.now()) {
  const since = now - (PERIOD_MS[policy.budget.period] ?? PERIOD_MS.week);
  return round2(ledger
    .filter(e => e.at >= since && ['paid', 'pending', 'paying', 'refunding'].includes(e.status))
    .reduce((s, e) => s + e.amount, 0));
}

export function evaluate(req, policy, ledger, { now = Date.now(), frozen = false } = {}) {
  const checks = [];
  const add = (name, ok, onFail, why) => checks.push({ name, ok, onFail, why });
  const spent = committed(ledger, policy, now);
  const lastHour = ledger.filter(e => e.at >= now - 36e5 && e.status !== 'denied').length;
  const dup = ledger.find(e => e.productId === req.productId && e.at >= now - 864e5 && e.status !== 'denied');
  const $ = n => `$${n.toFixed(2)}`;
  const cat = req.category.replace(/_/g, ' ');

  add('not frozen', !frozen, 'deny', 'the owner froze all agent spending');
  add('category not blocked', !policy.blockedCategories.includes(req.category), 'deny', `${cat} is a blocked category`);
  add('category allowed', !policy.allowedCategories.length || policy.allowedCategories.includes(req.category)
    || policy.blockedCategories.includes(req.category), 'deny',
    `${cat} is not an allowed category`);
  add('merchant allowed', !policy.merchantAllowlist.length || policy.merchantAllowlist.includes(req.merchant), 'deny',
    `${req.merchant} is not on the merchant list`);
  add('per-purchase cap', req.amount <= policy.perPurchaseMax, 'deny',
    `${$(req.amount)} is over the ${$(policy.perPurchaseMax)} per-purchase cap`);
  add('budget', spent + req.amount <= policy.budget.amount, 'deny',
    `would exceed the ${$(policy.budget.amount)}/${policy.budget.period} budget (${$(spent)} already committed)`);
  add('velocity', lastHour < policy.maxPurchasesPerHour, 'deny', `${lastHour} purchases in the last hour (max ${policy.maxPurchasesPerHour})`);
  add('justification', !policy.requireJustification || (req.justification ?? '').trim().length >= 8, 'deny',
    'the agent did not say why it needs this');
  add('not a repeat', !dup, 'approve', `already bought ${req.productId} in the last 24h`);
  add('auto-approve limit', req.amount <= policy.approvalAbove, 'approve',
    `${$(req.amount)} is over your ${$(policy.approvalAbove)} auto-approve limit`);

  let decision = 'allow';
  for (const c of checks) if (!c.ok) decision = stricter(decision, c.onFail);
  // Only the reasons that decided the outcome: a refused buy doesn't also need "over the approval limit".
  const reasons = checks.filter(c => !c.ok && c.onFail === decision).map(c => c.why);
  return { decision, reasons, checks, remaining: round2(policy.budget.amount - spent) };
}

// Sanitize a policy that came from the AI compiler or the UI.
export function normalizePolicy(p) {
  const num = (v, d) => (Number.isFinite(+v) && +v >= 0 ? round2(+v) : d);
  const cats = v => (Array.isArray(v) ? v.filter(c => CATEGORIES.includes(c)) : []);
  const d = DEFAULT_POLICY;
  const out = {
    currency: 'USD',
    budget: {
      amount: num(p?.budget?.amount, d.budget.amount),
      period: PERIOD_MS[p?.budget?.period] ? p.budget.period : d.budget.period,
    },
    perPurchaseMax: num(p?.perPurchaseMax, d.perPurchaseMax),
    approvalAbove: num(p?.approvalAbove, d.approvalAbove),
    allowedCategories: cats(p?.allowedCategories),
    blockedCategories: cats(p?.blockedCategories),
    merchantAllowlist: Array.isArray(p?.merchantAllowlist) ? p.merchantAllowlist.map(String).slice(0, 50) : [],
    maxPurchasesPerHour: Math.max(1, Math.round(num(p?.maxPurchasesPerHour, d.maxPurchasesPerHour))),
    requireJustification: p?.requireJustification !== false,
  };
  out.allowedCategories = out.allowedCategories.filter(c => !out.blockedCategories.includes(c));
  return out;
}

export const round2 = n => Math.round(n * 100) / 100;
