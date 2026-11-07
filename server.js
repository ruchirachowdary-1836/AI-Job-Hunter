import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { db, json, now, today } from './lib/db.js';
import { hashPassword, verifyPassword, createSession, destroySession, requireAuth, currentUser, tooManyAttempts } from './lib/auth.js';
import { aiEnabled, aiModel } from './lib/ai.js';
import { extractText, parseResume } from './lib/resume.js';
import { fetchFeed, jobFromLink, adzunaEnabled } from './lib/jobs.js';
import { scoreJobs, passesFilters } from './lib/match.js';
import { prepareApplication } from './lib/prep.js';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.resolve('public'), { extensions: ['html'] }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------- data access helpers ----------

function getProfile(userId) {
  const p = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  if (!p) return null;
  return { ...p, skills: json(p.skills), job_titles: json(p.job_titles), preferred_roles: json(p.preferred_roles) };
}

function getPrefs(userId) {
  let p = db.prepare('SELECT * FROM preferences WHERE user_id = ?').get(userId);
  if (!p) {
    db.prepare('INSERT INTO preferences (user_id) VALUES (?)').run(userId);
    p = db.prepare('SELECT * FROM preferences WHERE user_id = ?').get(userId);
  }
  return { ...p, work_types: json(p.work_types, ['onsite', 'remote', 'hybrid']) };
}

function shapeJob(row) {
  if (!row) return null;
  const { reasons, missing_skills, ...rest } = row;
  return { ...rest, reasons: json(reasons), missing_skills: json(missing_skills) };
}

function shapeApp(row) {
  if (!row) return null;
  return { ...row, answers: json(row.answers), history: json(row.history) };
}

const appForJob = (userId, jobId) => db.prepare('SELECT * FROM applications WHERE user_id = ? AND job_id = ?').get(userId, jobId);

function jobWithApp(userId, jobRow) {
  const job = shapeJob(jobRow);
  const a = appForJob(userId, job.id);
  job.application = a ? { id: a.id, stage: a.stage, review_state: a.review_state } : null;
  return job;
}

function invalidateDigest(userId) {
  db.prepare('DELETE FROM digests WHERE user_id = ? AND day = ?').run(userId, today());
}

const upsertJob = db.prepare(`
  INSERT INTO jobs (user_id, source, external_id, title, company, location, work_type, kind, salary_min, salary_max, salary_text, salary_period, description, url, posted_at)
  VALUES (:user_id, :source, :external_id, :title, :company, :location, :work_type, :kind, :salary_min, :salary_max, :salary_text, :salary_period, :description, :url, :posted_at)
  ON CONFLICT (user_id, source, external_id) DO UPDATE SET
    title = excluded.title, company = excluded.company, location = excluded.location, work_type = excluded.work_type,
    kind = excluded.kind, salary_min = excluded.salary_min, salary_max = excluded.salary_max, salary_text = excluded.salary_text,
    salary_period = excluded.salary_period, description = excluded.description, url = excluded.url, posted_at = excluded.posted_at
  RETURNING id`);

function saveJob(userId, source, j) {
  return upsertJob.get({
    user_id: userId, source, external_id: String(j.external_id).slice(0, 500),
    title: j.title || 'Untitled', company: j.company || '', location: j.location || '', work_type: j.work_type || '',
    kind: j.kind || 'job', salary_min: j.salary_min ?? null, salary_max: j.salary_max ?? null, salary_text: j.salary_text || '',
    salary_period: j.salary_period || 'year', description: j.description || '', url: j.url || '', posted_at: j.posted_at || null,
  }).id;
}

const writeScore = db.prepare('UPDATE jobs SET score = ?, reasons = ?, missing_skills = ?, scored_with = ?, scored_profile_at = ? WHERE id = ?');

