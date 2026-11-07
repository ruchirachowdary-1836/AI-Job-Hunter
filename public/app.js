// AI Job Hunter — single-page frontend (no build step).

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { me: null };

// ---------- icons ----------
const I = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>',
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>',
  tracker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/></svg>',
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  prefs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M10 21v-4h4v4"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12l5 5L20 7"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h0"/></svg>',
};

// ---------- api ----------
async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/login')) { state.me = null; go('#/login'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show${err ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 2800);
}

async function busy(btn, fn) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span>${btn.dataset.busy || 'Working…'}`;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.innerHTML = html; }
}

// ---------- formatting ----------
const fmtMoney = (n) => {
  if (n == null) return '';
  if (n >= 100000) return `₹${(n / 100000).toFixed(n % 100000 ? 1 : 0)}L`;
  if (n >= 1000) return `₹${Math.round(n / 1000)}k`;
  return `₹${Math.round(n)}`;
};
function salary(j) {
  if (!j.salary_min && !j.salary_max) return '';
  const range = j.salary_min && j.salary_max && j.salary_min !== j.salary_max
    ? `${fmtMoney(j.salary_min)}–${fmtMoney(j.salary_max)}` : fmtMoney(j.salary_max || j.salary_min);
  return `${range}${j.salary_period === 'month' ? '/mo' : '/yr'}${j.salary_text === 'estimated' ? ' (est.)' : ''}`;
}
function ago(iso) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso)) / 864e5);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString();
}
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const scoreClass = (s) => (s >= 70 ? '' : s >= 45 ? 'mid' : 'low');

// ---------- router ----------
const routes = { login: viewAuth, today: viewToday, review: viewReview, tracker: viewTracker, profile: viewProfile, preferences: viewPrefs };
const go = (hash) => { if (location.hash !== hash) location.hash = hash; else render(); };
window.addEventListener('hashchange', render);

async function render() {
  closeModal();
  const name = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'today';
  if (!state.me) state.me = await fetch('/api/me').then((r) => r.json()).catch(() => ({ user: null }));
  if (!state.me.user && name !== 'login') return go('#/login');
  if (state.me.user && name === 'login') return go('#/today');
  const view = routes[name] || viewToday;
  if (name === 'login') { $('#app').innerHTML = ''; return view(); }
  shell(name);
  await view($('#view'));
}

async function refreshMe() {
  state.me = await fetch('/api/me').then((r) => r.json());
  const c = $('#review-count');
  if (c) { c.textContent = state.me.pendingReviews; c.classList.toggle('hidden', !state.me.pendingReviews); }
}

function shell(active) {
  const me = state.me;
  const link = (id, label, icon, extra = '') => `<a href="#/${id}" class="${active === id ? 'active' : ''}">${icon}<span>${label}</span>${extra}</a>`;
  $('#app').innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">${I.search}</div>AI Job Hunter</div>
      <nav class="nav">
        ${link('today', 'Today', I.today)}
        ${link('review', 'Review', I.review, `<span class="count ${me.pendingReviews ? '' : 'hidden'}" id="review-count">${me.pendingReviews}</span>`)}
        ${link('tracker', 'Tracker', I.tracker)}
        ${link('profile', 'Profile', I.profile)}
        ${link('preferences', 'Preferences', I.prefs)}
      </nav>
      <div class="sidebar-foot">
        <div class="status-line"><span class="dot ${me.ai.enabled ? 'on' : 'off'}"></span>${me.ai.enabled ? 'AI matching on' : 'Keyword matching (no AI key)'}</div>
        <div class="status-line"><span class="dot ${me.jobSource === 'adzuna' ? 'on' : 'off'}"></span>${me.jobSource === 'adzuna' ? 'Live jobs · Adzuna' : 'Sample jobs'}</div>
        <div class="status-line" style="margin-top:10px">${esc(me.user.email)}</div>
        <button class="btn ghost sm" id="logout" style="padding-left:0">Log out</button>
      </div>
    </aside>
    <main class="main">
      <div class="mobile-top"><div class="brand-mark">${I.search}</div>AI Job Hunter<button class="btn ghost sm" id="logout-m">Log out</button></div>
      <div id="view"></div>
    </main>
  </div>`;
  const logout = async () => { await api('/logout', { method: 'POST' }); state.me = null; go('#/login'); };
  $('#logout').onclick = logout;
  $('#logout-m').onclick = logout;
}

