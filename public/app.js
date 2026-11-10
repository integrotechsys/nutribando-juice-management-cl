import { sb, configured, state, isAdmin, esc, toast, loadRefs } from './lib.js';
import { pageDashboard, pageDispatchList, pageDispatchNew, pageDispatch, pageShop } from './pages-ops.js';
import { pageExpenses, pageReports, pageForecast, pageProducts, pageSellers, pageUsers, destroyCharts } from './pages-admin.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const who = document.getElementById('who');

const NAV = [
  { h: '#/', t: 'Home', key: '' },
  { h: '#/dispatch', t: 'Dispatch', key: 'dispatch' },
  { h: '#/shop', t: 'Shop sales', key: 'shop' },
  { h: '#/expenses', t: 'Expenses', key: 'expenses', admin: true },
  { h: '#/reports', t: 'Reports', key: 'reports', admin: true },
  { h: '#/forecast', t: 'Forecast', key: 'forecast', admin: true },
  { h: '#/products', t: 'Juices', key: 'products', admin: true },
  { h: '#/sellers', t: 'Sellers', key: 'sellers', admin: true },
  { h: '#/users', t: 'Staff', key: 'users', admin: true },
];
const ADMIN_ONLY = NAV.filter((n) => n.admin).map((n) => n.key);

// ---------- login ----------
let loginMsg = '';
function showLogin(msg = loginMsg) {
  loginMsg = '';
  nav.innerHTML = ''; who.innerHTML = '';
  app.innerHTML = `<div class="card login"><img src="logo.png" alt="">
    <h2>NutriBando Juice</h2>${msg ? `<p class="neg">${esc(msg)}</p>` : ''}
    <form id="lf"><label>Email<input type="email" name="email" autocomplete="username" required></label>
    <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
    <button class="btn" style="width:100%">Log in</button></form></div>`;
  app.querySelector('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button');
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (error) { toast(error.message === 'Invalid login credentials' ? 'Wrong email or password' : error.message, 'err'); btn.disabled = false; }
  };
}

function showSetup() {
  app.innerHTML = `<div class="card"><h2>Almost there</h2><p>Open <b>public/config.js</b> and paste your Supabase <b>Project URL</b> and <b>anon public key</b>
    (Supabase → Project Settings → API). Then redeploy. Full steps are in README.md.</p></div>`;
}

// ---------- session ----------
async function setSession(session) {
  if (!session) { state.user = null; state.profile = null; return showLogin(); }
  const { data: profile, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error || !profile) { loginMsg = 'Your account has no profile yet. Admin: run supabase/fix-profiles.sql in Supabase, then log in again.'; await sb.auth.signOut(); return; }
  if (!profile.active) { loginMsg = 'Your account is switched off. Ask the admin.'; await sb.auth.signOut(); return; }
  state.user = session.user; state.profile = profile;
  try { await loadRefs(); } catch (e) { toast(e.message, 'err'); }
  who.innerHTML = `${esc(profile.full_name)} · ${isAdmin() ? 'Admin' : 'Staff'} <button class="btn ghost sm" id="out">Log out</button>`;
  who.querySelector('#out').onclick = () => sb.auth.signOut();
  render();
}

// ---------- router ----------
let token = 0;
async function render() {
  if (!state.user) return;
  const my = ++token;
  const [, page = '', arg] = location.hash.split('/');
  nav.innerHTML = NAV.filter((n) => !n.admin || isAdmin())
    .map((n) => `<a href="${n.h}" class="${n.key === page ? 'on' : ''}">${n.t}</a>`).join('');
  if (ADMIN_ONLY.includes(page) && !isAdmin()) { app.innerHTML = '<div class="card err">Only the admin can open this page.</div>'; return; }

  app.innerHTML = '<div class="loading">Loading…</div>';
  try {
    let res;
    switch (page) {
      case '': res = await pageDashboard(); break;
      case 'dispatch': res = arg === 'new' ? await pageDispatchNew() : arg ? await pageDispatch(arg) : await pageDispatchList(); break;
      case 'shop': res = await pageShop(); break;
      case 'expenses': res = await pageExpenses(); break;
      case 'reports': res = await pageReports(); break;
      case 'forecast': res = await pageForecast(); break;
      case 'products': res = await pageProducts(); break;
      case 'sellers': res = await pageSellers(); break;
      case 'users': res = await pageUsers(); break;
      default: res = { html: '<div class="card">Page not found. <a href="#/">Go home</a></div>' };
    }
    if (my !== token) return;       // user already navigated elsewhere
    destroyCharts();
    app.innerHTML = res.html;
    res.bind?.(app);
    window.scrollTo(0, 0);
  } catch (e) {
    if (my !== token) return;
    app.innerHTML = `<div class="card err">Something went wrong: ${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', render);

// ---------- start ----------
(async function boot() {
  if (!configured) return showSetup();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const { data: { session } } = await sb.auth.getSession();
  await setSession(session);
  sb.auth.onAuthStateChange((ev, s) => {
    if (ev === 'SIGNED_OUT') setTimeout(() => setSession(null), 0);
    else if (ev === 'SIGNED_IN' && s?.user?.id !== state.user?.id) setTimeout(() => setSession(s), 0);
  });
})();
