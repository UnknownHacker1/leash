import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, evaluate, normalizePolicy, committed } from '../src/policy.mjs';

const P = DEFAULT_POLICY;
const now = 1_800_000_000_000;
const req = (o = {}) => ({ productId: 'X', category: 'office_supplies', merchant: 'M', amount: 20, justification: 'out of paper', ...o });
const paid = (amount, ago = 0, o = {}) => ({ productId: 'P' + Math.random(), at: now - ago, amount, status: 'paid', ...o });

test('small on-policy purchase is allowed', () => {
  assert.equal(evaluate(req(), P, [], { now }).decision, 'allow');
});

test('over auto-approve limit needs a human', () => {
  const r = evaluate(req({ amount: 54.5 }), P, [], { now });
  assert.equal(r.decision, 'approve');
  assert.match(r.reasons[0], /auto-approve/);
  assert.equal(r.reasons.length, 1);
});

test('blocked category is denied even when cheap', () => {
  assert.equal(evaluate(req({ category: 'gift_cards', amount: 5 }), P, [], { now }).decision, 'deny');
});

test('category outside the allow list is denied', () => {
  assert.equal(evaluate(req({ category: 'electronics' }), P, [], { now }).decision, 'deny');
});

test('budget counts paid and pending, ignores refunded and old', () => {
  const ledger = [paid(100), paid(40, 0, { status: 'pending' }), paid(500, 0, { status: 'refunded' }), paid(500, 8 * 864e5)];
  assert.equal(committed(ledger, P, now), 140);
  assert.equal(evaluate(req({ amount: 20 }), P, ledger, { now }).decision, 'deny');
  assert.equal(evaluate(req({ amount: 10 }), P, ledger, { now }).decision, 'allow');
});

test('freeze denies everything', () => {
  assert.equal(evaluate(req(), P, [], { now, frozen: true }).decision, 'deny');
});

test('repeat purchase of same item within a day needs approval', () => {
  const r = evaluate(req(), P, [paid(20, 3600e3, { productId: 'X' })], { now });
  assert.equal(r.decision, 'approve');
});

test('velocity limit', () => {
  const ledger = Array.from({ length: 6 }, () => paid(1, 60e3));
  assert.equal(evaluate(req({ amount: 1 }), P, ledger, { now }).decision, 'deny');
});

test('missing justification is denied', () => {
  assert.equal(evaluate(req({ justification: '' }), P, [], { now }).decision, 'deny');
});

test('normalizePolicy drops junk and keeps blocked out of allowed', () => {
  const p = normalizePolicy({ budget: { amount: '200', period: 'year' }, perPurchaseMax: -5, allowedCategories: ['software', 'crypto', 'lol'], blockedCategories: ['crypto'] });
  assert.deepEqual(p.budget, { amount: 200, period: 'week' });
  assert.equal(p.perPurchaseMax, DEFAULT_POLICY.perPurchaseMax);
  assert.deepEqual(p.allowedCategories, ['software']);
});
