// Admin pages: expenses, reports, forecast, juices, sellers, users
import { sb, state, esc, tzs, num, today, addDays, daysBetween, monthStart, fmtDate, must, fetchAll, toast, openForm, sum, refresh, loadRefs, downloadCsv } from './lib.js';
import { dailySeries, project, total } from './forecast.js';

const CATS = ['Fruits & ingredients', 'Bottles & packaging', 'Fuel & transport', 'Wages & commission', 'Rent', 'Utilities (power, water, gas)', 'Marketing', 'Equipment & repairs', 'Other'];

let charts = [];
export const destroyCharts = () => { charts.forEach((c) => c.destroy()); charts = []; };
function drawChart(canvas, config) {
  if (!window.Chart || !canvas) return;
  charts.push(new window.Chart(canvas, { ...config, options: { responsive: true, maintainAspectRatio: false, ...config.options } }));
}

// ---------- date-range bar (expenses + reports) ----------
function rangeBarHtml(r) {
  return `<div class="tabs noprint"><button class="btn ghost sm" data-p="today">Today</button><button class="btn ghost sm" data-p="7">Last 7 days</button>
    <button class="btn ghost sm" data-p="30">Last 30 days</button><button class="btn ghost sm" data-p="month">This month</button></div>
    <div class="filters noprint"><label>From<input type="date" id="rf" value="${r.from}"></label><label>To<input type="date" id="rt" value="${r.to}"></label>
    <button class="btn" id="apply">Apply</button></div>`;
}
function bindRange(root, r) {
  const set = (f, t) => { r.from = f; r.to = t; refresh(); };
  root.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => {
    const t = today(), p = b.dataset.p;
    if (p === 'today') set(t, t);
    else if (p === 'month') set(monthStart(t), t);
    else set(addDays(t, -(Number(p) - 1)), t);
  }));
  root.querySelector('#apply').onclick = () => {
    const f = root.querySelector('#rf').value, t = root.querySelector('#rt').value;
    if (!f || !t || f > t) return toast('Choose a valid date range', 'err');
    set(f, t);
  };
}

