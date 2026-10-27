const $ = s => document.querySelector(s);
const money = n => '$' + (+n || 0).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nice = c => c.replace(/_/g, ' ');
let S = null, grid, policyDirty = false;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  if (j.redirect) location.href = j.redirect;
  return j;
}
const act = (fn, btn) => async () => {
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { toast(e.message); } finally { if (btn) btn.disabled = false; }
};

// ---- ledger grid (AG Grid) ----
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function gridTheme() { $('#grid').className = darkQuery.matches ? 'ag-theme-quartz-dark' : 'ag-theme-quartz'; }

grid = agGrid.createGrid($('#grid'), {
  rowData: [],
  getRowId: p => p.data.id,
  animateRows: true,
  getRowClass: p => (p.node.rowPinned ? 'totals' : ''),
  tooltipShowDelay: 200,
  defaultColDef: { sortable: true, resizable: true, filter: true, minWidth: 90 },
  columnDefs: [
    { headerName: 'Time', field: 'at', width: 100, sort: 'desc', valueFormatter: p => p.value && new Date(p.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), filter: false },
    { headerName: 'Item', field: 'name', flex: 2, minWidth: 180, tooltipValueGetter: p => `Agent said: ${p.data.justification}` },
    { headerName: 'Merchant', field: 'merchant', width: 130 },
    { headerName: 'Category', field: 'category', width: 125, valueFormatter: p => nice(p.value) },
    { headerName: 'Amount', field: 'amount', width: 100, type: 'rightAligned', valueFormatter: p => money(p.value), filter: 'agNumberColumnFilter' },
    { headerName: 'Rules', field: 'rules', width: 108, cellRenderer: p => `<span class="st ${{ allow: 'paid', approve: 'pending', deny: 'denied' }[p.value]}">${p.value}</span>`,
      tooltipValueGetter: p => p.data.reasons.join('\n') || 'All checks passed' },
    { headerName: 'AI audit', valueGetter: p => p.data.audit?.verdict, flex: 2, minWidth: 170,
      cellRenderer: p => `<span class="v-${p.value}">${esc(p.value)}</span> <span class="muted">${esc(p.data.audit?.reason)}</span>`,
      tooltipValueGetter: p => p.data.audit?.reason },
    { headerName: 'Result', field: 'status', width: 105, enableCellChangeFlash: true, cellRenderer: p => `<span class="st ${p.value}">${p.value}</span>` },
    { headerName: 'PayPal', valueGetter: p => p.data.paypal?.orderId || '', width: 175, cellClass: 'mono',
      tooltipValueGetter: p => [p.data.paypal?.path, p.data.paypal?.captureId && `capture ${p.data.paypal.captureId}`, p.data.paypal?.refundId && `refund ${p.data.paypal.refundId} ${p.data.paypal.refundStatus || ''}`, p.data.error].filter(Boolean).join(' · ') },
    { headerName: '', field: 'id', width: 92, sortable: false, filter: false, resizable: false,
      cellRenderer: p => {
        if (p.data.status !== 'paid') return '';
        const b = document.createElement('button');
        b.className = 'ghost small';
        b.textContent = 'Refund';
        b.onclick = act(async () => { await api(`/api/entries/${p.value}/refund`); toast('Refunded through PayPal'); }, b);
        return b;
      } },
  ],
});
gridTheme();
darkQuery.addEventListener('change', gridTheme);

