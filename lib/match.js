import { z } from 'zod';
import { askJSON } from './ai.js';
import { findSkills, hasSkill, normalise } from './skills.js';

const STOP = new Set(['and', 'or', 'the', 'a', 'of', 'for', 'in', 'to', 'with', 'senior', 'junior', 'sr', 'jr', 'i', 'ii', 'iii']);
const words = (s) => normalise(s).split(' ').filter((w) => w && !STOP.has(w));

function roleOverlap(title, targets) {
  const t = new Set(words(title).map((w) => w.replace(/s$/, '')));
  let best = { ratio: 0, target: '' };
  for (const target of targets) {
    const tw = words(target).map((w) => w.replace(/s$/, ''));
    if (!tw.length) continue;
    const hit = tw.filter((w) => t.has(w) || (w === 'ux' && t.has('ui')) || (w === 'ui' && t.has('ux'))).length;
    const ratio = hit / tw.length;
    if (ratio > best.ratio) best = { ratio, target };
  }
  return best;
}

/** Deterministic scorer used when no AI key is configured (or the AI call fails). */
export function keywordScore(job, profile, prefs) {
  const text = `${job.title}\n${job.description}`;
  const jobSkills = findSkills(text);
  const mine = profile.skills || [];
  const matched = jobSkills.filter((s) => hasSkill(mine, s));
  const missing = jobSkills.filter((s) => !hasSkill(mine, s));

  const skillRatio = jobSkills.length ? matched.length / jobSkills.length : 0.25;
  const targets = [
    ...(prefs.keywords || '').split(','),
    ...(profile.preferred_roles || []),
    ...(profile.job_titles || []),
  ].map((s) => s.trim()).filter(Boolean);
  const role = roleOverlap(job.title, targets);

  // Experience fit
  const asked = Number(text.match(/(\d{1,2})\s*\+?\s*(?:-\s*\d+\s*)?(?:years|yrs)/i)?.[1] || 0);
  const have = Number(profile.years_experience || 0);
  const junior = ['student', 'entry'].includes(profile.experience_level);
  let expFit = 0.6;
  if (job.kind === 'internship') expFit = junior ? 1 : 0.5;
  else if (asked) expFit = have >= asked ? 1 : have >= asked - 1 ? 0.6 : 0.2;
  else if (/fresh|entry|graduate/i.test(text)) expFit = junior || have < 2 ? 1 : 0.6;

  const workOk = (prefs.work_types || []).includes(job.work_type);
  const ageDays = job.posted_at ? (Date.now() - new Date(job.posted_at)) / 864e5 : 7;

  const score = Math.round(
    skillRatio * 55 + role.ratio * 25 + expFit * 10 + (workOk ? 5 : 0) + Math.max(0, 5 - ageDays * 0.7),
  );

  const reasons = [];
  if (matched.length) reasons.push(`Uses ${matched.length} of your skills: ${matched.slice(0, 4).join(', ')}`);
  if (role.ratio >= 0.5) reasons.push(`Title lines up with your target role “${role.target}”`);
  if (expFit === 1) reasons.push(job.kind === 'internship' ? 'Internship suits your current experience level' : asked ? `Asks for ${asked}+ years — you have ${have}` : 'Open to your experience level');
  if (workOk && reasons.length < 3) reasons.push(`${cap(job.work_type)} — matches your work-type preference`);
  if (!reasons.length) reasons.push('Partial overlap with your profile');

  return { score: Math.min(99, Math.max(1, score)), reasons: reasons.slice(0, 3), missing_skills: missing.slice(0, 5), scored_with: 'keywords' };
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const ScoreSchema = z.object({
  results: z.array(z.object({
    id: z.number(),
    score: z.number().describe('0-100 fit score'),
    reasons: z.array(z.string()).describe('2-3 short, specific reasons it fits, max 14 words each'),
    missing_skills: z.array(z.string()).describe('Important required skills the candidate lacks, max 5'),
  })),
});

function profileBrief(profile, prefs) {
  return [
    `Level: ${profile.experience_level || 'unknown'} (${profile.years_experience || 0} yrs)`,
    `Titles: ${(profile.job_titles || []).join('; ')}`,
    `Target roles: ${[prefs.keywords, ...(profile.preferred_roles || [])].filter(Boolean).join('; ')}`,
    `Looking for: ${prefs.kind}, work types ${(prefs.work_types || []).join('/')}`,
    `Skills: ${(profile.skills || []).join(', ')}`,
    `Summary: ${profile.summary || ''}`,
    `Resume excerpt:\n${(profile.resume_text || '').slice(0, 6000)}`,
  ].join('\n');
}

/**
 * Score many jobs. Uses Claude in batches when available and falls back to
 * keyword scoring per job for anything the AI did not return.
 */
export async function scoreJobs(jobs, profile, prefs) {
  const out = new Map();
  const brief = profileBrief(profile, prefs);
  for (let i = 0; i < jobs.length; i += 20) {
    const batch = jobs.slice(i, i + 20);
    const ai = await askJSON({
      system: 'You are a careful recruiter. Score how well each job fits the candidate (skills, seniority, role). Be honest: weak fits score low. Reasons must cite concrete overlaps.',
      prompt: `CANDIDATE\n${brief}\n\nJOBS\n${batch.map((j) => `[id ${j.id}] ${j.title} — ${j.company} (${j.location}, ${j.work_type}, ${j.kind})\n${(j.description || '').slice(0, 1500)}`).join('\n\n')}`,
      schema: ScoreSchema,
    });
    for (const r of ai?.results || []) {
      out.set(r.id, {
        score: Math.round(Math.min(100, Math.max(0, r.score))),
        reasons: r.reasons.slice(0, 3),
        missing_skills: r.missing_skills.slice(0, 5),
        scored_with: 'ai',
      });
    }
  }
  for (const j of jobs) if (!out.has(j.id)) out.set(j.id, keywordScore(j, profile, prefs));
  return out;
}

/** Hard filters from preferences. Unknown values pass. */
export function passesFilters(job, prefs) {
  if (prefs.kind && job.kind && job.kind !== prefs.kind) return false;
  const types = prefs.work_types || [];
  if (types.length && job.work_type && !types.includes(job.work_type)) return false;
  if (prefs.location_mode === 'remote' && job.work_type !== 'remote') return false;
  if ((prefs.location_mode === 'city' || prefs.location_mode === 'near') && prefs.city) {
    const ALIAS = { bangalore: 'bengaluru', gurgaon: 'gurugram', bombay: 'mumbai', madras: 'chennai', calcutta: 'kolkata' };
    const fix = (s) => normalise(s).split(' ').map((w) => ALIAS[w] || w).join(' ');
    const city = fix(prefs.city).split(' ')[0];
    const local = fix(job.location).includes(city);
    const remoteOk = job.work_type === 'remote' && types.includes('remote');
    if (!local && !remoteOk) return false;
  }
  if (prefs.min_salary > 0 && job.salary_max) {
    // Stipend preferences are monthly; job salaries are usually yearly.
    const wantMonthly = prefs.kind === 'internship';
    const jobMonthly = job.salary_period === 'month' ? job.salary_max : job.salary_max / 12;
    const want = wantMonthly ? prefs.min_salary : prefs.min_salary / 12;
    if (jobMonthly < want) return false;
  }
  return true;
}