// ---------- auth ----------
function viewAuth() {
  let mode = 'login';
  const draw = () => {
    $('#app').innerHTML = `
    <div class="auth-wrap"><div class="auth">
      <div class="row" style="margin-bottom:18px"><div class="brand-mark">${I.search}</div><strong>AI Job Hunter</strong></div>
      <div class="card">
        <h1>${mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p class="lead">${mode === 'login' ? 'Log in to see today’s best matches.' : 'Your own dashboard, matches and applications.'}</p>
        <form class="stack" id="auth-form">
          <label class="field">Email<input type="email" name="email" autocomplete="email" required /></label>
          <label class="field">Password<input type="password" name="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="${mode === 'login' ? 1 : 8}" required />
          ${mode === 'signup' ? '<span class="faint">At least 8 characters.</span>' : ''}</label>
          <div class="form-error" id="auth-err"></div>
          <button class="btn primary" type="submit" data-busy="${mode === 'login' ? 'Logging in…' : 'Creating…'}">${mode === 'login' ? 'Log in' : 'Create account'}</button>
        </form>
        <p class="muted small" style="margin-top:16px;text-align:center">
          ${mode === 'login' ? 'New here? <a href="#" id="swap">Create an account</a>' : 'Already have an account? <a href="#" id="swap">Log in</a>'}
        </p>
      </div>
      <div class="points">
        <div>${I.check}<span>Reads your resume and finds your 10 best-fit jobs every day</span></div>
        <div>${I.check}<span>Writes tailored cover letters and answers you can edit</span></div>
        <div>${I.shield}<span>Nothing is ever applied without your approval</span></div>
      </div>
    </div></div>`;
    $('#swap').onclick = (e) => { e.preventDefault(); mode = mode === 'login' ? 'signup' : 'login'; draw(); };
    $('#auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = $('button[type=submit]', e.target);
      $('#auth-err').textContent = '';
      btn.disabled = true;
      try {
        await api(mode === 'login' ? '/login' : '/signup', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } });
        state.me = null;
        await refreshMe();
        go(state.me.hasProfile ? '#/today' : '#/profile');
      } catch (err) { $('#auth-err').textContent = err.message; } finally { btn.disabled = false; }
    };
  };
  draw();
}

