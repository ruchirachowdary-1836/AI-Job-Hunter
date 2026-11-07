import dns from 'node:dns/promises';
import net from 'node:net';
import { z } from 'zod';
import { askJSON } from './ai.js';
import { sampleJobs } from './sample-jobs.js';

export const adzunaEnabled = () => Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);

export function detectWorkType(text) {
  const t = String(text || '').toLowerCase();
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  if (/\b(remote|work from home|wfh|anywhere)\b/.test(t)) return 'remote';
  return 'onsite';
}

export const detectKind = (title) => (/\b(intern|internship|trainee|apprentice)\b/i.test(title) ? 'internship' : 'job');

/** Fresh listings for a user's preferences: Adzuna if keys exist, otherwise the sample set. */
export async function fetchFeed(profile, prefs) {
  if (!adzunaEnabled()) return { source: 'sample', jobs: sampleJobs() };

  const phrases = (prefs.keywords || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!phrases.length) phrases.push(...(profile.preferred_roles || []).slice(0, 3));
  if (!phrases.length) phrases.push(...(profile.job_titles || []).slice(0, 2));
  if (!phrases.length) phrases.push('graduate');

  const country = (process.env.ADZUNA_COUNTRY || 'in').toLowerCase();
  const seen = new Map();
  for (const phrase of phrases.slice(0, 3)) {
    const params = new URLSearchParams({
      app_id: process.env.ADZUNA_APP_ID,
      app_key: process.env.ADZUNA_APP_KEY,
      results_per_page: '40',
      what: prefs.kind === 'internship' && !/intern/i.test(phrase) ? `${phrase} intern` : phrase,
      max_days_old: '7',
      sort_by: 'date',
    });
    if (prefs.location_mode === 'remote') params.set('what_or', 'remote hybrid wfh');
    else if (prefs.city) {
      params.set('where', prefs.city);
      if (prefs.location_mode === 'near') params.set('distance', String(prefs.radius_km || 25));
    }
    const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Adzuna HTTP ${res.status}`);
      const data = await res.json();
      for (const r of data.results || []) {
        if (seen.has(String(r.id))) continue;
        const text = `${r.title} ${r.description}`;
        seen.set(String(r.id), {
          external_id: String(r.id),
          title: stripTags(r.title),
          company: r.company?.display_name || '',
          location: r.location?.display_name || '',
          work_type: detectWorkType(text),
          kind: detectKind(r.title),
          salary_min: r.salary_min ?? null,
          salary_max: r.salary_max ?? null,
          salary_period: 'year',
          salary_text: r.salary_is_predicted === '1' ? 'estimated' : '',
          description: stripTags(r.description),
          url: r.redirect_url,
          posted_at: r.created,
        });
      }
    } catch (error) {
      console.error('[adzuna]', error.message);
    }
  }
  return { source: 'adzuna', jobs: [...seen.values()] };
}

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- Add a job by link ----------

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('That does not look like a valid link.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) links are supported.');
  const addrs = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('Could not reach that website.');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error('That link points to a private network address.');
  return url;
}

async function safeFetchHtml(raw) {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; AIJobHunter/1.0)', accept: 'text/html,application/xhtml+xml' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertPublicUrl(new URL(res.headers.get('location'), url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`The site answered with HTTP ${res.status}. Paste the job description instead.`);
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 3_000_000) { reader.cancel(); break; }
      chunks.push(value);
    }
    return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: url.toString() };
  }
  throw new Error('Too many redirects.');
}

const decode = (s) => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function findJobPosting(html) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const stack = Array.isArray(data) ? [...data] : [data];
      while (stack.length) {
        const node = stack.shift();
        if (!node || typeof node !== 'object') continue;
        const type = [].concat(node['@type'] || []);
        if (type.includes('JobPosting')) return node;
        if (node['@graph']) stack.push(...node['@graph']);
      }
    } catch { /* ignore malformed blocks */ }
  }
  return null;
}

const meta = (html, key) => decode(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)`, 'i'))?.[1]
  || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, 'i'))?.[1] || '');

