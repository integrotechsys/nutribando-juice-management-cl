import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
export * from './dates.js';
export { sum } from './forecast.js';

export const configured = !SUPABASE_URL.startsWith('YOUR-') && !SUPABASE_ANON_KEY.startsWith('YOUR-');
export const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export const state = { user: null, profile: null, products: [], sellers: [] };
export const isAdmin = () => state.profile?.role === 'admin';

// ---------- formatting ----------
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const tzs = (n) => 'TSh ' + Math.round(Number(n) || 0).toLocaleString('en-US');
export const num = (n) => (Number(n) || 0).toLocaleString('en-US');

// ---------- data ----------
export function must(res) {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Supabase returns max 1000 rows per request — this pages through all of them. */
export async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

export async function loadRefs() {
  const [p, s] = await Promise.all([
    sb.from('products').select('*').order('sort_order').order('name'),
    sb.from('sellers').select('*').order('name'),
  ]);
  state.products = must(p);
  state.sellers = must(s);
}

// ---------- UI helpers ----------
export function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 4500);
}

function fieldHtml(f, v) {
  const req = f.required ? 'required' : '';
  const val = v ?? f.default ?? '';
  if (f.type === 'checkbox')
    return `<label class="check"><input type="checkbox" name="${f.key}" ${(v ?? f.default) ? 'checked' : ''}> ${esc(f.label)}</label>`;
  let input;
  if (f.type === 'select')
    input = `<select name="${f.key}" ${req}>${f.options
      .map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${esc(o.label)}</option>`)
      .join('')}</select>`;
  else if (f.type === 'textarea') input = `<textarea name="${f.key}" rows="2" ${req}>${esc(val)}</textarea>`;
  else
    input = `<input name="${f.key}" type="${f.type || 'text'}" value="${esc(val)}" ${req} ${
      f.type === 'number' ? 'inputmode="decimal" step="any" min="0"' : ''
    }>`;
  return `<label>${esc(f.label)}${input}</label>`;
}

/** Pop-up form. fields: [{key,label,type,required,options,default}] */
export function openForm({ title, fields, values = {}, submitText = 'Save', onSubmit }) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form class="form"><h3>${esc(title)}</h3>${fields.map((f) => fieldHtml(f, values[f.key])).join('')}
    <div class="row end"><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn">${esc(submitText)}</button></div></form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector('[data-cancel]').onclick = close;
  dlg.addEventListener('cancel', () => dlg.remove());
  form.onsubmit = async (e) => {
    e.preventDefault();
    const out = {};
    for (const f of fields) {
      const el = form.elements[f.key];
      if (f.type === 'checkbox') out[f.key] = el.checked;
      else if (f.type === 'number') out[f.key] = el.value === '' ? null : Number(el.value);
      else out[f.key] = el.value.trim();
    }
    const btn = form.querySelector('button:not([data-cancel])');
    btn.disabled = true;
    try { await onSubmit(out); close(); }
    catch (err) { toast(err.message, 'err'); btn.disabled = false; }
  };
  dlg.showModal();
}

export function downloadCsv(name, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Re-draw the current page (after saving something). */
export const refresh = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