async function scoreAndStore(userId, jobRows, profile, prefs) {
  const stamp = `${profile.updated_at}|${prefs.updated_at}|${aiEnabled() ? 'ai' : 'kw'}`;
  const stale = jobRows.filter((j) => j.scored_profile_at !== stamp);
  if (!stale.length) return;
  const scores = await scoreJobs(stale, profile, prefs);
  for (const j of stale) {
    const s = scores.get(j.id);
    writeScore.run(s.score, JSON.stringify(s.reasons), JSON.stringify(s.missing_skills), s.scored_with, stamp, j.id);
  }
}

// ---------- daily digest ----------

// Weak matches are left out rather than padding the list to 10.
const MIN_SCORE = Number(process.env.MIN_MATCH_SCORE ?? 30);
const building = new Map();
function buildDigest(userId) {
  if (!building.has(userId)) {
    building.set(userId, doBuildDigest(userId).finally(() => building.delete(userId)));
  }
  return building.get(userId);
}

async function doBuildDigest(userId) {
  const profile = getProfile(userId);
  const prefs = getPrefs(userId);
  if (!profile) return null;
  const { source, jobs } = await fetchFeed(profile, prefs);
  for (const j of jobs) saveJob(userId, source, j);

  const closed = new Set(db.prepare(
    `SELECT job_id FROM applications WHERE user_id = ? AND stage IN ('applied','interview','offer','rejected')`,
  ).all(userId).map((r) => r.job_id));
  const since = new Date(Date.now() - 21 * 864e5).toISOString();
  const candidates = db.prepare(
    `SELECT * FROM jobs WHERE user_id = ? AND source = ? AND dismissed = 0 AND (posted_at IS NULL OR posted_at >= ?)`,
  ).all(userId, source, since).filter((j) => !closed.has(j.id) && passesFilters(j, prefs));

  await scoreAndStore(userId, candidates, profile, prefs);
  const scored = db.prepare(`SELECT id, score, posted_at, scored_with FROM jobs WHERE id IN (${candidates.map(() => '?').join(',') || 'NULL'})`)
    .all(...candidates.map((c) => c.id))
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || String(b.posted_at).localeCompare(String(a.posted_at)))
    .slice(0, 10);

  const scoredWith = scored.some((s) => s.scored_with === 'ai') ? 'ai' : 'keywords';
  db.prepare(`INSERT OR REPLACE INTO digests (user_id, day, job_ids, source, scored_with) VALUES (?, ?, ?, ?, ?)`)
    .run(userId, today(), JSON.stringify(scored.map((s) => s.id)), source, scoredWith);
  return db.prepare('SELECT * FROM digests WHERE user_id = ? AND day = ?').get(userId, today());
}

// Refresh every active user's digest each morning (server time).
const DIGEST_HOUR = Number(process.env.DIGEST_HOUR ?? 7);
async function dailyRun() {
  if (new Date().getHours() < DIGEST_HOUR) return;
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const users = db.prepare(
    `SELECT u.id FROM users u JOIN profiles p ON p.user_id = u.id
     WHERE u.last_seen >= ? AND NOT EXISTS (SELECT 1 FROM digests d WHERE d.user_id = u.id AND d.day = ?)`,
  ).all(since, today());
  for (const u of users) {
    try { await buildDigest(u.id); } catch (e) { console.error('[daily]', u.id, e.message); }
  }
}
setInterval(dailyRun, 30 * 60 * 1000).unref();
setTimeout(dailyRun, 10_000).unref();

// ---------- auth ----------

app.post('/api/signup', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 'Enter a valid email address.');
  if (password.length < 8) return bad(res, 'Password must be at least 8 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return bad(res, 'An account with this email already exists. Log in instead.', 409);
  const { lastInsertRowid } = db.prepare('INSERT INTO users (email, pw_hash) VALUES (?, ?)').run(email, hashPassword(password));
  createSession(res, Number(lastInsertRowid));
  res.json({ ok: true });
}));

