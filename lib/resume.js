import { createRequire } from 'node:module';
import mammoth from 'mammoth';
import { z } from 'zod';
import { askJSON } from './ai.js';
import { findSkills, findTitles } from './skills.js';

const require = createRequire(import.meta.url);
// Import the library file directly: pdf-parse's index runs a self-test on import.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

export async function extractText(file) {
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.pdf') || file.mimetype === 'application/pdf') {
    const out = await pdfParse(file.buffer);
    return out.text;
  }
  if (name.endsWith('.docx') || file.mimetype?.includes('officedocument.wordprocessingml')) {
    const out = await mammoth.extractRawText({ buffer: file.buffer });
    return out.value;
  }
  if (name.endsWith('.txt')) return file.buffer.toString('utf8');
  if (name.endsWith('.doc')) {
    throw new Error('Old .doc files are not supported — please save it as .docx or PDF.');
  }
  throw new Error('Please upload a PDF or Word (.docx) resume.');
}

const ProfileSchema = z.object({
  full_name: z.string(),
  contact_email: z.string(),
  phone: z.string(),
  location: z.string().describe('City, Country if present, else empty'),
  links: z.string().describe('Portfolio / LinkedIn / GitHub URLs, comma separated'),
  summary: z.string().describe('Two-sentence professional summary in first person'),
  skills: z.array(z.string()).describe('Hard skills and tools, most important first, max 25'),
  experience_level: z.enum(['student', 'entry', 'junior', 'mid', 'senior', 'lead']),
  years_experience: z.number(),
  job_titles: z.array(z.string()).describe('Titles held, most recent first'),
  preferred_roles: z.array(z.string()).describe('3-5 role titles this person should target next'),
});

export async function parseResume(text) {
  const ai = await askJSON({
    system: 'You extract structured candidate profiles from resumes. Only use facts present in the resume; use empty strings when unknown.',
    prompt: `Resume:\n"""\n${text.slice(0, 60000)}\n"""`,
    schema: ProfileSchema,
  });
  if (ai) return { ...ai, parsed_with: 'ai' };
  return { ...keywordParse(text), parsed_with: 'keywords' };
}

function keywordParse(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] || '';
  const phone = text.match(/(\+?\d[\d\s().-]{8,}\d)/)?.[0]?.trim() || '';
  const links = [...new Set(text.match(/(https?:\/\/[^\s)]+|(?:www\.)?(?:linkedin\.com|github\.com|behance\.net|dribbble\.com)\/[^\s)]+)/gi) || [])].join(', ');
  const name = lines.find((l) => /^[A-Za-z][A-Za-z.'-]+(\s+[A-Za-z][A-Za-z.'-]+){1,3}$/.test(l) && l.length < 40) || '';

  const yearMatches = [...text.matchAll(/(\d{1,2})\+?\s*(?:years|yrs)/gi)].map((m) => Number(m[1])).filter((n) => n < 40);
  let years = yearMatches.length ? Math.max(...yearMatches) : 0;
  if (!years) {
    // Estimate from date ranges like "2021 – 2023" / "2022 - Present".
    const thisYear = new Date().getFullYear();
    const spans = [...text.matchAll(/(20\d{2}|19\d{2})\s*[-–—to]+\s*(20\d{2}|present|current|now)/gi)]
      .map((m) => (/\d/.test(m[2]) ? Number(m[2]) : thisYear) - Number(m[1]))
      .filter((n) => n >= 0 && n < 40);
    years = spans.length ? Math.min(spans.reduce((a, b) => a + b, 0), 40) : 0;
  }
  const isStudent = /\b(student|pursuing|b\.?tech|b\.?e\.?|bachelor|undergraduate|expected graduation|class of)\b/i.test(text) && years < 1;
  const level = isStudent ? 'student' : years < 1 ? 'entry' : years < 3 ? 'junior' : years < 6 ? 'mid' : years < 10 ? 'senior' : 'lead';

  const titles = findTitles(text);
  const skills = findSkills(text);
  const roles = isStudent ? titles : titles.filter((t) => !/\bintern(ship)?\b/i.test(t));
  return {
    full_name: name,
    contact_email: email,
    phone,
    location: findLocation(lines.slice(0, 8).join('\n')),
    links,
    summary: '',
    skills,
    experience_level: level,
    years_experience: years,
    job_titles: titles,
    preferred_roles: (roles.length ? roles : titles).slice(0, 3),
  };
}

const CITIES = [
  'Bengaluru', 'Bangalore', 'Hyderabad', 'Chennai', 'Mumbai', 'Pune', 'Delhi', 'New Delhi', 'Gurugram', 'Gurgaon', 'Noida',
  'Kolkata', 'Ahmedabad', 'Kochi', 'Jaipur', 'Chandigarh', 'Indore', 'Coimbatore', 'Visakhapatnam', 'Vijayawada', 'Lucknow',
  'Bhubaneswar', 'Thiruvananthapuram', 'Mysuru', 'Nagpur', 'London', 'Manchester', 'New York', 'San Francisco', 'Seattle',
  'Austin', 'Boston', 'Chicago', 'Toronto', 'Vancouver', 'Sydney', 'Melbourne', 'Singapore', 'Dubai', 'Berlin', 'Amsterdam',
];

/** Find "City[, Region/Country]" in the resume header. */
function findLocation(header) {
  for (const city of CITIES) {
    const m = header.match(new RegExp(`\\b${city}\\b(\\s*,\\s*[A-Z][A-Za-z ]{1,25})?`));
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return '';
}
