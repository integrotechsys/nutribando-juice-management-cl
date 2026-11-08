// Daily operations: dashboard, dispatch, reconciliation, shop sales
import { sb, state, isAdmin, esc, tzs, num, today, fmtDate, fmtTime, must, toast, openForm, sum, refresh } from './lib.js';

// ---------- small shared pieces ----------
const dState = (d) => (d.status === 'open' ? 'Out on street' : 'Closed');

function dCard(d) {
  const items = d.dispatch_items || [];
  const bottles = sum(items, (i) => i.qty);
  const value = sum(items, (i) => i.qty * i.unit_price);
  const closed = d.status === 'closed';
  return `<a class="card" href="#/dispatch/${d.id}">
    <div class="row between"><strong>${esc(d.sellers?.name)}</strong><span class="badge ${d.status}">${dState(d)}</span></div>
    <div class="muted">${fmtDate(d.dispatch_date)}</div>
    <div class="row between"><span>${num(bottles)} bottles taken</span>
      <strong>${closed ? 'Collected ' + tzs(d.cash_collected) : tzs(value)}</strong></div></a>`;
}

/** Table of active juices with quantity boxes. */
function itemsEditorHtml(id) {
  const prods = state.products.filter((p) => p.active);
  if (!prods.length) return '<p class="muted">No juices yet — an admin must add them on the Juices page.</p>';
  return `<div class="scroll"><table class="tbl" id="${id}"><thead><tr><th>Juice</th><th class="r">Price</th><th class="r">Bottles</th><th class="r">Total</th></tr></thead><tbody>
    ${prods.map((p) => `<tr data-pid="${p.id}" data-price="${p.price}"><td>${esc(p.name)}${Number(p.price) <= 0 ? ' <span class="warn">⚠ no price</span>' : ''}</td>
      <td class="r">${num(p.price)}</td><td class="r"><input class="qty" type="number" min="0" step="1" inputmode="numeric" value="0"></td><td class="r amt">0</td></tr>`).join('')}
    </tbody><tfoot><tr><th colspan="2">Total</th><th class="r tq">0</th><th class="r ta">0</th></tr></tfoot></table></div>`;
}

function bindItems(root, id) {
  const tbl = root.querySelector('#' + id);
  if (!tbl) return () => [];
  const calc = () => {
    let q = 0, a = 0;
    tbl.querySelectorAll('tbody tr').forEach((tr) => {
      const n = Math.max(0, Math.floor(Number(tr.querySelector('.qty').value) || 0));
      const amt = n * Number(tr.dataset.price);
      tr.querySelector('.amt').textContent = num(amt);
      q += n; a += amt;
    });
    tbl.querySelector('.tq').textContent = num(q);
    tbl.querySelector('.ta').textContent = num(a);
  };
  tbl.addEventListener('input', calc);
  return () =>
    [...tbl.querySelectorAll('tbody tr')]
      .map((tr) => ({ product_id: tr.dataset.pid, qty: Math.max(0, Math.floor(Number(tr.querySelector('.qty').value) || 0)) }))
      .filter((i) => i.qty > 0);
}