// ---- render ----
function render() {
  const { policy: P, ledger, wallet, modes } = S;
  const by = st => ledger.filter(e => e.status === st);
  const sum = arr => arr.reduce((s, e) => s + e.amount, 0);
  const paid = sum(by('paid')), held = sum(by('pending'));

  $('#pills').innerHTML = [
    `AI <b>${modes.ai === 'offline' ? 'offline heuristics' : esc(modes.ai)}</b>`,
    `PayPal <b>${modes.paypal === 'mock' ? 'mock (no keys)' : 'sandbox'}</b>`,
  ].map(h => `<span class="pill">${h}</span>`).join('');

  $('#freeze').setAttribute('aria-pressed', S.frozen);
  $('#freezeLabel').textContent = S.frozen ? 'Frozen: tap to resume' : 'Freeze agent';

  $('#remaining').textContent = money(S.remaining);
  const pct = n => Math.min(100, (n / Math.max(1, P.budget.amount)) * 100) + '%';
  $('#meterPaid').style.width = pct(paid);
  $('#meterHeld').style.width = pct(held);
  $('#paidSum').textContent = money(paid);
  $('#heldSum').textContent = money(held);
  $('#periodLabel').textContent = `of ${money(P.budget.amount)} / ${P.budget.period}`;
  $('#counts').innerHTML = [['paid', by('paid').length], ['held', by('pending').length], ['refused', by('denied').length]]
    .map(([k, n]) => `<div><b>${n}</b><span>${k}</span></div>`).join('');

  if (!policyDirty && document.activeElement !== $('#policyText')) $('#policyText').value = S.policyText;
  $('#chips').innerHTML = [
    ['', `${money(P.budget.amount)} / ${P.budget.period}`],
    ['ask', `ask me over ${money(P.approvalAbove)}`],
    ['', `max ${money(P.perPurchaseMax)} per purchase`],
    ['', `${P.maxPurchasesPerHour} buys / hour`],
    ...P.allowedCategories.map(c => ['yes', nice(c)]),
    ...P.blockedCategories.map(c => ['no', 'no ' + nice(c)]),
  ].map(([k, t]) => `<span class="chip ${k}">${esc(t)}</span>`).join('');
  $('#policySummary').textContent = S.policySummary;

  $('#walletBody').innerHTML = wallet
    ? `<div class="acct"><div class="pp">P</div><div><b>${esc(wallet.email)}</b><span class="muted small">vault ${esc(wallet.vaultId)}</span></div><button class="ghost small" id="forget">Forget</button></div>`
    : `<button class="connect" id="connect">Connect PayPal wallet</button>`;
  $('#forget')?.addEventListener('click', act(() => api('/api/vault/forget')));
  $('#connect')?.addEventListener('click', act(() => api('/api/vault/start'), $('#connect')));

  $('#agentMode').textContent = modes.ai === 'offline' ? 'scripted demo agent (no API key)' : S.run?.scripted ? 'replaying compromised agent' : S.run?.external ? 'external agent over MCP' : `agent: ${modes.ai}`;
  $('#replayWrap').hidden = modes.ai === 'offline';
  const running = S.run?.status === 'running' && !S.run.external;
  $('#runBtn').disabled = running;
  $('#runBtn').textContent = running ? 'Running…' : 'Run agent';
  renderFeed();

  const pend = by('pending');
  $('#queueCount').textContent = pend.length;
  $('#queue').innerHTML = pend.length ? '' : '<div class="none">Nothing needs you right now.</div>';
  for (const e of pend) {
    const el = document.createElement('div');
    el.className = 'qitem';
    el.innerHTML = `<div class="t"><span>${esc(e.name)}</span><span>${money(e.amount)}</span></div>
      <div class="m">${esc(e.merchant)} · ${nice(e.category)} · agent: “${esc(e.justification)}”</div>
      <div class="why">${esc(e.reasons.join('; ') || 'Held by the AI audit')}</div>
      ${e.audit?.verdict !== 'ok' ? `<div class="ai">AI audit: <span class="v-${e.audit.verdict}">${e.audit.verdict}</span>, ${esc(e.audit.reason)}</div>` : ''}
      <div class="btns"><button class="approve">${S.wallet ? 'Approve & pay' : 'Pay with PayPal'}</button><button class="ghost reject">Reject</button></div>`;
    const [a, r] = el.querySelectorAll('button');
    a.onclick = act(async () => {
      const r = await api(`/api/entries/${e.id}/approve`);
      if (r.status) toast(r.status === 'paid' ? 'Paid with PayPal' : `PayPal payment failed: ${r.error || r.status}`);
    }, a);
    r.onclick = act(() => api(`/api/entries/${e.id}/reject`), r);
    $('#queue').append(el);
  }

  grid.setGridOption('rowData', ledger);
  grid.setGridOption('pinnedBottomRowData', [{ id: 'total', at: null, name: `${ledger.length} attempts`, merchant: '', category: '', amount: paid, rules: '', status: 'paid total', paypal: {}, reasons: [], audit: null, justification: '' }]);
}

let shownSteps = -1, shownRun = null;
function renderFeed() {
  const run = S.run, feed = $('#feed');
  if (!run) return;
  if (shownRun !== run.id) { feed.innerHTML = ''; shownRun = run.id; shownSteps = 0; }
  for (const s of run.steps.slice(shownSteps)) {
    const li = document.createElement('li');
    if (s.kind === 'tool') {
      li.className = 'tool';
      li.innerHTML = `<span class="tag">${esc(s.name)}</span>${esc(Object.values(s.input).join(' · '))}`;
    } else if (s.kind === 'page') {
      li.className = 'page';
      li.innerHTML = `<details open><summary><span class="tag">product page</span>${esc(s.name)}</summary><p>${esc(s.text).replaceAll('\n', '<br>')}</p></details>`;
    } else if (s.kind === 'leash') {
      const k = /^PAID/.test(s.text) ? 'paid' : /^HELD/.test(s.text) ? 'held' : 'refused';
      li.className = `leash ${k}`;
      li.innerHTML = `<span class="tag">leash</span>${esc(s.text)}`;
    } else {
      li.className = s.kind;
      li.innerHTML = s.kind === 'say' ? `<span class="tag">agent</span>${esc(s.text)}` : esc(s.text);
    }
    feed.append(li);
  }
  shownSteps = run.steps.length;
  feed.scrollTop = feed.scrollHeight;
}

$('#search').addEventListener('input', ev => grid.setGridOption('quickFilterText', ev.target.value));
$('#csv').addEventListener('click', () => grid.exportDataAsCsv({ fileName: 'leash-ledger.csv', skipPinnedBottom: true }));

// ---- wiring ----
$('#runForm').addEventListener('submit', ev => { ev.preventDefault(); act(() => api('/api/run', { task: $('#task').value, scripted: $('#replay').checked }), $('#runBtn'))(); });
$('#compile').addEventListener('click', act(async () => {
  $('#compile').textContent = 'Compiling…';
  try { const r = await api('/api/policy/compile', { text: $('#policyText').value }); policyDirty = false; toast(`Rules compiled by ${r.by}`); }
  finally { $('#compile').textContent = 'Compile rules'; }
}, $('#compile')));
$('#policyText').addEventListener('input', () => { policyDirty = true; });
$('#freeze').addEventListener('click', act(() => api('/api/freeze', { frozen: !S.frozen })));
$('#reset').addEventListener('click', act(async () => { await api('/api/reset'); shownRun = null; $('#feed').innerHTML = '<li class="empty">Ledger cleared.</li>'; }));

const q = new URLSearchParams(location.search);
if (q.get('vault') === 'saved') toast('PayPal wallet saved for your agents');
if (q.get('paid')) toast('Approved and paid with PayPal');
if (q.get('payfail')) toast('PayPal payment did not go through');
if (q.get('vault') === 'failed') toast('PayPal could not save the wallet. Is Vault enabled on your sandbox app?');
if (q.size) history.replaceState(null, '', '/');

new EventSource('/api/events').onmessage = ev => { S = JSON.parse(ev.data); render(); };
