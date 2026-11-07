import { z } from 'zod';
import { askJSON } from './ai.js';
import { findSkills, hasSkill } from './skills.js';

export const COMMON_QUESTIONS = [
  'Tell us about yourself.',
  'Why are you interested in this role?',
  'Why should we hire you for this position?',
  'Describe a project you are proud of.',
  'When can you start?',
];

const PrepSchema = z.object({
  cover_letter: z.string().describe('Under 250 words, 3-4 short paragraphs, no placeholders like [Company]'),
  answers: z.array(z.object({ question: z.string(), answer: z.string().describe('60-110 words, first person') })),
});

export async function prepareApplication(job, profile) {
  const ai = await askJSON({
    system: 'You write honest, specific job applications in the candidate\'s voice. Never invent employers, degrees, numbers or skills that are not in the resume. Plain text, no markdown, warm but professional.',
    prompt: `JOB: ${job.title} at ${job.company || 'the company'} (${job.location})\n${(job.description || '').slice(0, 5000)}\n\nCANDIDATE: ${profile.full_name || 'the candidate'}\nSkills: ${(profile.skills || []).join(', ')}\nTitles: ${(profile.job_titles || []).join('; ')}\nResume:\n"""\n${(profile.resume_text || '').slice(0, 20000)}\n"""\n\nWrite a tailored cover letter and answer each of these questions:\n${COMMON_QUESTIONS.map((q) => `- ${q}`).join('\n')}`,
    schema: PrepSchema,
    effort: 'medium',
  });
  if (ai) return { ...ai, prepared_with: 'ai' };
  return { ...templatePrep(job, profile), prepared_with: 'template' };
}

function templatePrep(job, profile) {
  const name = profile.full_name || 'Your Name';
  const company = job.company || 'your team';
  const greeting = job.company ? `Dear Hiring Team at ${job.company},` : 'Dear Hiring Team,';
  const jobSkills = findSkills(`${job.title} ${job.description}`);
  const overlap = jobSkills.filter((s) => hasSkill(profile.skills || [], s)).slice(0, 4);
  const skills = overlap.length ? overlap : (profile.skills || []).slice(0, 4);
  const skillText = skills.length > 1 ? `${skills.slice(0, -1).join(', ')} and ${skills.at(-1)}` : skills[0] || 'the core skills for this role';
  const recent = (profile.job_titles || [])[0];
  const exp = profile.years_experience ? `${profile.years_experience} years of experience` : 'hands-on project experience';

  const cover_letter = `${greeting}

I am excited to apply for the ${job.title} position. ${recent ? `As a ${recent} with ${exp}` : `With ${exp}`}, I have worked extensively with ${skillText} — the same areas this role focuses on.

${profile.summary || `I enjoy turning ambiguous problems into clear, well-crafted outcomes and working closely with cross-functional teams.`} I would bring that same care and ownership to ${company}.

I would welcome the chance to discuss how I can contribute. Thank you for your time and consideration.

Warm regards,
${name}${profile.contact_email ? `\n${profile.contact_email}` : ''}${profile.phone ? ` · ${profile.phone}` : ''}`;

  const answers = [
    { question: COMMON_QUESTIONS[0], answer: `I am ${recent ? `a ${recent}` : 'an early-career professional'} with ${exp}. My strongest skills are ${skillText}. ${profile.summary || ''}`.trim() },
    { question: COMMON_QUESTIONS[1], answer: `The ${job.title} role at ${company} matches what I do best — ${skillText} — and it is the direction I want to grow in. I am keen to contribute to a team doing this work.` },
    { question: COMMON_QUESTIONS[2], answer: `I already work with ${skillText}, which this role relies on, and I learn new tools quickly. I take ownership of my work and communicate clearly with the people around me.` },
    { question: COMMON_QUESTIONS[3], answer: 'Edit me: describe one project from your resume — the problem, what you did, and the result (with a number if you can).' },
    { question: COMMON_QUESTIONS[4], answer: 'Edit me: your notice period or earliest start date.' },
  ];
  return { cover_letter, answers };
}