// ---------- dashboard ----------
export async function pageDashboard() {
  const t = today();
  const [disp, shop, exp] = await Promise.all([
    sb.from('dispatches').select('*, sellers(name), dispatch_items(qty,unit_price)').or(`status.eq.open,dispatch_date.eq.${t}`).order('created_at', { ascending: false }),
    sb.from('shop_sales').select('amount').eq('sale_date', t),
    isAdmin() ? sb.from('expenses').select('amount').eq('expense_date', t) : Promise.resolve({ data: [] }),
  ]);
  const D = must(disp), S = must(shop), E = must(exp);
  const open = D.filter((d) => d.status === 'open');
  const closedToday = D.filter((d) => d.status === 'closed' && d.dispatch_date === t);
  const street = sum(closedToday, (d) => d.cash_collected);
  const shopTot = sum(S, (s) => s.amount);
  const expTot = sum(E, (e) => e.amount);
  const net = street + shopTot - expTot;
  const noPrice = isAdmin() ? state.products.filter((p) => p.active && Number(p.price) <= 0) : [];

  const html = `
    <h2>Today · ${fmtDate(t)}</h2>
    ${noPrice.length ? `<div class="card err">Set a selling price for: ${esc(noPrice.map((p) => p.name).join(', '))} → <a href="#/products">Juices</a></div>` : ''}
    <div class="row noprint" style="margin-bottom:12px"><a class="btn" href="#/dispatch/new">+ New dispatch</a><a class="btn ghost" href="#/shop">+ Shop sale</a></div>
    <div class="grid">
      <div class="stat"><div class="l">Sellers still out</div><div class="v">${open.length}</div></div>
      <div class="stat"><div class="l">Bottles out now</div><div class="v">${num(sum(open, (d) => sum(d.dispatch_items, (i) => i.qty)))}</div></div>
      <div class="stat"><div class="l">Street cash today</div><div class="v">${tzs(street)}</div></div>
      <div class="stat"><div class="l">Shop sales today</div><div class="v">${tzs(shopTot)}</div></div>
      ${isAdmin() ? `<div class="stat"><div class="l">Expenses today</div><div class="v">${tzs(expTot)}</div></div>
      <div class="stat"><div class="l">Net today</div><div class="v ${net >= 0 ? 'pos' : 'neg'}">${tzs(net)}</div></div>` : ''}
    </div>
    <h3>Out on the street — waiting to be reconciled</h3>
    ${open.length ? open.map(dCard).join('') : '<p class="muted">No seller is out right now.</p>'}
    <h3>Closed today</h3>
    ${closedToday.length ? closedToday.map(dCard).join('') : '<p class="muted">Nothing closed yet today.</p>'}`;
  return { html };
}

// ---------- dispatch list ----------
let listDate = null;
export async function pageDispatchList() {
  listDate ||= today();
  const sel = '*, sellers(name), dispatch_items(qty,unit_price)';
  const [a, b] = await Promise.all([
    sb.from('dispatches').select(sel).eq('status', 'open').order('dispatch_date').order('created_at'),
    sb.from('dispatches').select(sel).eq('dispatch_date', listDate).eq('status', 'closed').order('created_at', { ascending: false }),
  ]);
  const open = must(a), closed = must(b);
  const html = `
    <div class="row between"><h2>Dispatch</h2><a class="btn" href="#/dispatch/new">+ New dispatch</a></div>
    <h3>Out on the street</h3>
    ${open.length ? open.map(dCard).join('') : '<p class="muted">No seller is out right now.</p>'}
    <div class="filters" style="margin-top:14px"><label>Closed dispatches on<input type="date" id="d" value="${listDate}"></label></div>
    ${closed.length ? closed.map(dCard).join('') : '<p class="muted">No closed dispatches on this date.</p>'}`;
  return {
    html,
    bind: (root) => root.querySelector('#d').addEventListener('change', (e) => { listDate = e.target.value || today(); refresh(); }),
  };
}

// ---------- new dispatch ----------
export async function pageDispatchNew() {
  const sellers = state.sellers.filter((s) => s.active);
  const html = `
    <h2>New dispatch</h2>
    ${sellers.length ? '' : '<div class="card err">No active biker sellers yet — an admin must add them on the Sellers page.</div>'}
    <div class="card">
      <div class="row"><label>Biker seller<select id="seller">${sellers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
        <label>Date<input type="date" id="date" value="${today()}"></label></div>
      <div class="spacer"></div>
      ${itemsEditorHtml('ed')}
      <label style="margin-top:10px">Notes (optional)<textarea id="notes" rows="2"></textarea></label>
      <button class="btn" id="go">Dispatch</button>
    </div>`;
  return {
    html,
    bind(root) {
      const getItems = bindItems(root, 'ed');
      root.querySelector('#go').onclick = async (e) => {
        const items = getItems();
        const seller = root.querySelector('#seller').value;
        if (!seller) return toast('Choose a biker seller', 'err');
        if (!items.length) return toast('Enter bottles for at least one juice', 'err');
        e.target.disabled = true;
        try {
          const id = must(await sb.rpc('create_dispatch', {
            p_seller: seller, p_date: root.querySelector('#date').value || null, p_items: items, p_notes: root.querySelector('#notes').value.trim() || null,
          }));
          toast('Dispatch recorded');
          location.hash = '#/dispatch/' + id;
        } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
      };
    },
  };
}