app.post('/api/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (tooManyAttempts(`${req.ip}|${email}`)) return bad(res, 'Too many attempts. Try again in 15 minutes.', 429);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.pw_hash)) return bad(res, 'Email or password is incorrect.', 401);
  createSession(res, user.id);
  res.json({ ok: true });
}));

app.post('/api/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.json({ user: null });
  const profile = getProfile(user.id);
  const pending = db.prepare(`SELECT COUNT(*) n FROM applications WHERE user_id = ? AND review_state = 'pending'`).get(user.id).n;
  res.json({
    user,
    hasProfile: Boolean(profile),
    pendingReviews: pending,
    ai: { enabled: aiEnabled(), model: aiEnabled() ? aiModel() : null },
    jobSource: adzunaEnabled() ? 'adzuna' : 'sample',
  });
});

app.use('/api', requireAuth);

// ---------- profile & resume ----------

app.get('/api/profile', (req, res) => res.json({ profile: getProfile(req.user.id) }));

app.post('/api/resume', upload.single('resume'), wrap(async (req, res) => {
  if (!req.file) return bad(res, 'Choose a PDF or Word file to upload.');
  let text;
  try { text = (await extractText(req.file)).trim(); } catch (e) { return bad(res, e.message); }
  if (text.length < 80) return bad(res, 'Could not read text from that file. If it is a scanned image, export it as a text PDF or .docx.');
  const parsed = await parseResume(text);
  const existing = getProfile(req.user.id);
  db.prepare(`INSERT INTO profiles (user_id, full_name, contact_email, phone, location, links, summary, skills, experience_level, years_experience, job_titles, preferred_roles, resume_text, resume_filename, parsed_with, updated_at)
    VALUES (:user_id, :full_name, :contact_email, :phone, :location, :links, :summary, :skills, :experience_level, :years_experience, :job_titles, :preferred_roles, :resume_text, :resume_filename, :parsed_with, :updated_at)
    ON CONFLICT (user_id) DO UPDATE SET full_name = excluded.full_name, contact_email = excluded.contact_email, phone = excluded.phone,
      location = excluded.location, links = excluded.links, summary = excluded.summary, skills = excluded.skills,
      experience_level = excluded.experience_level, years_experience = excluded.years_experience, job_titles = excluded.job_titles,
      preferred_roles = excluded.preferred_roles, resume_text = excluded.resume_text, resume_filename = excluded.resume_filename,
      parsed_with = excluded.parsed_with, updated_at = excluded.updated_at`).run({
    user_id: req.user.id,
    full_name: parsed.full_name || existing?.full_name || '',
    contact_email: parsed.contact_email || existing?.contact_email || req.user.email,
    phone: parsed.phone || existing?.phone || '',
    location: parsed.location || existing?.location || '',
    links: parsed.links || existing?.links || '',
    summary: parsed.summary || existing?.summary || '',
    skills: JSON.stringify(parsed.skills || []),
    experience_level: parsed.experience_level || '',
    years_experience: Number(parsed.years_experience) || 0,
    job_titles: JSON.stringify(parsed.job_titles || []),
    preferred_roles: JSON.stringify(parsed.preferred_roles || []),
    resume_text: text.slice(0, 100000),
    resume_filename: req.file.originalname,
    parsed_with: parsed.parsed_with,
    updated_at: now(),
  });
  // Seed sensible preferences the first time.
  const prefs = getPrefs(req.user.id);
  if (!prefs.keywords && parsed.preferred_roles?.length) {
    db.prepare('UPDATE preferences SET keywords = ?, kind = ?, city = COALESCE(NULLIF(city, \'\'), ?), updated_at = ? WHERE user_id = ?')
      .run(parsed.preferred_roles.slice(0, 3).join(', '), parsed.experience_level === 'student' ? 'internship' : 'job', (parsed.location || '').split(',')[0], now(), req.user.id);
  }
  invalidateDigest(req.user.id);
  res.json({ profile: getProfile(req.user.id) });
}));

