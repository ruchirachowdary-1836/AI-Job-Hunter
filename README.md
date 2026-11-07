# AI Job Hunter

An AI job-hunting agent. It reads your resume, picks your 10 best-fit jobs every day, writes a tailored cover letter and answers for each one, and keeps everything in a review queue. **Nothing is applied without your approval**, and the app never submits a form for you.

## Run it

```bash
npm install
cp .env.example .env     # optional: add keys (see below)
npm start                # http://localhost:3300
```

Needs Node 22.13 or newer (it uses the built-in `node:sqlite`, so there is no database to install).

It works with **no keys at all**: you get sample jobs, keyword matching and template cover letters. Add the keys when you're ready.

| Secret | What it turns on | Where to get it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | AI resume parsing, AI match scores and reasons, tailored cover letters and answers, reading job pages that have no structured data | console.anthropic.com |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Real job listings, fetched daily | developer.adzuna.com (free) |
| `ADZUNA_COUNTRY` | Adzuna country (`in`, `gb`, `us`, …); default `in` | — |

Keys live only in `.env` locally, or in your host's secret settings. `.env` is git-ignored, and keys are never sent to the browser.

## How it works

- **Login**: email + password (hashed with scrypt) and an HttpOnly session cookie. Each user only sees their own data.
- **Resume**: upload a PDF or .docx. Claude extracts your name, contact details, skills, experience level, titles held and preferred roles (with a keyword parser as the fallback). Everything is editable on the Profile page.
- **Preferences**: job or internship, role keywords, city / near me (radius) / remote only, work types, and minimum salary (₹/yr) or stipend (₹/month).
- **Daily top 10**: every morning (`DIGEST_HOUR`, default 7) the app fetches fresh jobs for each active user, applies your filters, scores them, and keeps the 10 best. Each job shows a score, 2–3 reasons, missing skills, company, location, salary and posting date. Weak fits (below `MIN_MATCH_SCORE`, default 30) are left out instead of padding the list. **Refresh** rebuilds the list on demand.
- **Add by link**: paste any job URL. The app reads the page's JobPosting data, or uses AI on the page text, and scores the job. For sites behind a login (LinkedIn etc.), paste the description instead. Links to private or internal network addresses are refused.
- **Application prep → Review & approve**: "Prepare application" drafts a cover letter and 5 common answers, and the draft waits in **Review**. You can edit, approve, reject, or approve several at once.
- **Apply kit**: available only for approved applications. It shows your details and answers with copy buttons. "Open apply page" copies your cover letter and opens the employer's site, where you check everything and submit it yourself. Then press "I've submitted it".
- **Tracker**: Saved → Approved → Applied → Interview → Offer / Rejected, with a dated timeline and notes. You can drag cards on desktop or change the status in the card. The server refuses to mark anything Applied (or later) unless you approved it.

## Deploying

Any Node host works, Render included. Set the secrets as environment variables and mount a persistent disk, then set `DATA_DIR` to its path so the SQLite database survives restarts. Set `NODE_ENV=production` so the session cookie is marked `Secure`.