// ---------- expenses ----------
const exRange = { from: monthStart(today()), to: today() };
export async function pageExpenses() {
  const rows = await fetchAll(() => sb.from('expenses').select('*').gte('expense_date', exRange.from).lte('expense_date', exRange.to).order('expense_date', { ascending: false }).order('id'));
  const byCat = {};
  rows.forEach((r) => (byCat[r.category] = (byCat[r.category] || 0) + Number(r.amount)));
  const catOpts = CATS.map((c) => ({ value: c, label: c }));
  const html = `
    <h2>Expenses</h2>
    <div class="card"><h3>Record an expense</h3>
      <div class="row"><label>Date<input type="date" id="ed" value="${today()}"></label>
        <label>Category<select id="ec">${CATS.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label></div>
      <div class="spacer"></div>
      <div class="row"><label>Description<input id="edesc" placeholder="e.g. 20kg mangoes"></label>
        <label>Amount (TSh)<input type="number" id="eam" min="0" step="any" inputmode="decimal"></label></div>
      <button class="btn" id="eadd" style="margin-top:10px">Save expense</button></div>
    ${rangeBarHtml(exRange)}
    <div class="grid"><div class="stat"><div class="l">Total (${fmtDate(exRange.from)} – ${fmtDate(exRange.to)})</div><div class="v">${tzs(sum(rows, (r) => r.amount))}</div></div>
      ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<div class="stat"><div class="l">${esc(c)}</div><div class="v">${tzs(v)}</div></div>`).join('')}</div>
    <div class="card"><div class="scroll"><table class="tbl"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="r">Amount</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${fmtDate(r.expense_date)}</td><td>${esc(r.category)}</td><td>${esc(r.description)}</td><td class="r">${tzs(r.amount)}</td>
        <td class="r"><button class="btn ghost sm" data-e="${r.id}">Edit</button> <button class="btn danger sm" data-x="${r.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No expenses in this period.</td></tr>'}
      </tbody></table></div></div>`;
  return {
    html,
    bind(root) {
      bindRange(root, exRange);
      root.querySelector('#eadd').onclick = async (e) => {
        const amount = root.querySelector('#eam').value;
        if (amount === '' || Number(amount) < 0) return toast('Enter the amount', 'err');
        e.target.disabled = true;
        try {
          must(await sb.from('expenses').insert({ expense_date: root.querySelector('#ed').value || today(), category: root.querySelector('#ec').value, description: root.querySelector('#edesc').value.trim() || null, amount: Number(amount) }));
          toast('Expense saved'); refresh();
        } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
      };
      root.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => {
        const r = rows.find((x) => x.id === b.dataset.e);
        openForm({
          title: 'Edit expense',
          fields: [{ key: 'expense_date', label: 'Date', type: 'date', required: true }, { key: 'category', label: 'Category', type: 'select', options: catOpts, required: true },
            { key: 'description', label: 'Description', type: 'text' }, { key: 'amount', label: 'Amount (TSh)', type: 'number', required: true }],
          values: r,
          onSubmit: async (v) => { must(await sb.from('expenses').update({ ...v, description: v.description || null }).eq('id', r.id)); toast('Saved'); refresh(); },
        });
      }));
      root.querySelectorAll('[data-x]').forEach((b) => (b.onclick = async () => {
        if (!confirm('Delete this expense?')) return;
        try { must(await sb.from('expenses').delete().eq('id', b.dataset.x)); refresh(); } catch (err) { toast(err.message, 'err'); }
      }));
    },
  };
}

// ---------- reports ----------
const rpRange = { from: monthStart(today()), to: today() };
export async function pageReports() {
  const { from, to } = rpRange;
  const [disp, rets, shop, exps, pend] = await Promise.all([
    fetchAll(() => sb.from('dispatches').select('id,dispatch_date,seller_id,cash_collected,expected_amount,sellers(name)').eq('status', 'closed').gte('dispatch_date', from).lte('dispatch_date', to).order('dispatch_date').order('id')),
    fetchAll(() => sb.from('dispatch_returns').select('id,qty_out,qty_returned,qty_sold,amount,products(name),dispatches!inner(dispatch_date,status,seller_id,sellers(name))').eq('dispatches.status', 'closed').gte('dispatches.dispatch_date', from).lte('dispatches.dispatch_date', to).order('id')),
    fetchAll(() => sb.from('shop_sales').select('id,sale_date,qty,amount').gte('sale_date', from).lte('sale_date', to).order('id')),
    fetchAll(() => sb.from('expenses').select('id,expense_date,category,amount').gte('expense_date', from).lte('expense_date', to).order('id')),
    sb.from('dispatches').select('id', { count: 'exact', head: true }).eq('status', 'open').gte('dispatch_date', from).lte('dispatch_date', to),
  ]);

  const days = new Map();
  const day = (d) => { if (!days.has(d)) days.set(d, { street: 0, shop: 0, exp: 0 }); return days.get(d); };
  disp.forEach((d) => (day(d.dispatch_date).street += Number(d.cash_collected)));
  shop.forEach((s) => (day(s.sale_date).shop += Number(s.amount)));
  exps.forEach((e) => (day(e.expense_date).exp += Number(e.amount)));
  const dayRows = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const street = sum(disp, (d) => d.cash_collected), shopT = sum(shop, (s) => s.amount), expT = sum(exps, (e) => e.amount);
  const revenue = street + shopT, profit = revenue - expT;
  const shortfall = sum(disp, (d) => Number(d.expected_amount) - Number(d.cash_collected));
  const bottlesSold = sum(rets, (r) => r.qty_sold);

  const prod = new Map();
  rets.forEach((r) => { const k = r.products?.name || '?'; const g = prod.get(k) || { out: 0, ret: 0, sold: 0, amt: 0 }; g.out += r.qty_out; g.ret += r.qty_returned; g.sold += r.qty_sold; g.amt += Number(r.amount); prod.set(k, g); });

  const sel = new Map();
  disp.forEach((d) => { const k = d.seller_id; const g = sel.get(k) || { name: d.sellers?.name, trips: 0, out: 0, ret: 0, sold: 0, exp: 0, cash: 0 }; g.trips++; g.exp += Number(d.expected_amount); g.cash += Number(d.cash_collected); sel.set(k, g); });
  rets.forEach((r) => { const k = r.dispatches.seller_id; const g = sel.get(k); if (g) { g.out += r.qty_out; g.ret += r.qty_returned; g.sold += r.qty_sold; } });

  const cat = new Map();
  exps.forEach((e) => cat.set(e.category, (cat.get(e.category) || 0) + Number(e.amount)));

  const pn = (n) => `<span class="${n >= 0 ? 'pos' : 'neg'}">${tzs(n)}</span>`;
  const html = `
    <h2>Reports</h2>${rangeBarHtml(rpRange)}
    ${pend.count ? `<div class="card err">${pend.count} dispatch(es) in this period are still open (not reconciled) and are not counted yet.</div>` : ''}
    <div class="grid">
      <div class="stat"><div class="l">Revenue (cash received)</div><div class="v">${tzs(revenue)}</div></div>
      <div class="stat"><div class="l">Expenses</div><div class="v">${tzs(expT)}</div></div>
      <div class="stat"><div class="l">Profit</div><div class="v">${pn(profit)}</div></div>
      <div class="stat"><div class="l">Street cash</div><div class="v">${tzs(street)}</div></div>
      <div class="stat"><div class="l">Shop sales</div><div class="v">${tzs(shopT)}</div></div>
      <div class="stat"><div class="l">Street bottles sold</div><div class="v">${num(bottlesSold)}</div></div>
      <div class="stat"><div class="l">Cash short (expected − collected)</div><div class="v ${shortfall > 0 ? 'neg' : ''}">${tzs(shortfall)}</div></div>
    </div>
    <div class="card"><h3>Revenue vs expenses per day</h3><div class="chart-box"><canvas id="ch"></canvas></div></div>
    <div class="card"><div class="row between"><h3>By day</h3><button class="btn ghost sm noprint" id="csv">Download CSV</button></div><div class="scroll"><table class="tbl"><thead><tr><th>Date</th><th class="r">Street</th><th class="r">Shop</th><th class="r">Expenses</th><th class="r">Profit</th></tr></thead><tbody>
      ${[...dayRows].reverse().map(([d, v]) => `<tr><td>${fmtDate(d)}</td><td class="r">${num(v.street)}</td><td class="r">${num(v.shop)}</td><td class="r">${num(v.exp)}</td><td class="r">${pn(v.street + v.shop - v.exp)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No data in this period.</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><h3>By juice (street)</h3><div class="scroll"><table class="tbl"><thead><tr><th>Juice</th><th class="r">Taken</th><th class="r">Returned</th><th class="r">Sold</th><th class="r">Value sold</th></tr></thead><tbody>
      ${[...prod.entries()].sort((a, b) => b[1].amt - a[1].amt).map(([k, g]) => `<tr><td>${esc(k)}</td><td class="r">${num(g.out)}</td><td class="r">${num(g.ret)}</td><td class="r">${num(g.sold)}</td><td class="r">${tzs(g.amt)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No data.</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><h3>By biker seller</h3><div class="scroll"><table class="tbl"><thead><tr><th>Seller</th><th class="r">Trips</th><th class="r">Taken</th><th class="r">Returned</th><th class="r">Sold</th><th class="r">Expected</th><th class="r">Collected</th><th class="r">Diff</th></tr></thead><tbody>
      ${[...sel.values()].sort((a, b) => b.cash - a.cash).map((g) => `<tr><td>${esc(g.name)}</td><td class="r">${g.trips}</td><td class="r">${num(g.out)}</td><td class="r">${num(g.ret)}</td><td class="r">${num(g.sold)}</td><td class="r">${num(g.exp)}</td><td class="r">${num(g.cash)}</td><td class="r">${pn(g.cash - g.exp)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No data.</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><h3>Expenses by category</h3><table class="tbl"><tbody>
      ${[...cat.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${tzs(v)}</td></tr>`).join('') || '<tr><td class="muted">No expenses.</td></tr>'}
      </tbody></table></div>`;

  return {
    html,
    bind(root) {
      bindRange(root, rpRange);
      drawChart(root.querySelector('#ch'), {
        type: 'bar',
        data: { labels: dayRows.map(([d]) => fmtDate(d).slice(0, 6)), datasets: [
          { label: 'Revenue', data: dayRows.map(([, v]) => v.street + v.shop), backgroundColor: '#ef4446' },
          { label: 'Expenses', data: dayRows.map(([, v]) => v.exp), backgroundColor: '#8896a5' } ] },
      });
      root.querySelector('#csv').onclick = () => downloadCsv(`nutribando-report-${from}-to-${to}.csv`,
        [['Date', 'Street cash', 'Shop sales', 'Expenses', 'Profit'], ...dayRows.map(([d, v]) => [d, v.street, v.shop, v.exp, v.street + v.shop - v.exp])]);
    },
  };
}

// ---------- forecast ----------
let scenario = 1;
export async function pageForecast() {
  const t = today(), to = addDays(t, -1), from0 = addDays(t, -179);
  const [disp, shop, exps, rets] = await Promise.all([
    fetchAll(() => sb.from('dispatches').select('id,dispatch_date,cash_collected').eq('status', 'closed').gte('dispatch_date', from0).lte('dispatch_date', to).order('id')),
    fetchAll(() => sb.from('shop_sales').select('id,sale_date,amount').gte('sale_date', from0).lte('sale_date', to).order('id')),
    fetchAll(() => sb.from('expenses').select('id,expense_date,amount').gte('expense_date', from0).lte('expense_date', to).order('id')),
    fetchAll(() => sb.from('dispatch_returns').select('id,qty_sold,products(name),dispatches!inner(dispatch_date,status)').eq('dispatches.status', 'closed').gte('dispatches.dispatch_date', from0).lte('dispatches.dispatch_date', to).order('id')),
  ]);
  const revMap = {}, expMap = {};
  disp.forEach((d) => (revMap[d.dispatch_date] = (revMap[d.dispatch_date] || 0) + Number(d.cash_collected)));
  shop.forEach((s) => (revMap[s.sale_date] = (revMap[s.sale_date] || 0) + Number(s.amount)));
  exps.forEach((e) => (expMap[e.expense_date] = (expMap[e.expense_date] || 0) + Number(e.amount)));
  const dates = [...Object.keys(revMap), ...Object.keys(expMap)].sort();
  if (!dates.length)
    return { html: '<h2>Forecast</h2><div class="card">No sales or expenses recorded yet. Once you have closed some dispatches, forecasts will appear here.</div>' };
  const start = dates[0] > addDays(to, -89) ? dates[0] : addDays(to, -89);
  if (start > to)
    return { html: '<h2>Forecast</h2><div class="card">Today is your first day of data — come back tomorrow, forecasts use completed days.</div>' };

  const rev = dailySeries(revMap, start, to), exp = dailySeries(expMap, start, to), n = rev.length;
  const pRev = project(rev, 90, { trend: true, seasonal: true }).map((p) => ({ ...p, v: p.v * scenario }));
  const pExp = project(exp, 90, { trend: false, seasonal: false });
  const avgRev = sum(rev, (x) => x.v) / n, avgExp = sum(exp, (x) => x.v) / n;

  // bottles per juice, based on the last 28 days
  const w = Math.min(n, 28), ws = addDays(to, -(w - 1));
  const sold = new Map();
  rets.filter((r) => r.dispatches.dispatch_date >= ws).forEach((r) => sold.set(r.products?.name || '?', (sold.get(r.products?.name || '?') || 0) + r.qty_sold));
  const prodRows = [...sold.entries()].map(([k, q]) => ({ k, perDay: q / w })).sort((a, b) => b.perDay - a.perDay);

  const H = [30, 60, 90];
  const pn = (v) => `<span class="${v >= 0 ? 'pos' : 'neg'}">${tzs(v)}</span>`;
  const html = `
    <h2>Forecast</h2>
    <div class="card"><div class="muted">Based on ${n} day${n === 1 ? '' : 's'} of records (${fmtDate(start)} – ${fmtDate(to)}). This is an estimate from your own recent trend${n >= 28 ? ' and weekday pattern' : ''} — it gets more accurate as records grow.</div>
      ${n < 14 ? '<div class="warn" style="margin-top:6px">Less than 14 days of history: these numbers are rough averages only.</div>' : ''}
      <label style="margin-top:10px;max-width:300px">Scenario<select id="sc">
        <option value="0.85" ${scenario === 0.85 ? 'selected' : ''}>Cautious (sales −15%)</option>
        <option value="1" ${scenario === 1 ? 'selected' : ''}>Expected</option>
        <option value="1.15" ${scenario === 1.15 ? 'selected' : ''}>Optimistic (sales +15%)</option></select></label></div>
    <div class="card"><h3>Projection</h3><div class="scroll"><table class="tbl"><thead><tr><th>Next</th><th class="r">Revenue</th><th class="r">Expenses</th><th class="r">Profit</th><th class="r">Bottles to prepare (street)</th></tr></thead><tbody>
      ${H.map((h) => { const r = total(pRev, h), e = total(pExp, h); return `<tr><td><strong>${h} days</strong></td><td class="r">${tzs(r)}</td><td class="r">${tzs(e)}</td><td class="r">${pn(r - e)}</td><td class="r">${num(Math.round(sum(prodRows, (p) => p.perDay) * h))}</td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="muted" style="margin-top:6px">Now: about ${tzs(avgRev)} revenue and ${tzs(avgExp)} expenses per day on average. Expenses are projected at your recent daily average.</div></div>
    <div class="card"><h3>Revenue trend (7-day average) and forecast</h3><div class="chart-box"><canvas id="fc"></canvas></div></div>
    <div class="card"><h3>Juice demand (street bottles, last ${w} days average)</h3><div class="scroll"><table class="tbl"><thead><tr><th>Juice</th><th class="r">Per day</th><th class="r">Next 30 days</th><th class="r">Next 90 days</th></tr></thead><tbody>
      ${prodRows.map((p) => `<tr><td>${esc(p.k)}</td><td class="r">${p.perDay.toFixed(1)}</td><td class="r">${num(Math.round(p.perDay * 30))}</td><td class="r">${num(Math.round(p.perDay * 90))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No bottle sales yet.</td></tr>'}
      </tbody></table></div></div>`;

  return {
    html,
    bind(root) {
      root.querySelector('#sc').onchange = (e) => { scenario = Number(e.target.value); refresh(); };
      const past = rev.slice(-30);
      const all = [...past, ...pRev];
      const ma = all.map((_, i) => { const a = all.slice(Math.max(0, i - 6), i + 1); return Math.round(sum(a, (x) => x.v) / a.length); });
      const lastA = past.length - 1;
      drawChart(root.querySelector('#fc'), {
        type: 'line',
        data: { labels: all.map((x) => fmtDate(x.date).slice(0, 6)), datasets: [
          { label: 'Actual', data: ma.map((v, i) => (i <= lastA ? v : null)), borderColor: '#ef4446', backgroundColor: '#ef4446', pointRadius: 0, tension: .3 },
          { label: 'Forecast', data: ma.map((v, i) => (i >= lastA ? v : null)), borderColor: '#38b54a', backgroundColor: '#38b54a', borderDash: [6, 4], pointRadius: 0, tension: .3 },
          { label: 'Avg daily expenses', data: all.map(() => Math.round(avgExp)), borderColor: '#8896a5', borderDash: [2, 3], pointRadius: 0 } ] },
        options: { scales: { x: { ticks: { maxTicksLimit: 8 } } } },
      });
    },
  };
}

// ---------- juices (products) ----------
export async function pageProducts() {
  await loadRefs();
  const list = state.products;
  const fields = [{ key: 'name', label: 'Juice name', type: 'text', required: true }, { key: 'price', label: 'Selling price per 1L bottle (TSh)', type: 'number', required: true }, { key: 'active', label: 'Active (can be dispatched)', type: 'checkbox', default: true }];
  const html = `
    <div class="row between"><h2>Juices &amp; prices</h2><button class="btn" id="add">+ Add juice</button></div>
    <p class="muted">Changing a price affects new dispatches only — past records keep the price they were sold at.</p>
    <div class="card"><table class="tbl"><thead><tr><th>Juice</th><th class="r">Price</th><th></th></tr></thead><tbody>
      ${list.map((p) => `<tr><td>${esc(p.name)} ${p.active ? '' : '<span class="badge off">inactive</span>'}</td><td class="r">${Number(p.price) > 0 ? tzs(p.price) : '<span class="warn">not set</span>'}</td>
        <td class="r"><button class="btn ghost sm" data-e="${p.id}">Edit</button> <button class="btn danger sm" data-x="${p.id}">Delete</button></td></tr>`).join('')}
      </tbody></table></div>`;
  return {
    html,
    bind(root) {
      root.querySelector('#add').onclick = () => openForm({
        title: 'Add juice', fields, values: { active: true },
        onSubmit: async (v) => { must(await sb.from('products').insert({ ...v, sort_order: (Math.max(0, ...list.map((p) => p.sort_order)) + 1) })); toast('Added'); refresh(); },
      });
      root.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => {
        const p = list.find((x) => x.id === b.dataset.e);
        openForm({ title: 'Edit juice', fields, values: p, onSubmit: async (v) => { must(await sb.from('products').update(v).eq('id', p.id)); toast('Saved'); refresh(); } });
      }));
      root.querySelectorAll('[data-x]').forEach((b) => (b.onclick = async () => {
        if (!confirm('Delete this juice?')) return;
        const res = await sb.from('products').delete().eq('id', b.dataset.x);
        if (res.error) return toast(res.error.code === '23503' ? 'This juice is used in past records — untick "Active" instead of deleting.' : res.error.message, 'err');
        toast('Deleted'); refresh();
      }));
    },
  };
}

// ---------- biker sellers ----------
export async function pageSellers() {
  await loadRefs();
  const list = state.sellers;
  const fields = [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'phone', label: 'Phone (optional)', type: 'tel' }, { key: 'active', label: 'Active', type: 'checkbox', default: true }];
  const html = `
    <div class="row between"><h2>Biker sellers</h2><button class="btn" id="add">+ Add seller</button></div>
    <p class="muted">Sellers do not log in — you or your staff record their dispatches.</p>
    <div class="card"><table class="tbl"><tbody>
      ${list.map((s) => `<tr><td>${esc(s.name)} ${s.active ? '' : '<span class="badge off">inactive</span>'}<div class="muted">${esc(s.phone)}</div></td>
        <td class="r"><button class="btn ghost sm" data-e="${s.id}">Edit</button> <button class="btn danger sm" data-x="${s.id}">Delete</button></td></tr>`).join('') || '<tr><td class="muted">No sellers yet.</td></tr>'}
      </tbody></table></div>`;
  return {
    html,
    bind(root) {
      root.querySelector('#add').onclick = () => openForm({
        title: 'Add biker seller', fields, values: { active: true },
        onSubmit: async (v) => { must(await sb.from('sellers').insert({ ...v, phone: v.phone || null })); toast('Added'); refresh(); },
      });
      root.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => {
        const s = list.find((x) => x.id === b.dataset.e);
        openForm({ title: 'Edit seller', fields, values: s, onSubmit: async (v) => { must(await sb.from('sellers').update({ ...v, phone: v.phone || null }).eq('id', s.id)); toast('Saved'); refresh(); } });
      }));
      root.querySelectorAll('[data-x]').forEach((b) => (b.onclick = async () => {
        if (!confirm('Delete this seller?')) return;
        const res = await sb.from('sellers').delete().eq('id', b.dataset.x);
        if (res.error) return toast(res.error.code === '23503' ? 'This seller has past dispatches — untick "Active" instead of deleting.' : res.error.message, 'err');
        toast('Deleted'); refresh();
      }));
    },
  };
}

// ---------- staff users ----------
export async function pageUsers() {
  const users = must(await sb.from('profiles').select('*').order('created_at'));
  const me = state.user.id;
  const html = `
    <h2>Staff &amp; users</h2>
    <div class="card"><h3>How to add a staff member</h3>
      <ol class="muted" style="margin:0;padding-left:20px"><li>Open your Supabase project → <b>Authentication → Users → Add user → Create new user</b>.</li>
      <li>Enter their email and a password, and tick <b>Auto Confirm User</b>.</li>
      <li>They appear below as <b>Staff</b>. You can rename them, make someone Admin, or deactivate them.</li></ol></div>
    <div class="card"><table class="tbl"><thead><tr><th>Name</th><th>Role</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr><td>${esc(u.full_name)}<div class="muted">${esc(u.email)}</div></td>
        <td>${u.role === 'admin' ? 'Admin' : 'Staff'} ${u.active ? '' : '<span class="badge off">inactive</span>'}</td>
        <td class="r"><button class="btn ghost sm" data-e="${u.id}">Edit</button></td></tr>`).join('')}
      </tbody></table></div>`;
  return {
    html,
    bind(root) {
      root.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => {
        const u = users.find((x) => x.id === b.dataset.e);
        const self = u.id === me;
        openForm({
          title: 'Edit user',
          fields: [{ key: 'full_name', label: 'Name', type: 'text', required: true },
            ...(self ? [] : [{ key: 'role', label: 'Role', type: 'select', options: [{ value: 'staff', label: 'Staff — dispatch, add juice, reconcile' }, { value: 'admin', label: 'Admin — full access' }] },
              { key: 'active', label: 'Active (can log in)', type: 'checkbox' }])],
          values: u,
          onSubmit: async (v) => { must(await sb.from('profiles').update(v).eq('id', u.id)); toast('Saved'); refresh(); },
        });
      }));
    },
  };
}