const asList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean).slice(0, 60);

app.put('/api/profile', (req, res) => {
  const b = req.body || {};
  const levels = ['student', 'entry', 'junior', 'mid', 'senior', 'lead'];
  db.prepare(`INSERT INTO profiles (user_id) VALUES (?) ON CONFLICT DO NOTHING`).run(req.user.id);
  db.prepare(`UPDATE profiles SET full_name = ?, contact_email = ?, phone = ?, location = ?, links = ?, summary = ?, skills = ?,
      experience_level = ?, years_experience = ?, job_titles = ?, preferred_roles = ?, updated_at = ? WHERE user_id = ?`).run(
    String(b.full_name || '').slice(0, 120), String(b.contact_email || '').slice(0, 200), String(b.phone || '').slice(0, 40),
    String(b.location || '').slice(0, 120), String(b.links || '').slice(0, 1000), String(b.summary || '').slice(0, 2000),
    JSON.stringify(asList(b.skills)), levels.includes(b.experience_level) ? b.experience_level : '',
    Math.max(0, Math.min(50, Number(b.years_experience) || 0)), JSON.stringify(asList(b.job_titles)),
    JSON.stringify(asList(b.preferred_roles)), now(), req.user.id,
  );
  invalidateDigest(req.user.id);
  res.json({ profile: getProfile(req.user.id) });
});

app.get('/api/preferences', (req, res) => res.json({ preferences: getPrefs(req.user.id) }));

app.put('/api/preferences', (req, res) => {
  const b = req.body || {};
  const types = (Array.isArray(b.work_types) ? b.work_types : []).filter((t) => ['onsite', 'remote', 'hybrid'].includes(t));
  db.prepare(`UPDATE preferences SET kind = ?, keywords = ?, location_mode = ?, city = ?, radius_km = ?, work_types = ?, min_salary = ?, updated_at = ? WHERE user_id = ?`).run(
    b.kind === 'internship' ? 'internship' : 'job',
    String(b.keywords || '').slice(0, 300),
    ['city', 'near', 'remote'].includes(b.location_mode) ? b.location_mode : 'city',
    String(b.city || '').slice(0, 100),
    Math.max(1, Math.min(200, Number(b.radius_km) || 25)),
    JSON.stringify(types.length ? types : ['onsite', 'remote', 'hybrid']),
    Math.max(0, Number(b.min_salary) || 0),
    now(), req.user.id,
  );
  invalidateDigest(req.user.id);
  res.json({ preferences: getPrefs(req.user.id) });
});

// ---------- jobs ----------

app.get('/api/digest', wrap(async (req, res) => {
  const uid = req.user.id;
  if (!getProfile(uid)) return res.json({ needsProfile: true, jobs: [] });
  let digest = db.prepare('SELECT * FROM digests WHERE user_id = ? AND day = ?').get(uid, today());
  if (!digest || req.query.refresh === '1') digest = await buildDigest(uid);
  const ids = json(digest.job_ids);
  const rows = ids.map((id) => db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(id, uid)).filter(Boolean);
  res.json({ day: digest.day, source: digest.source, scored_with: digest.scored_with, generated_at: digest.created_at, jobs: rows.map((r) => jobWithApp(uid, r)) });
}));

app.get('/api/jobs/added', (req, res) => {
  const rows = db.prepare(`SELECT * FROM jobs WHERE user_id = ? AND source = 'link' AND dismissed = 0 ORDER BY created_at DESC`).all(req.user.id);
  res.json({ jobs: rows.map((r) => jobWithApp(req.user.id, r)) });
});