function pageText(html) {
  return decode(html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

const LinkJobSchema = z.object({
  is_job_posting: z.boolean(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  work_type: z.enum(['onsite', 'remote', 'hybrid']),
  kind: z.enum(['job', 'internship']),
  salary_text: z.string().describe('Salary or stipend exactly as written, or empty'),
  description: z.string().describe('Responsibilities and requirements, up to ~250 words, plain text'),
});

/** Read a job page (or pasted text) and return a normalised job. */
export async function jobFromLink({ url, pastedText = '' }) {
  let html = '';
  let finalUrl = url;
  let fetchError = null;
  if (url && !pastedText) {
    try { ({ html, finalUrl } = await safeFetchHtml(url)); } catch (e) { fetchError = e; }
  }
  if (!html && !pastedText) throw fetchError || new Error('Add a link or paste the job description.');

  const posting = html ? findJobPosting(html) : null;
  let job = null;
  if (posting) {
    const loc = [].concat(posting.jobLocation || [])[0]?.address || {};
    const salary = posting.baseSalary?.value || {};
    job = {
      title: decode(posting.title || ''),
      company: decode(posting.hiringOrganization?.name || ''),
      location: [loc.addressLocality, loc.addressRegion, loc.addressCountry?.name || loc.addressCountry].filter((x) => typeof x === 'string' && x).join(', '),
      work_type: posting.jobLocationType === 'TELECOMMUTE' ? 'remote' : detectWorkType(posting.description),
      description: pageText(decode(posting.description || '')).slice(0, 6000),
      salary_min: Number(salary.minValue || salary.value) || null,
      salary_max: Number(salary.maxValue || salary.value) || null,
      salary_period: /month/i.test(salary.unitText || '') ? 'month' : 'year',
      posted_at: posting.datePosted ? new Date(posting.datePosted).toISOString() : null,
    };
    job.kind = detectKind(job.title);
  }

  const text = pastedText || pageText(html);
  if (!job || !job.description) {
    const ai = await askJSON({
      system: 'You extract job postings from web page text. Use empty strings for unknown fields.',
      prompt: `URL: ${finalUrl || 'n/a'}\nPage title: ${html ? meta(html, 'og:title') || decode(html.match(/<title>([^<]*)/i)?.[1]) : ''}\n\nPage text:\n"""\n${text.slice(0, 40000)}\n"""`,
      schema: LinkJobSchema,
    });
    if (ai && ai.is_job_posting) {
      job = { ...ai, salary_min: null, salary_max: null, salary_period: 'year', posted_at: null, ...(job || {}), description: job?.description || ai.description };
    } else if (!job) {
      // No AI: best-effort title/company from the page title or "Role at Company" in the text.
      const first = text.split('\n')[0];
      const atMatch = first.match(/^(.{3,80}?)\s+(?:at|@|-|–|—|\|)\s+([A-Z][\w&.' ]{1,40}?)(?=[,.(\n]|\s+-|$)/);
      const title = (html ? meta(html, 'og:title') || decode(html.match(/<title>([^<]*)/i)?.[1]) : '')
        || atMatch?.[1] || first.split(/[.!?](\s|$)/)[0];
      job = {
        title: title.trim().slice(0, 120) || 'Untitled job',
        company: (html ? meta(html, 'og:site_name') : '') || atMatch?.[2]?.trim() || '',
        location: detectWorkType(text.slice(0, 300)) === 'remote' ? 'Remote' : '',
        work_type: detectWorkType(text),
        kind: detectKind(title),
        salary_min: null, salary_max: null, salary_period: 'year',
        description: text.slice(0, 6000),
        posted_at: null,
      };
    }
  }
  if (text.length < 200 && !posting && !pastedText) {
    throw new Error('That page had almost no readable text (the site may require login). Paste the job description instead.');
  }
  return { ...job, url: finalUrl || url || '', external_id: finalUrl || url || `pasted-${Date.now()}` };
}
