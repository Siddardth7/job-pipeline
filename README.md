# JobAgent

An AI-powered job application assistant built for Siddardth Pathipaka — aerospace and manufacturing engineer. JobAgent automates the full job search pipeline: scraping postings daily, scoring them against four resume variants, rewriting resume sections per job, generating cover letters, and tracking the entire pipeline from first contact to offer.

**Live app:** [jobagent-web.vercel.app](https://jobagent-web.vercel.app)

---

## What It Does

### Job Feed Aggregator
Scrapers pull from multiple sources (ATS boards, JSearch, Apify, SerpAPI, TheirStack) every day via GitHub Actions. Results are deduplicated, filtered through a nine-stage hard-filter stack (ITAR flags, location, experience level, company tier, etc.), enriched with company intelligence (H-1B sponsorship history, industry classification, tier rating), and stored as `output/jobs_clean_latest.json` — the canonical feed the frontend reads.

### AI Job Analysis (Groq LLaMA)
Each job can be analyzed by an LLM (llama-3.3-70b-versatile via Groq). The analysis produces:
- A match score with reasoning
- A rewritten resume summary tailored to the role
- A rewritten skills section emphasizing the most relevant competencies
- Keyword gaps between the job description and the resume

### Four Resume Variants
Siddardth maintains four LaTeX resume variants targeting different role families:
- **Variant A** — Manufacturing Engineering
- **Variant B** — Process / Continuous Improvement
- **Variant C** — Quality / Materials
- **Variant D** — Equipment / NPI

### One-Click PDF Download
A Python Flask microservice (deployed on Google Cloud Run) compiles LaTeX templates with Tectonic and returns a PDF. The frontend sends the AI-rewritten content to the compiler and triggers a browser download — no local LaTeX installation required.

### Cover Letter Generator
AI generates a tailored cover letter for any job. The letter can be downloaded as a PDF via the same Cloud Run compiler service.

### Networking CRM
Track contacts, outreach status, follow-up reminders, and connection analytics. Unified `contacts` table covers the full lifecycle: Find → Sent → Accepted → Replied → Coffee Chat → Referral Secured.

### Company Intel
Research target companies, track cold outreach plans, and store notes. Integrates with the job feed so company data is pre-populated from the enrichment pipeline.

### Job Pipeline Tracker
Kanban-style board with Applied, Phone Screen, Interview, and Offer stages. Jobs move through stages and the board persists in Supabase.

### Historical Run Browser
Browse all previous daily scrape runs in the job feed UI. Each daily commit archives the output JSON — the frontend fetches the file list from the GitHub API and lets you load any historical snapshot.

---

## Architecture

| Layer | Technology | Deployment |
|---|---|---|
| Frontend | React 18 + Vite | Vercel (`jobagent-web.vercel.app`) |
| Resume / Cover Letter Compiler | Python Flask + Tectonic LaTeX | Google Cloud Run (`resume-compiler-jobagent`) |
| Database | Supabase (PostgreSQL) | Supabase cloud |
| Job Scrapers | Python 3.11 | GitHub Actions (daily cron) |
| AI | Groq API (llama-3.3-70b-versatile) | Groq cloud (key stored in Supabase settings) |
| Job Search | Serper API | Serper cloud (key stored in Supabase settings) |

```
jobagent-web/
├── src/                        # React frontend
│   ├── components/
│   │   ├── Dashboard.jsx       # Overview + quick stats
│   │   ├── FindJobs.jsx        # Job feed + historical run browser
│   │   ├── JobAnalysis.jsx     # AI scoring + resume rewriting
│   │   ├── Pipeline.jsx        # Kanban pipeline tracker
│   │   ├── Applied.jsx         # Applied jobs log
│   │   ├── Networking.jsx      # Networking CRM (3-tab: Find / My Network / Actions)
│   │   ├── CompanyIntel.jsx    # Company research + outreach planner
│   │   └── Settings.jsx        # API key management + preferences
│   └── lib/
│       ├── storage.js          # Supabase data helpers
│       └── dashboard-utils.js  # Dashboard stat calculations
├── resume-compiler/            # Google Cloud Run microservice
│   ├── app.py                  # Flask app — /generate + /generate-cover-letter endpoints
│   ├── Dockerfile              # Tectonic LaTeX + Python (build for linux/amd64)
│   └── templates/              # LaTeX resume templates (variants A–D)
├── scrapers/                   # Individual scraper modules
├── pipeline/                   # Post-scrape processing (merge, filter, enrich)
├── engine/                     # Orchestration layer
├── data/                       # Static reference data (ATS, H-1B, ITAR)
├── output/                     # Scraper output (committed by Actions)
│   └── jobs_clean_latest.json  # Latest clean job feed
└── .github/workflows/
    └── daily_scrape.yml        # Daily cron — scrape → merge → enrich → commit
```

---

## Setup

### Frontend (local dev)

1. Clone the repo.
2. Create a `.env.local` file at the root:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_COMPILER_URL=https://resume-compiler-1077806152183.us-central1.run.app
```

3. Install and run:

```bash
npm install
npm run dev
```

> **Note:** `VITE_GROQ_API_KEY` and `SERPER_API_KEY` are intentionally not stored as build-time env vars. They are entered through the Settings page in the app UI and persisted in Supabase — so no API keys live in the repository or in Vercel env vars.

### Vercel Deployment

Set the following environment variables in Vercel → Project → Settings → Environment Variables:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `VITE_COMPILER_URL` | `https://resume-compiler-1077806152183.us-central1.run.app` |

Build command: `npm run build`
Output directory: `dist`

### Resume Compiler (Google Cloud Run)

The `resume-compiler/` directory is a self-contained Flask service deployed on Google Cloud Run (project: `resume-compiler-jobagent`).

**To redeploy after changes:**

```bash
cd resume-compiler
docker build --platform linux/amd64 -t gcr.io/resume-compiler-jobagent/resume-compiler:latest .
docker push gcr.io/resume-compiler-jobagent/resume-compiler:latest
gcloud run deploy resume-compiler \
  --image gcr.io/resume-compiler-jobagent/resume-compiler:latest \
  --platform managed --region us-central1 --allow-unauthenticated \
  --port 8080 --memory 512Mi --project resume-compiler-jobagent
```

> **Note:** Always build with `--platform linux/amd64` — Cloud Run requires amd64 and the Tectonic binary URL will 404 on ARM builds.

**To run locally:**
```bash
docker build --platform linux/amd64 -t resume-compiler .
docker run -p 8080:8080 resume-compiler
```

### GitHub Actions (Scrapers)

The daily scrape runs automatically at 13:00 UTC every day. Configure the following repository secrets for the Actions workflow:

| Secret | Purpose |
|---|---|
| `JSEARCH_API_KEY` | JSearch RapidAPI key |
| `APIFY_TOKEN` | Apify personal access token |
| `SERPAPI_KEY` | SerpAPI key |
| `THEIRSTACK_API_KEY` | TheirStack API key |

To trigger a manual run: GitHub → Actions → Daily Job Scrape → Run workflow.

### LinkedIn Sync Scripts

Three Python scripts sync LinkedIn data into the `contacts` table. All require `JOBAGENT_USER_ID` in your shell environment:

```bash
export JOBAGENT_USER_ID=de1bafab-7e76-4b80-a7ed-8de86c6d9bad
```

| Script | Purpose |
|---|---|
| `linkedin_crm_import.py` | Import contacts from LinkedIn CSV export |
| `linkedin_messages_import.py` | Import conversation data from LinkedIn messages export |
| `linkedin_intelligence_v2.py` | Run AI intelligence scoring on contacts |

---

## Supabase Schema

Key tables:

- `contacts` — unified networking contacts (merged from linkedin_dm_contacts + netlog)
- `jobs` — scraped job listings
- `applications` — application tracking
- `settings` — user preferences + API keys

---

## Resume Variants

| Variant | Target Role Family | Focus |
|---|---|---|
| A | Manufacturing Engineering | Production, tooling, manufacturing processes |
| B | Process / Continuous Improvement | Lean, Six Sigma, CI initiatives |
| C | Quality / Materials | QMS, materials qualification, inspection |
| D | Equipment / NPI | Capital equipment, new product introduction |

LaTeX templates live in `resume-compiler/templates/`. The AI analysis step rewrites the summary and skills sections for the best-matching variant before compilation.

---

## Credits

Built by Siddardth Pathipaka. AI assistance from Claude (Anthropic).