// ---------- dispatch detail: add more / reconcile / close ----------
export async function pageDispatch(id) {
  const d = must(await sb.from('dispatches')
    .select('*, sellers(name,phone), dispatch_items(*, products(name)), dispatch_returns(*, products(name))').eq('id', id).single());
  const loads = [...d.dispatch_items].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const byP = new Map();
  for (const i of loads) {
    const g = byP.get(i.product_id) || { pid: i.product_id, name: i.products?.name, qty: 0, value: 0 };
    g.qty += i.qty; g.value += i.qty * i.unit_price; byP.set(i.product_id, g);
  }
  const groups = [...byP.values()];
  const isOpen = d.status === 'open';
  const adm = isAdmin();
  const totQty = sum(groups, (g) => g.qty), totVal = sum(groups, (g) => g.value);

  const takenTable = `<div class="scroll"><table class="tbl"><thead><tr><th>Juice</th><th class="r">Bottles</th><th class="r">Value</th></tr></thead><tbody>
    ${groups.map((g) => `<tr><td>${esc(g.name)}</td><td class="r">${num(g.qty)}</td><td class="r">${tzs(g.value)}</td></tr>`).join('')}
    </tbody><tfoot><tr><th>Total</th><th class="r">${num(totQty)}</th><th class="r">${tzs(totVal)}</th></tr></tfoot></table></div>`;

  const loadsLog = `<details><summary class="muted">Loads history (${loads.length})</summary><table class="tbl">
    ${loads.map((i) => `<tr><td>${fmtTime(i.created_at)}</td><td>${esc(i.products?.name)}</td><td class="r">${num(i.qty)}</td>
      <td class="r noprint">${adm && isOpen ? `<button class="btn ghost sm" data-eitem="${i.id}" data-q="${i.qty}">Edit</button> <button class="btn danger sm" data-ditem="${i.id}">Delete</button>` : ''}</td></tr>`).join('')}
    </table></details>`;

  const head = `<div class="card">
    <div class="row between"><h2 style="margin:0">${esc(d.sellers?.name)}</h2><span class="badge ${d.status}">${dState(d)}</span></div>
    <div class="muted">${fmtDate(d.dispatch_date)}${d.sellers?.phone ? ' · ' + esc(d.sellers.phone) : ''}${d.notes ? ' · ' + esc(d.notes) : ''}</div>
    <div class="row noprint" style="margin-top:10px"><button class="btn ghost sm" id="print">🖨 Print</button>
      ${adm ? `<button class="btn ghost sm" id="edit">Edit details</button>${!isOpen ? '<button class="btn ghost sm" id="reopen">Re-open</button>' : ''}<button class="btn danger sm" id="del">Delete</button>` : ''}</div>
    </div>
    <div class="card"><h3>Juice taken</h3>${takenTable}${loadsLog}</div>`;

  let body = '';
  if (isOpen) {
    body = `<div class="card noprint"><h3>Add more juice</h3><p class="muted">Seller sold out or needs more? Enter only the extra bottles.</p>
        ${itemsEditorHtml('more')}<button class="btn ghost" id="addmore" style="margin-top:10px">Add to this dispatch</button></div>
      <div class="card"><h3>Reconcile — returned bottles &amp; money</h3>
        <div class="scroll"><table class="tbl" id="recon"><thead><tr><th>Juice</th><th class="r">Taken</th><th class="r">Returned</th><th class="r">Sold</th><th class="r">Amount</th></tr></thead><tbody>
        ${groups.map((g) => `<tr data-pid="${g.pid}" data-out="${g.qty}" data-price="${g.value / g.qty}"><td>${esc(g.name)}</td><td class="r">${num(g.qty)}</td>
          <td class="r"><input class="qty ret" type="number" min="0" max="${g.qty}" step="1" inputmode="numeric" value="0"></td><td class="r sold">${num(g.qty)}</td><td class="r amt">0</td></tr>`).join('')}
        </tbody><tfoot><tr><th>Total</th><th class="r">${num(totQty)}</th><th class="r" id="tret">0</th><th class="r" id="tsold">0</th><th class="r" id="texp">0</th></tr></tfoot></table></div>
        <div class="row" style="margin-top:12px"><label>Money collected (TSh)<input type="number" id="cash" min="0" step="any" inputmode="decimal"></label>
          <div><div class="muted">Difference</div><strong id="diff">—</strong></div></div>
        <label style="margin-top:10px">Notes (optional)<textarea id="rnotes" rows="2"></textarea></label>
        <button class="btn green" id="close">Close dispatch &amp; save</button></div>`;
  } else {
    const r = d.dispatch_returns;
    const diff = Number(d.cash_collected) - Number(d.expected_amount);
    body = `<div class="card"><h3>Result</h3><div class="scroll"><table class="tbl"><thead><tr><th>Juice</th><th class="r">Taken</th><th class="r">Returned</th><th class="r">Sold</th><th class="r">Amount</th></tr></thead><tbody>
      ${r.map((x) => `<tr><td>${esc(x.products?.name)}</td><td class="r">${num(x.qty_out)}</td><td class="r">${num(x.qty_returned)}</td><td class="r">${num(x.qty_sold)}</td><td class="r">${tzs(x.amount)}</td></tr>`).join('')}
      </tbody><tfoot><tr><th>Total</th><th class="r">${num(sum(r, (x) => x.qty_out))}</th><th class="r">${num(sum(r, (x) => x.qty_returned))}</th><th class="r">${num(sum(r, (x) => x.qty_sold))}</th><th class="r">${tzs(d.expected_amount)}</th></tr></tfoot></table></div>
      <div class="grid" style="margin-top:12px"><div class="stat"><div class="l">Expected</div><div class="v">${tzs(d.expected_amount)}</div></div>
      <div class="stat"><div class="l">Collected</div><div class="v">${tzs(d.cash_collected)}</div></div>
      <div class="stat"><div class="l">Difference</div><div class="v ${diff < 0 ? 'neg' : 'pos'}">${diff === 0 ? 'Balanced' : (diff > 0 ? '+' : '') + tzs(diff)}</div></div></div>
      <div class="muted">Closed ${fmtTime(d.closed_at)}</div></div>`;
  }

  return {
    html: `<p class="noprint"><a href="#/dispatch">← Dispatch</a></p>` + head + body,
    bind(root) {
      const on = (sel, fn) => { const el = root.querySelector(sel); if (el) el.onclick = fn; };
      on('#print', () => window.print());

      if (isOpen) {
        const getMore = bindItems(root, 'more');
        on('#addmore', async (e) => {
          const items = getMore();
          if (!items.length) return toast('Enter the extra bottles first', 'err');
          e.target.disabled = true;
          try { must(await sb.rpc('add_dispatch_items', { p_dispatch: id, p_items: items })); toast('Juice added'); refresh(); }
          catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
        });

        const recon = root.querySelector('#recon'), cash = root.querySelector('#cash');
        let touched = false;
        const calc = () => {
          let exp = 0, sold = 0, ret = 0;
          recon.querySelectorAll('tbody tr').forEach((tr) => {
            const out = Number(tr.dataset.out);
            const r = Math.min(Math.max(Math.floor(Number(tr.querySelector('.ret').value) || 0), 0), out);
            const s = out - r, a = Math.round(s * Number(tr.dataset.price));
            tr.querySelector('.sold').textContent = num(s); tr.querySelector('.amt').textContent = num(a);
            exp += a; sold += s; ret += r;
          });
          root.querySelector('#tret').textContent = num(ret);
          root.querySelector('#tsold').textContent = num(sold);
          root.querySelector('#texp').textContent = num(exp);
          if (!touched) cash.value = exp;
          const diff = (Number(cash.value) || 0) - exp;
          const el = root.querySelector('#diff');
          el.textContent = diff === 0 ? 'Balanced' : (diff > 0 ? '+' : '') + tzs(diff);
          el.className = diff < 0 ? 'neg' : 'pos';
          return exp;
        };
        recon.addEventListener('input', calc);
        cash.addEventListener('input', () => { touched = true; calc(); });
        calc();
        on('#close', async (e) => {
          const exp = calc();
          const returns = [...recon.querySelectorAll('tbody tr')].map((tr) => ({
            product_id: tr.dataset.pid,
            qty_returned: Math.min(Math.max(Math.floor(Number(tr.querySelector('.ret').value) || 0), 0), Number(tr.dataset.out)),
          }));
          const collected = Number(cash.value) || 0;
          if (!confirm(`Close this dispatch?\nExpected ${tzs(exp)}\nCollected ${tzs(collected)}`)) return;
          e.target.disabled = true;
          try {
            must(await sb.rpc('close_dispatch', { p_dispatch: id, p_returns: returns, p_cash: collected, p_notes: root.querySelector('#rnotes').value.trim() || null }));
            toast('Dispatch closed'); refresh();
          } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
        });
      }

      if (adm) {
        on('#del', async () => {
          if (!confirm('Delete this whole dispatch and its records? This cannot be undone.')) return;
          try { must(await sb.from('dispatches').delete().eq('id', id)); toast('Deleted'); location.hash = '#/dispatch'; }
          catch (err) { toast(err.message, 'err'); }
        });
        on('#reopen', async () => {
          if (!confirm('Re-open this dispatch? The returns and money recorded will be cleared so you can enter them again.')) return;
          try { must(await sb.rpc('reopen_dispatch', { p_dispatch: id })); toast('Re-opened'); refresh(); }
          catch (err) { toast(err.message, 'err'); }
        });
        on('#edit', () => openForm({
          title: 'Edit dispatch details',
          fields: [
            { key: 'seller_id', label: 'Biker seller', type: 'select', options: state.sellers.map((s) => ({ value: s.id, label: s.name })), required: true },
            { key: 'dispatch_date', label: 'Date', type: 'date', required: true },
            ...(isOpen ? [] : [{ key: 'cash_collected', label: 'Money collected (TSh)', type: 'number', required: true }]),
            { key: 'notes', label: 'Notes', type: 'textarea' },
          ],
          values: d,
          onSubmit: async (v) => { must(await sb.from('dispatches').update({ ...v, notes: v.notes || null }).eq('id', id)); toast('Saved'); refresh(); },
        }));
        root.querySelectorAll('[data-eitem]').forEach((b) => (b.onclick = () => openForm({
          title: 'Edit bottles in this load',
          fields: [{ key: 'qty', label: 'Bottles', type: 'number', required: true }],
          values: { qty: b.dataset.q },
          onSubmit: async (v) => {
            if (!(v.qty > 0)) throw new Error('Bottles must be more than 0 (use Delete to remove the load)');
            must(await sb.from('dispatch_items').update({ qty: Math.floor(v.qty) }).eq('id', b.dataset.eitem)); refresh();
          },
        })));
        root.querySelectorAll('[data-ditem]').forEach((b) => (b.onclick = async () => {
          if (!confirm('Delete this load?')) return;
          try { must(await sb.from('dispatch_items').delete().eq('id', b.dataset.ditem)); refresh(); }
          catch (err) { toast(err.message, 'err'); }
        }));
      }
    },
  };
}