// ---------- today ----------
function jobCard(j, i) {
  const a = j.application;
  const prepared = a && a.review_state !== 'none';
  const appState = !a ? '' : a.review_state === 'pending' ? '<span class="badge warn">Awaiting your review</span>'
    : a.review_state === 'approved' ? `<span class="badge accent">${a.stage === 'approved' ? 'Approved' : cap(a.stage)}</span>`
    : a.review_state === 'rejected' ? '<span class="badge danger">Draft rejected</span>' : '<span class="badge">Saved</span>';
  return `
  <article class="job" data-id="${j.id}" style="animation-delay:${(i || 0) * 30}ms">
    <div>
      <div class="score ${scoreClass(j.score)}" style="--p:${j.score ?? 0}" title="Match score${j.scored_with === 'ai' ? ' (AI)' : ' (keywords)'}"><span>${j.score ?? '–'}</span></div>
      ${i != null ? `<div class="rank">#${i + 1}</div>` : ''}
    </div>
    <div style="min-width:0">
      <div class="row" style="gap:8px">
        <span class="job-title" data-act="view">${esc(j.title)}</span>
        ${j.kind === 'internship' ? '<span class="badge">Internship</span>' : ''}
        ${j.source === 'sample' ? '<span class="badge">Sample</span>' : ''}
        ${appState}
      </div>
      <div class="meta">
        ${j.company ? `<span>${I.building}${esc(j.company)}</span>` : ''}
        ${j.location ? `<span>${I.pin}${esc(j.location)}${j.work_type && j.work_type !== j.location.toLowerCase() ? ` · ${cap(j.work_type)}` : ''}</span>` : ''}
        ${salary(j) ? `<span>${I.money}${salary(j)}</span>` : ''}
        ${j.posted_at ? `<span>${I.clock}${ago(j.posted_at)}</span>` : ''}
      </div>
      <ul class="reasons">${(j.reasons || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      ${j.missing_skills?.length ? `<div class="missing">Missing:<span class="chips">${j.missing_skills.map((s) => `<span class="chip miss">${esc(s)}</span>`).join('')}</span></div>` : ''}
    </div>
    <div class="job-actions">
      ${a?.review_state === 'pending' ? '<a class="btn primary sm" href="#/review">Review draft</a>'
        : a?.review_state === 'approved' && a.stage === 'approved' ? '<button class="btn primary sm" data-act="kit">Apply kit</button>'
        : a && ['applied', 'interview', 'offer'].includes(a.stage) ? '<a class="btn sm" href="#/tracker">In tracker</a>'
        : `<button class="btn primary sm" data-act="prepare" data-busy="Writing…">${prepared ? 'Re-prepare' : 'Prepare application'}</button>`}
      <div class="row" style="gap:6px;flex-wrap:nowrap">
        ${!a ? '<button class="btn sm" data-act="save" style="flex:1">Save</button>' : ''}
        <button class="btn ghost sm" data-act="view" style="flex:1">Details</button>
        ${!a || a.stage === 'saved' ? '<button class="btn ghost sm" data-act="dismiss" title="Not interested">✕</button>' : ''}
      </div>
    </div>
  </article>`;
}

function bindJobCards(root, jobs, reload) {
  root.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('.job');
    const job = jobs.find((j) => String(j.id) === card.dataset.id);
    const act = btn.dataset.act;
    if (act === 'view') return openJob(job, reload);
    if (act === 'save') { await api(`/jobs/${job.id}/save`, { method: 'POST' }); toast('Saved to your tracker'); return reload(); }
    if (act === 'dismiss') { await api(`/jobs/${job.id}/dismiss`, { method: 'POST' }); card.remove(); toast('Hidden. It won’t appear again.'); return; }
    if (act === 'prepare') return busy(btn, async () => { const { application } = await api(`/jobs/${job.id}/prepare`, { method: 'POST' }); await refreshMe(); openEditor(application.id, job, reload); });
    if (act === 'kit') { const { applications } = await api('/applications'); return openKit(applications.find((x) => x.job_id === job.id), reload); }
  };
}

async function viewToday(root) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Today’s top 10</h1>
        <div class="sub" id="digest-sub">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </div>
      <button class="btn" id="refresh" data-busy="Finding jobs…">${I.refresh}Refresh</button>
    </div>
    <div class="card" style="margin-bottom:18px">
      <div class="row" style="justify-content:space-between;margin-bottom:10px"><h2>Add a job by link</h2><a href="#" class="small" id="paste-toggle">or paste the description</a></div>
      <form class="addlink" id="addlink">
        <input type="url" name="url" placeholder="https://company.com/careers/role-123" />
        <button class="btn primary" type="submit" data-busy="Reading page…">Add &amp; score</button>
      </form>
      <textarea class="hidden" id="paste" placeholder="Paste the full job description here (useful for sites that need a login, like LinkedIn)." style="margin-top:8px"></textarea>
    </div>
    <div id="digest"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
    <div id="added"></div>`;

  $('#paste-toggle').onclick = (e) => { e.preventDefault(); $('#paste').classList.toggle('hidden'); $('#paste').focus(); };
  $('#addlink').onsubmit = (e) => {
    e.preventDefault();
    const url = e.target.url.value.trim();
    const text = $('#paste').classList.contains('hidden') ? '' : $('#paste').value.trim();
    if (!url && !text) return toast('Paste a job link (or the description).', true);
    busy($('button', e.target), async () => {
      const { job } = await api('/jobs/link', { method: 'POST', body: { url, text } });
      e.target.reset(); $('#paste').value = '';
      toast(`Added “${job.title}” — ${job.score}% match`);
      loadAdded();
    });
  };

  const loadDigest = async (refresh = false) => {
    const box = $('#digest');
    try {
      const d = await api(`/digest${refresh ? '?refresh=1' : ''}`);
      if (d.needsProfile) {
        box.innerHTML = `<div class="card empty"><h3>Start with your resume</h3><p>Upload it once and I’ll pick your best matches every day.</p><a class="btn primary" style="margin-top:14px" href="#/profile">${I.upload}Upload resume</a></div>`;
        return;
      }
      $('#digest-sub').innerHTML = `${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · ${d.source === 'sample' ? 'sample listings' : 'live from Adzuna'} · ${d.scored_with === 'ai' ? 'scored by AI' : 'keyword scoring'}`;
      const notice = d.source === 'sample'
        ? `<div class="notice" style="margin-bottom:14px">${I.info}<span>These are <b>sample jobs</b> so you can try everything. Add an Adzuna key to get real listings daily.</span></div>` : '';
      if (!d.jobs.length) {
        box.innerHTML = `${notice}<div class="card empty"><h3>No matches for your filters today</h3><p>Try widening location, work type or minimum salary.</p><a class="btn" style="margin-top:14px" href="#/preferences">Edit preferences</a></div>`;
        return;
      }
      const few = d.jobs.length < 10
        ? `<p class="muted small" style="margin:-4px 0 12px">${d.jobs.length} strong match${d.jobs.length === 1 ? '' : 'es'} today — weaker fits are left out. Widen your preferences for more.</p>` : '';
      box.innerHTML = notice + few + d.jobs.map(jobCard).join('');
      bindJobCards(box, d.jobs, () => loadDigest());
    } catch (e) { box.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
  };

  const loadAdded = async () => {
    const { jobs } = await api('/jobs/added').catch(() => ({ jobs: [] }));
    const box = $('#added');
    if (!jobs.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="section-title"><h2>Jobs you added</h2><span class="muted small">${jobs.length}</span></div><div id="added-list">${jobs.map((j) => jobCard(j)).join('')}</div>`;
    bindJobCards($('#added-list'), jobs, loadAdded);
  };

  $('#refresh').onclick = () => busy($('#refresh'), () => loadDigest(true));
  await Promise.all([loadDigest(), loadAdded()]);
}

// ---------- modals ----------
function modal(html, { onClose } = {}) {
  closeModal();
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const back = $('.modal-back', root);
  const close = () => { closeModal(); onClose?.(); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $$('[data-close]', root).forEach((b) => (b.onclick = close));
  document.onkeydown = (e) => { if (e.key === 'Escape') close(); };
  document.body.style.overflow = 'hidden';
  return { el: $('.modal', root), close };
}
function closeModal() { $('#modal-root').innerHTML = ''; document.body.style.overflow = ''; document.onkeydown = null; }

function openJob(j, reload) {
  const m = modal(`
    <div class="modal-head">
      <div class="score ${scoreClass(j.score)}" style="--p:${j.score ?? 0}"><span>${j.score ?? '–'}</span></div>
      <div style="flex:1;min-width:0">
        <h2>${esc(j.title)}</h2>
        <div class="meta">${j.company ? `<span>${I.building}${esc(j.company)}</span>` : ''}${j.location ? `<span>${I.pin}${esc(j.location)}${j.work_type && j.work_type !== j.location.toLowerCase() ? ` · ${cap(j.work_type)}` : ''}</span>` : ''}${salary(j) ? `<span>${I.money}${salary(j)}</span>` : ''}${j.posted_at ? `<span>${I.clock}${ago(j.posted_at)}</span>` : ''}</div>
      </div>
      <button class="btn ghost sm" data-close>✕</button>
    </div>
    <div class="modal-body">
      <div><h3 style="margin-bottom:6px">Why it fits</h3><ul class="reasons" style="margin:0">${(j.reasons || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>
      ${j.missing_skills?.length ? `<div><h3 style="margin-bottom:8px">Skills to brush up</h3><div class="chips">${j.missing_skills.map((s) => `<span class="chip miss">${esc(s)}</span>`).join('')}</div></div>` : ''}
      <div><h3 style="margin-bottom:8px">Description</h3><div class="desc">${esc(j.description || 'No description available.')}</div></div>
    </div>
    <div class="modal-foot">
      ${j.url ? `<a class="btn" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">${I.external}View posting</a>` : ''}
      <span class="spacer"></span>
      ${!j.application || ['saved'].includes(j.application.stage) && j.application.review_state !== 'pending'
        ? '<button class="btn primary" id="m-prep" data-busy="Writing…">Prepare application</button>' : ''}
    </div>`);
  const prep = $('#m-prep', m.el);
  if (prep) prep.onclick = () => busy(prep, async () => {
    const { application } = await api(`/jobs/${j.id}/prepare`, { method: 'POST' });
    await refreshMe();
    openEditor(application.id, j, reload);
  });
}

async function openEditor(appId, job, reload) {
  const { applications } = await api('/applications');
  const a = applications.find((x) => x.id === appId);
  const m = modal(`
    <div class="modal-head">
      <div style="flex:1"><h2>Application for ${esc(a.title)}</h2><p class="muted small">${esc(a.company)} · drafted ${a.prepared_with === 'ai' ? 'by AI' : 'from a template (add an AI key for tailored drafts)'}</p></div>
      <button class="btn ghost sm" data-close>✕</button>
    </div>
    <div class="modal-body">
      <div class="notice">${I.shield}<span>This draft is waiting in <b>Review &amp; approve</b>. Nothing is sent anywhere until you approve it and submit it yourself.</span></div>
      <label class="field">Cover letter<textarea id="e-cover" rows="12">${esc(a.cover_letter)}</textarea></label>
      ${a.answers.map((q, i) => `<label class="field">${esc(q.question)}<textarea data-q="${i}" rows="4">${esc(q.answer)}</textarea></label>`).join('')}
    </div>
    <div class="modal-foot">
      <button class="btn ghost" data-close>Close</button>
      <button class="btn" id="e-save">Save draft</button>
      <button class="btn primary" id="e-approve">${I.check}Save &amp; approve</button>
    </div>`, { onClose: () => reload?.() });
  const collect = () => ({
    cover_letter: $('#e-cover', m.el).value,
    answers: a.answers.map((q, i) => ({ question: q.question, answer: $(`[data-q="${i}"]`, m.el).value })),
  });
  $('#e-save', m.el).onclick = async () => { await api(`/applications/${a.id}`, { method: 'PUT', body: collect() }); toast('Draft saved'); };
  $('#e-approve', m.el).onclick = async () => {
    try {
      await api(`/applications/${a.id}`, { method: 'PUT', body: collect() });
      await api(`/applications/${a.id}/approve`, { method: 'POST' });
      await refreshMe();
      toast('Approved — ready to apply');
      m.close();
    } catch (e) { toast(e.message, true); }
  };
}

function openKit(a, reload) {
  const p = state.profile || {};
  const rows = [
    ['Name', p.full_name], ['Email', p.contact_email], ['Phone', p.phone], ['Location', p.location], ['Links', p.links],
  ].filter(([, v]) => v);
  const m = modal(`
    <div class="modal-head">
      <div style="flex:1"><h2>Apply kit · ${esc(a.title)}</h2><p class="muted small">${esc(a.company)} — approved ${fmtDate(a.history.find((h) => h.stage === 'approved')?.at || a.updated_at)}</p></div>
      <button class="btn ghost sm" data-close>✕</button>
    </div>
    <div class="modal-body">
      <div class="notice">${I.shield}<span>“Open apply page” copies your cover letter and opens the employer’s site. <b>You</b> paste, check and press submit there — this app never submits for you.</span></div>
      <div class="kv">${rows.map(([k, v], i) => `<div class="k">${k}</div><div class="v">${esc(v)}</div><button class="btn ghost sm" data-copy="r${i}">Copy</button>`).join('')}</div>
      <label class="field"><span class="row" style="justify-content:space-between">Cover letter <button class="btn ghost sm" data-copy="cover">Copy</button></span><textarea id="k-cover" rows="9" readonly>${esc(a.cover_letter)}</textarea></label>
      ${a.answers.map((q, i) => `<div class="field"><span class="row" style="justify-content:space-between">${esc(q.question)}<button class="btn ghost sm" data-copy="q${i}">Copy</button></span><div class="desc" style="max-height:none">${esc(q.answer)}</div></div>`).join('')}
    </div>
    <div class="modal-foot">
      ${a.url ? `<button class="btn primary" id="k-open">${I.external}Open apply page</button>` : '<span class="muted small">No apply link for this job.</span>'}
      <span class="spacer"></span>
      <button class="btn" id="k-applied">${I.check}I’ve submitted it</button>
    </div>`, { onClose: () => reload?.() });
  const copy = async (text, label = 'Copied') => { try { await navigator.clipboard.writeText(text); toast(label); } catch { toast('Copy failed — select and copy manually', true); } };
  $$('[data-copy]', m.el).forEach((b) => (b.onclick = () => {
    const key = b.dataset.copy;
    if (key === 'cover') return copy(a.cover_letter, 'Cover letter copied');
    if (key[0] === 'r') return copy(rows[Number(key.slice(1))][1]);
    return copy(a.answers[Number(key.slice(1))].answer, 'Answer copied');
  }));
  const open = $('#k-open', m.el);
  if (open) open.onclick = async () => {
    window.open(a.url, '_blank', 'noopener');
    await copy(a.cover_letter, 'Cover letter copied — paste it on the apply page');
  };
  $('#k-applied', m.el).onclick = async () => {
    try { await api(`/applications/${a.id}/stage`, { method: 'POST', body: { stage: 'applied' } }); toast('Marked as applied'); m.close(); } catch (e) { toast(e.message, true); }
  };
}

// ---------- review & approve ----------
async function viewReview(root) {
  const { applications } = await api('/applications?review=pending');
  root.innerHTML = `
    <div class="page-head"><div><h1>Review &amp; approve</h1><div class="sub">Every prepared application waits here. Only approved ones move forward.</div></div></div>
    ${applications.length ? `
      <div class="bulkbar">
        <label class="check"><input type="checkbox" id="all" />Select all</label>
        <span class="muted small" id="selcount">0 selected</span>
        <span class="spacer"></span>
        <button class="btn primary sm" id="bulk" disabled>${I.check}Approve selected</button>
      </div>
      ${applications.map((a) => `
      <div class="card review-item" data-id="${a.id}">
        <div class="review-head">
          <input type="checkbox" class="sel" aria-label="Select ${esc(a.title)}" />
          <div class="score ${scoreClass(a.score)}" style="--p:${a.score ?? 0};width:42px;height:42px;font-size:13px"><span>${a.score ?? '–'}</span></div>
          <div style="flex:1;min-width:0"><h3>${esc(a.title)}</h3><div class="meta"><span>${esc(a.company)}</span><span>${esc(a.location)}</span><span>Prepared ${ago(a.updated_at).toLowerCase()}</span></div></div>
          <button class="btn ghost sm" data-act="toggle">Edit</button>
        </div>
        <div class="review-body hidden">
          <label class="field">Cover letter<textarea class="cover" rows="11">${esc(a.cover_letter)}</textarea></label>
          ${a.answers.map((q, i) => `<label class="field">${esc(q.question)}<textarea data-q="${i}" rows="3">${esc(q.answer)}</textarea></label>`).join('')}
        </div>
        <div class="review-foot">
          <button class="btn primary sm" data-act="approve">${I.check}Approve</button>
          <button class="btn sm hidden" data-act="save">Save edits</button>
          <span class="spacer"></span>
          <button class="btn ghost sm danger" data-act="reject">Reject</button>
        </div>
      </div>`).join('')}`
    : `<div class="card empty"><h3>All caught up</h3><p>Prepare an application from <a href="#/today">Today’s matches</a> and it will appear here for approval.</p></div>`}`;

  const byId = (id) => applications.find((a) => a.id === Number(id));
  const collect = (card, a) => ({
    cover_letter: $('.cover', card).value,
    answers: a.answers.map((q, i) => ({ question: q.question, answer: $(`[data-q="${i}"]`, card).value })),
  });
  const updateSel = () => {
    const n = $$('.sel:checked').length;
    $('#selcount').textContent = `${n} selected`;
    $('#bulk').disabled = !n;
    $('#all').checked = n && n === $$('.sel').length;
  };
  if (!applications.length) return;
  $('#all').onchange = (e) => { $$('.sel').forEach((c) => (c.checked = e.target.checked)); updateSel(); };
  $$('.sel').forEach((c) => (c.onchange = updateSel));
  $('#bulk').onclick = () => busy($('#bulk'), async () => {
    const cards = $$('.sel:checked').map((c) => c.closest('.review-item'));
    for (const card of cards) {
      if (!$('.review-body', card).classList.contains('hidden')) await api(`/applications/${card.dataset.id}`, { method: 'PUT', body: collect(card, byId(card.dataset.id)) });
    }
    const { approved } = await api('/applications/approve-bulk', { method: 'POST', body: { ids: cards.map((c) => Number(c.dataset.id)) } });
    toast(`Approved ${approved} application${approved === 1 ? '' : 's'}`);
    await refreshMe();
    render();
  });
  root.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('.review-item');
    const a = byId(card.dataset.id);
    const act = btn.dataset.act;
    if (act === 'toggle') {
      const body = $('.review-body', card);
      body.classList.toggle('hidden');
      $('[data-act=save]', card).classList.toggle('hidden', body.classList.contains('hidden'));
      btn.textContent = body.classList.contains('hidden') ? 'Edit' : 'Collapse';
      return;
    }
    try {
      if (act === 'save') { await api(`/applications/${a.id}`, { method: 'PUT', body: collect(card, a) }); toast('Edits saved'); return; }
      if (act === 'approve') {
        if (!$('.review-body', card).classList.contains('hidden')) await api(`/applications/${a.id}`, { method: 'PUT', body: collect(card, a) });
        await api(`/applications/${a.id}/approve`, { method: 'POST' });
        toast('Approved — find it in the tracker');
      }
      if (act === 'reject') { await api(`/applications/${a.id}/reject`, { method: 'POST' }); toast('Rejected — it won’t move forward'); }
      card.style.transition = 'opacity .2s'; card.style.opacity = '0';
      setTimeout(async () => { await refreshMe(); render(); }, 200);
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- tracker ----------
const STAGES = [
  ['saved', 'Saved', '#8b98a8'], ['approved', 'Approved', '#2dd4bf'], ['applied', 'Applied', '#60a5fa'],
  ['interview', 'Interview', '#c084fc'], ['offer', 'Offer', '#4ade80'], ['rejected', 'Rejected', '#f87171'],
];

async function viewTracker(root) {
  const [{ applications }, { profile }] = await Promise.all([api('/applications'), api('/profile')]);
  state.profile = profile;
  root.innerHTML = `
    <div class="page-head"><div><h1>Tracker</h1><div class="sub">Drag cards or open one to change status and add notes. Moving to “Applied” needs your approval first.</div></div></div>
    ${applications.length ? `<div class="board">${STAGES.map(([id, label, color]) => {
      const items = applications.filter((a) => a.stage === id);
      return `<section class="col" data-stage="${id}">
        <div class="col-head"><span class="row" style="gap:7px"><span class="stage-dot" style="background:${color}"></span>${label}</span><span class="n">${items.length}</span></div>
        ${items.map((a) => `<div class="tcard" draggable="true" data-id="${a.id}">
          <div class="t">${esc(a.title)}</div><div class="c">${esc(a.company)}</div>
          <div class="d"><span>${a.review_state === 'pending' ? '<span class="badge warn" style="font-size:10px">In review</span>' : a.score != null ? `${a.score}% match` : ''}</span><span>${fmtDate(a.history.at(-1)?.at || a.updated_at)}</span></div>
          ${a.notes ? `<div class="c" style="margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📝 ${esc(a.notes)}</div>` : ''}
        </div>`).join('')}
      </section>`;
    }).join('')}</div>`
    : `<div class="card empty"><h3>Nothing tracked yet</h3><p>Save or prepare a job from <a href="#/today">Today</a> to start tracking it.</p></div>`}`;

  const move = async (id, stage) => {
    try { await api(`/applications/${id}/stage`, { method: 'POST', body: { stage } }); render(); } catch (e) { toast(e.message, true); }
  };
  let dragId = null;
  $$('.tcard').forEach((c) => {
    c.ondragstart = () => { dragId = c.dataset.id; };
    c.onclick = () => openTrackerCard(applications.find((a) => a.id === Number(c.dataset.id)), move);
  });
  $$('.col').forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('drop'); };
    col.ondragleave = () => col.classList.remove('drop');
    col.ondrop = (e) => { e.preventDefault(); col.classList.remove('drop'); if (dragId) move(dragId, col.dataset.stage); };
  });
}

function openTrackerCard(a, move) {
  const m = modal(`
    <div class="modal-head">
      <div style="flex:1"><h2>${esc(a.title)}</h2><p class="muted small">${esc(a.company)} · ${esc(a.location)}${salary(a) ? ` · ${salary(a)}` : ''}</p></div>
      <button class="btn ghost sm" data-close>✕</button>
    </div>
    <div class="modal-body">
      <div class="grid-2">
        <label class="field">Status<select id="t-stage">${STAGES.map(([id, label]) => `<option value="${id}" ${a.stage === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <div class="field">Approval<div style="padding-top:6px">${a.review_state === 'approved' ? '<span class="badge accent">Approved by you</span>' : a.review_state === 'pending' ? '<span class="badge warn">Waiting for review</span>' : a.review_state === 'rejected' ? '<span class="badge danger">Draft rejected</span>' : '<span class="badge">Not prepared</span>'}</div></div>
      </div>
      <div class="field">Timeline<div class="stack" style="gap:4px;margin-top:4px">${a.history.map((h) => `<div class="row small"><span class="stage-dot" style="background:${STAGES.find((s) => s[0] === h.stage)?.[2]}"></span><b style="color:var(--text)">${cap(h.stage)}</b><span class="muted">${new Date(h.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span></div>`).join('')}</div></div>
      <label class="field">Notes<textarea id="t-notes" rows="4" placeholder="Recruiter name, interview date, follow-up…">${esc(a.notes)}</textarea></label>
    </div>
    <div class="modal-foot">
      <button class="btn ghost danger" id="t-del">Remove</button>
      <span class="spacer"></span>
      ${a.review_state === 'approved' && a.stage === 'approved' ? '<button class="btn" id="t-kit">Apply kit</button>' : ''}
      ${a.review_state === 'none' || a.review_state === 'rejected' ? '<button class="btn" id="t-prep" data-busy="Writing…">Prepare application</button>' : ''}
      <button class="btn primary" id="t-save">Save</button>
    </div>`);
  $('#t-save', m.el).onclick = async () => {
    try {
      await api(`/applications/${a.id}`, { method: 'PUT', body: { notes: $('#t-notes', m.el).value } });
      const stage = $('#t-stage', m.el).value;
      if (stage !== a.stage) await move(a.id, stage); else { closeModal(); render(); }
      toast('Saved');
    } catch (e) { toast(e.message, true); }
  };
  $('#t-del', m.el).onclick = async () => {
    if (!confirm('Remove this job from your tracker?')) return;
    await api(`/applications/${a.id}`, { method: 'DELETE' }); closeModal(); render();
  };
  const kit = $('#t-kit', m.el); if (kit) kit.onclick = () => openKit(a, render);
  const prep = $('#t-prep', m.el);
  if (prep) prep.onclick = () => busy(prep, async () => {
    const { application } = await api(`/jobs/${a.job_id}/prepare`, { method: 'POST' });
    await refreshMe(); openEditor(application.id, null, render);
  });
}

// ---------- profile ----------
function chipInput(el, values) {
  let list = [...values];
  const draw = () => {
    el.innerHTML = list.map((v, i) => `<span class="chip">${esc(v)}<button type="button" data-i="${i}" aria-label="Remove ${esc(v)}">×</button></span>`).join('')
      + '<input type="text" placeholder="Add and press Enter" />';
    const input = $('input', el);
    input.onkeydown = (e) => {
      if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
        e.preventDefault();
        input.value.split(',').map((s) => s.trim()).filter(Boolean).forEach((v) => { if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v); });
        draw(); $('input', el).focus();
      } else if (e.key === 'Backspace' && !input.value && list.length) { list.pop(); draw(); $('input', el).focus(); }
    };
    input.onblur = () => { if (input.value.trim()) { list.push(input.value.trim()); draw(); } };
  };
  el.onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) { list.splice(Number(b.dataset.i), 1); draw(); } else $('input', el)?.focus(); };
  draw();
  return () => list;
}

async function viewProfile(root) {
  const { profile } = await api('/profile');
  const p = profile || {};
  root.innerHTML = `
    <div class="page-head"><div><h1>Your profile</h1><div class="sub">Pulled from your resume — edit anything that’s off. Matching uses this.</div></div></div>
    <label class="drop-zone" id="dz">
      <input type="file" id="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden />
      <div>${I.upload}</div>
      <div style="font-weight:600;margin-top:6px" id="dz-title">${p.resume_filename ? `Current: ${esc(p.resume_filename)} — upload a new version` : 'Upload your resume'}</div>
      <div class="muted small">PDF or Word (.docx), up to 8 MB. ${state.me.ai.enabled ? 'AI will read it and fill in your profile.' : 'Keyword parsing (add an AI key for richer extraction).'}</div>
    </label>
    ${profile ? `
    <form class="card" id="pform" style="margin-top:18px">
      <div class="stack">
        <div class="row" style="justify-content:space-between"><h2>Details</h2>${p.parsed_with ? `<span class="badge ${p.parsed_with === 'ai' ? 'accent' : ''}">Parsed ${p.parsed_with === 'ai' ? 'by AI' : 'by keywords'}</span>` : ''}</div>
        <div class="grid-2">
          <label class="field">Full name<input type="text" name="full_name" value="${esc(p.full_name)}" /></label>
          <label class="field">Email for applications<input type="email" name="contact_email" value="${esc(p.contact_email)}" /></label>
          <label class="field">Phone<input type="text" name="phone" value="${esc(p.phone)}" /></label>
          <label class="field">Location<input type="text" name="location" value="${esc(p.location)}" placeholder="e.g. Hyderabad, India" /></label>
        </div>
        <label class="field">Links (portfolio, LinkedIn, GitHub)<input type="text" name="links" value="${esc(p.links)}" /></label>
        <label class="field">Summary<textarea name="summary" rows="3">${esc(p.summary)}</textarea></label>
        <div class="grid-2">
          <label class="field">Experience level<select name="experience_level">${['', 'student', 'entry', 'junior', 'mid', 'senior', 'lead'].map((l) => `<option value="${l}" ${p.experience_level === l ? 'selected' : ''}>${l ? cap(l) : '—'}</option>`).join('')}</select></label>
          <label class="field">Years of experience<input type="number" name="years_experience" min="0" max="50" step="0.5" value="${p.years_experience ?? 0}" /></label>
        </div>
        <div class="field">Skills<div class="chip-input" id="ci-skills"></div></div>
        <div class="field">Job titles held<div class="chip-input" id="ci-titles"></div></div>
        <div class="field">Preferred roles<div class="chip-input" id="ci-roles"></div></div>
        <div class="row"><button class="btn primary" type="submit">Save profile</button><span class="muted small">Saving re-scores today’s matches.</span></div>
      </div>
    </form>` : ''}`;

  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData(); fd.append('resume', file);
    $('#dz-title').innerHTML = `<span class="spin" style="display:inline-block;width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .7s linear infinite;vertical-align:-2px"></span> Reading ${esc(file.name)}…`;
    try {
      await api('/resume', { method: 'POST', form: fd });
      toast('Resume read — check your profile below');
      await refreshMe();
      render();
    } catch (e) { toast(e.message, true); $('#dz-title').textContent = 'Upload your resume'; }
  };
  $('#file').onchange = (e) => upload(e.target.files[0]);
  const dz = $('#dz');
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); upload(e.dataTransfer.files[0]); };

  if (!profile) return;
  const skills = chipInput($('#ci-skills'), p.skills || []);
  const titles = chipInput($('#ci-titles'), p.job_titles || []);
  const roles = chipInput($('#ci-roles'), p.preferred_roles || []);
  $('#pform').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await api('/profile', { method: 'PUT', body: { ...f, skills: skills(), job_titles: titles(), preferred_roles: roles() } });
      toast('Profile saved');
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- preferences ----------
async function viewPrefs(root) {
  const { preferences: p } = await api('/preferences');
  root.innerHTML = `
    <div class="page-head"><div><h1>Preferences</h1><div class="sub">These filter and steer your daily top 10.</div></div></div>
    <form class="card stack" id="prefs">
      <div class="field">Looking for<div class="seg" data-name="kind">${[['job', 'Jobs'], ['internship', 'Internships']].map(([v, l]) => `<button type="button" data-v="${v}" class="${p.kind === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <label class="field">Role keywords <span class="faint">Comma separated — e.g. UI/UX designer, product designer</span><input type="text" name="keywords" value="${esc(p.keywords)}" /></label>
      <div class="field">Location<div class="seg" data-name="location_mode">${[['city', 'City'], ['near', 'Near me'], ['remote', 'Remote only']].map(([v, l]) => `<button type="button" data-v="${v}" class="${p.location_mode === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="grid-2" id="cityrow">
        <label class="field">City<input type="text" name="city" value="${esc(p.city)}" placeholder="e.g. Bengaluru" /></label>
        <label class="field" id="radius">Radius (km)<input type="number" name="radius_km" min="1" max="200" value="${p.radius_km}" /></label>
      </div>
      <div class="field">Work type<div class="row" style="gap:18px;padding-top:4px">${['onsite', 'hybrid', 'remote'].map((t) => `<label class="check"><input type="checkbox" name="wt" value="${t}" ${p.work_types.includes(t) ? 'checked' : ''} />${cap(t)}</label>`).join('')}</div></div>
      <label class="field"><span id="sal-label"></span><input type="number" name="min_salary" min="0" step="1000" value="${p.min_salary || ''}" placeholder="0 = no minimum" /></label>
      <div class="row"><button class="btn primary" type="submit">Save preferences</button><span class="muted small">Today’s list refreshes with your new filters.</span></div>
    </form>`;
  const form = $('#prefs');
  const segVal = (name) => $(`.seg[data-name=${name}] .on`, form)?.dataset.v;
  const sync = () => {
    const mode = segVal('location_mode');
    $('#cityrow').classList.toggle('hidden', mode === 'remote');
    $('#radius').classList.toggle('hidden', mode !== 'near');
    $('#sal-label').textContent = segVal('kind') === 'internship' ? 'Minimum stipend (₹ per month)' : 'Minimum salary (₹ per year)';
  };
  $$('.seg', form).forEach((seg) => (seg.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', seg).forEach((x) => x.classList.toggle('on', x === b)); sync();
  }));
  sync();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const body = {
      kind: segVal('kind'), keywords: f.get('keywords'), location_mode: segVal('location_mode'), city: f.get('city'),
      radius_km: Number(f.get('radius_km')), work_types: f.getAll('wt'), min_salary: Number(f.get('min_salary') || 0),
    };
    if (!body.work_types.length) return toast('Pick at least one work type', true);
    try { await api('/preferences', { method: 'PUT', body }); toast('Preferences saved'); go('#/today'); } catch (err) { toast(err.message, true); }
  };
}

// The apply kit needs profile details; load them lazily when visiting Today.
const origToday = viewToday;
routes.today = async (root) => { api('/profile').then(({ profile }) => (state.profile = profile)).catch(() => {}); return origToday(root); };

render();