app.post('/api/jobs/link', wrap(async (req, res) => {
  const uid = req.user.id;
  const profile = getProfile(uid);
  if (!profile) return bad(res, 'Upload your resume first so the job can be scored.');
  const url = String(req.body.url || '').trim();
  const pastedText = String(req.body.text || '').trim().slice(0, 40000);
  let job;
  try { job = await jobFromLink({ url, pastedText }); } catch (e) { return bad(res, e.message); }
  const id = saveJob(uid, 'link', job);
  db.prepare('UPDATE jobs SET dismissed = 0, scored_profile_at = NULL WHERE id = ?').run(id);
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  await scoreAndStore(uid, [row], profile, getPrefs(uid));
  if (!appForJob(uid, id)) {
    db.prepare(`INSERT INTO applications (user_id, job_id, history) VALUES (?, ?, ?)`).run(uid, id, JSON.stringify([{ stage: 'saved', at: now() }]));
  }
  res.json({ job: jobWithApp(uid, db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)) });
}));

function ownJob(req, res) {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!row) bad(res, 'Job not found.', 404);
  return row;
}

app.get('/api/jobs/:id', (req, res) => {
  const row = ownJob(req, res); if (!row) return;
  res.json({ job: jobWithApp(req.user.id, row) });
});

app.post('/api/jobs/:id/dismiss', (req, res) => {
  const row = ownJob(req, res); if (!row) return;
  db.prepare('UPDATE jobs SET dismissed = 1 WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

function ensureApp(uid, jobId) {
  let a = appForJob(uid, jobId);
  if (!a) {
    db.prepare(`INSERT INTO applications (user_id, job_id, history) VALUES (?, ?, ?)`).run(uid, jobId, JSON.stringify([{ stage: 'saved', at: now() }]));
    a = appForJob(uid, jobId);
  }
  return a;
}

app.post('/api/jobs/:id/save', (req, res) => {
  const row = ownJob(req, res); if (!row) return;
  res.json({ application: shapeApp(ensureApp(req.user.id, row.id)) });
});

app.post('/api/jobs/:id/prepare', wrap(async (req, res) => {
  const row = ownJob(req, res); if (!row) return;
  const uid = req.user.id;
  const profile = getProfile(uid);
  if (!profile) return bad(res, 'Upload your resume first.');
  const a = ensureApp(uid, row.id);
  if (['applied', 'interview', 'offer'].includes(a.stage)) return bad(res, 'This application was already sent.');
  const prep = await prepareApplication(row, profile);
  db.prepare(`UPDATE applications SET cover_letter = ?, answers = ?, prepared_with = ?, review_state = 'pending', updated_at = ? WHERE id = ?`)
    .run(prep.cover_letter, JSON.stringify(prep.answers), prep.prepared_with, now(), a.id);
  res.json({ application: shapeApp(db.prepare('SELECT * FROM applications WHERE id = ?').get(a.id)) });
}));

// ---------- applications: review queue & tracker ----------

const STAGES = ['saved', 'approved', 'applied', 'interview', 'offer', 'rejected'];

app.get('/api/applications', (req, res) => {
  const filter = req.query.review === 'pending' ? `AND a.review_state = 'pending'` : '';
  const rows = db.prepare(`SELECT a.*, j.title, j.company, j.location, j.url, j.score, j.work_type, j.kind, j.source, j.posted_at,
      j.salary_min, j.salary_max, j.salary_period, j.salary_text
    FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.user_id = ? ${filter} ORDER BY a.updated_at DESC`).all(req.user.id);
  res.json({ applications: rows.map(shapeApp) });
});

function ownApp(req, res, id = req.params.id) {
  const row = db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(Number(id), req.user.id);
  if (!row) bad(res, 'Application not found.', 404);
  return row;
}

function setStage(a, stage) {
  if (a.stage === stage) return;
  const history = json(a.history);
  history.push({ stage, at: now() });
  db.prepare('UPDATE applications SET stage = ?, history = ?, updated_at = ? WHERE id = ?').run(stage, JSON.stringify(history), now(), a.id);
}

app.put('/api/applications/:id', (req, res) => {
  const a = ownApp(req, res); if (!a) return;
  const b = req.body || {};
  const answers = Array.isArray(b.answers)
    ? b.answers.slice(0, 20).map((x) => ({ question: String(x.question || '').slice(0, 300), answer: String(x.answer || '').slice(0, 4000) }))
    : json(a.answers);
  db.prepare('UPDATE applications SET cover_letter = ?, answers = ?, notes = ?, updated_at = ? WHERE id = ?').run(
    b.cover_letter !== undefined ? String(b.cover_letter).slice(0, 10000) : a.cover_letter,
    JSON.stringify(answers),
    b.notes !== undefined ? String(b.notes).slice(0, 5000) : a.notes,
    now(), a.id,
  );
  res.json({ application: shapeApp(db.prepare('SELECT * FROM applications WHERE id = ?').get(a.id)) });
});

function approve(a) {
  if (!a.cover_letter) return false;
  db.prepare(`UPDATE applications SET review_state = 'approved', updated_at = ? WHERE id = ?`).run(now(), a.id);
  if (a.stage === 'saved') setStage({ ...a }, 'approved');
  return true;
}

app.post('/api/applications/:id/approve', (req, res) => {
  const a = ownApp(req, res); if (!a) return;
  if (!approve(a)) return bad(res, 'Prepare the application before approving it.');
  res.json({ ok: true });
});

app.post('/api/applications/approve-bulk', (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).slice(0, 100);
  let approved = 0;
  for (const id of ids) {
    const a = db.prepare(`SELECT * FROM applications WHERE id = ? AND user_id = ? AND review_state = 'pending'`).get(Number(id), req.user.id);
    if (a && approve(a)) approved++;
  }
  res.json({ approved });
});

app.post('/api/applications/:id/reject', (req, res) => {
  const a = ownApp(req, res); if (!a) return;
  db.prepare(`UPDATE applications SET review_state = 'rejected', updated_at = ? WHERE id = ?`).run(now(), a.id);
  res.json({ ok: true });
});

app.post('/api/applications/:id/stage', (req, res) => {
  const a = ownApp(req, res); if (!a) return;
  const stage = String(req.body.stage || '');
  if (!STAGES.includes(stage)) return bad(res, 'Unknown stage.');
  // The approval gate: nothing moves to "Approved" or beyond without your explicit approval.
  if (stage === 'approved' && a.review_state !== 'approved') return bad(res, 'Approve it in Review & approve first.');
  if (['applied', 'interview', 'offer'].includes(stage) && a.review_state !== 'approved') {
    return bad(res, 'Only approved applications can be marked as applied. Review and approve it first.');
  }
  setStage(a, stage);
  res.json({ application: shapeApp(db.prepare('SELECT * FROM applications WHERE id = ?').get(a.id)) });
});

app.delete('/api/applications/:id', (req, res) => {
  const a = ownApp(req, res); if (!a) return;
  db.prepare('DELETE FROM applications WHERE id = ?').run(a.id);
  res.json({ ok: true });
});

// ---------- errors & SPA fallback ----------

app.use('/api', (req, res) => bad(res, 'Not found.', 404));
app.get('*', (req, res) => res.sendFile(path.resolve('public/index.html')));
app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) return bad(res, err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 8 MB.' : err.message);
  console.error(err);
  bad(res, 'Something went wrong. Please try again.', 500);
});

const PORT = Number(process.env.PORT || 3300);
app.listen(PORT, () => {
  console.log(`AI Job Hunter running on http://localhost:${PORT}`);
  console.log(`  AI: ${aiEnabled() ? `on (${aiModel()})` : 'off — using keyword matching (set ANTHROPIC_API_KEY to enable)'}`);
  console.log(`  Jobs: ${adzunaEnabled() ? `Adzuna (${process.env.ADZUNA_COUNTRY || 'in'})` : 'sample listings (set ADZUNA_APP_ID / ADZUNA_APP_KEY for live jobs)'}`);
});