// ---------- shop sales ----------
let shopDate = null;
export async function pageShop() {
  shopDate ||= today();
  const rows = must(await sb.from('shop_sales').select('*, products(name)').eq('sale_date', shopDate).order('created_at', { ascending: false }));
  const adm = isAdmin();
  const prods = state.products.filter((p) => p.active);
  const html = `
    <h2>Shop sales</h2>
    <div class="card"><h3>Record a sale</h3>
      <div class="row"><label>Juice<select id="p">${prods.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label>Type<select id="k"><option value="glass">Glass (drink here)</option><option value="takeaway">Takeaway</option></select></label></div>
      <div class="spacer"></div>
      <div class="row"><label>Quantity<input type="number" id="q" min="1" step="1" value="1" inputmode="numeric"></label>
        <label>Total money (TSh)<input type="number" id="a" min="0" step="any" inputmode="decimal"></label></div>
      <label style="margin-top:10px">Notes (optional)<input id="n"></label>
      <button class="btn" id="add">Save sale</button></div>
    <div class="filters"><label>Sales on<input type="date" id="d" value="${shopDate}"></label></div>
    <div class="card"><div class="scroll"><table class="tbl"><thead><tr><th>Time</th><th>Juice</th><th>Type</th><th class="r">Qty</th><th class="r">Amount</th>${adm ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${fmtTime(r.created_at).slice(-5)}</td><td>${esc(r.products?.name || '')}</td><td>${r.kind === 'glass' ? 'Glass' : 'Takeaway'}</td><td class="r">${num(r.qty)}</td><td class="r">${tzs(r.amount)}</td>
        ${adm ? `<td class="r"><button class="btn ghost sm" data-e="${r.id}">Edit</button> <button class="btn danger sm" data-x="${r.id}">Delete</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="6" class="muted">No sales recorded on this date.</td></tr>`}
      </tbody><tfoot><tr><th colspan="3">Total</th><th class="r">${num(sum(rows, (r) => r.qty))}</th><th class="r">${tzs(sum(rows, (r) => r.amount))}</th>${adm ? '<th></th>' : ''}</tr></tfoot></table></div></div>`;
  return {
    html,
    bind(root) {
      root.querySelector('#d').addEventListener('change', (e) => { shopDate = e.target.value || today(); refresh(); });
      root.querySelector('#add').onclick = async (e) => {
        const amount = Number(root.querySelector('#a').value), qty = Math.floor(Number(root.querySelector('#q').value));
        if (!(qty > 0)) return toast('Enter the quantity', 'err');
        if (!(amount >= 0) || root.querySelector('#a').value === '') return toast('Enter the money received', 'err');
        e.target.disabled = true;
        try {
          must(await sb.from('shop_sales').insert({ sale_date: today(), product_id: root.querySelector('#p').value, kind: root.querySelector('#k').value, qty, amount, notes: root.querySelector('#n').value.trim() || null }));
          toast('Sale saved'); shopDate = today(); refresh();
        } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
      };
      if (adm) {
        root.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => {
          const r = rows.find((x) => x.id === b.dataset.e);
          openForm({
            title: 'Edit shop sale',
            fields: [
              { key: 'sale_date', label: 'Date', type: 'date', required: true },
              { key: 'product_id', label: 'Juice', type: 'select', options: state.products.map((p) => ({ value: p.id, label: p.name })), required: true },
              { key: 'kind', label: 'Type', type: 'select', options: [{ value: 'glass', label: 'Glass' }, { value: 'takeaway', label: 'Takeaway' }] },
              { key: 'qty', label: 'Quantity', type: 'number', required: true },
              { key: 'amount', label: 'Amount (TSh)', type: 'number', required: true },
              { key: 'notes', label: 'Notes', type: 'text' },
            ],
            values: r,
            onSubmit: async (v) => { must(await sb.from('shop_sales').update({ ...v, qty: Math.max(1, Math.floor(v.qty)), notes: v.notes || null }).eq('id', r.id)); toast('Saved'); refresh(); },
          });
        }));
        root.querySelectorAll('[data-x]').forEach((b) => (b.onclick = async () => {
          if (!confirm('Delete this sale?')) return;
          try { must(await sb.from('shop_sales').delete().eq('id', b.dataset.x)); refresh(); } catch (err) { toast(err.message, 'err'); }
        }));
      }
    },
  };
}
