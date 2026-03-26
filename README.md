# JobAgent

An AI-powered job application assistant built for Siddardth Pathipaka — aerospace and manufacturing engineer. JobAgent automates the full job search pipeline: scraping postings daily, scoring them against four resume variants, rewriting resume sections per job, generating cover letters, and tracking the entire pipeline from first contact to offer.

**Live app:** [jobagentweb.netlify.app](https://jobagentweb.netlify.app)

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
A Python Flask microservice (deployed on Railway) compiles LaTeX templates with Tectonic and returns a PDF. The frontend sends the AI-rewritten content to the compiler and triggers a browser download — no local LaTeX installation required.

### Cover Letter Generator
AI generates a tailored cover letter for any job. The letter can be downloaded as a PDF via the same Railway compiler service.

### Networking CRM
Track contacts, outreach status, follow-up reminders, and connection analytics. Supports full lifecycle: Identified → Reached Out → Responded → Meeting → Offer Referral.

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
| Frontend | React 18 + Vite | Netlify (`jobagentweb.netlify.app`) |
| Resume / Cover Letter Compiler | Python Flask + Tectonic LaTeX | Railway (`resume-compiler-production.up.railway.app`) |
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
│   │   ├── Networking.jsx      # Networking CRM
│   │   ├── CompanyIntel.jsx    # Company research + outreach planner
│   │   └── Settings.jsx        # API key management + preferences
│   └── supabase.js             # Supabase client + data helpers
├── resume-compiler/            # Railway microservice
│   ├── app.py                  # Flask app — /compile endpoint
│   ├── Dockerfile              # Tectonic LaTeX + Python
│   └── templates/              # LaTeX resume templates (variants A–D)
├── scrapers/                   # Individual scraper modules
│   ├── ats_scraper.py          # Direct ATS board scraper
│   ├── jsearch_scraper.py      # JSearch API scraper
│   ├── apify_scraper.py        # Apify actor scraper
│   ├── serpapi_scraper.py      # SerpAPI Google Jobs scraper
│   └── theirstack_scraper.py   # TheirStack API scraper
├── pipeline/                   # Post-scrape processing
│   ├── merge_pipeline.py       # Deduplication + filter stack (F1–F9)
│   └── company_intelligence.py # H-1B / tier / industry enrichment
├── engine/                     # Orchestration layer
│   ├── scraper_orchestrator.py # Runs all scrapers in sequence
│   └── query_engine.py         # Query engine for stored job data
├── data/                       # Static reference data
│   ├── ats_companies.json      # ATS board URLs per company
│   ├── company_database.json   # H-1B / tier / industry lookup
│   ├── itar_keywords.json      # ITAR keyword blocklist
│   └── scraper_state.json      # Scraper run state
├── output/                     # Scraper output (committed by Actions)
│   └── jobs_clean_latest.json  # Latest clean job feed
├── .github/workflows/
│   └── daily_scrape.yml        # Daily cron — scrape → merge → enrich → commit
├── netlify.toml                # Netlify build + redirect config
├── vite.config.js              # Vite config
├── requirements.txt            # Python dependencies for scrapers/pipeline
└── M628_*.json                 # Siddardth's personal job data exports
```

---

## Setup

### Frontend (local dev)

1. Clone the repo.
2. Create a `.env` file at the root:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_COMPILER_URL=https://resume-compiler-production.up.railway.app
```

3. Install and run:

```bash
npm install
npm run dev
```

> **Note:** `VITE_GROQ_API_KEY` and `SERPER_API_KEY` are intentionally not stored as build-time env vars. They are entered through the Settings page in the app UI and persisted in Supabase — so no API keys live in the repository or in Netlify env vars.

### Netlify Deployment

Set the following environment variables in Netlify → Site settings → Environment variables:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `VITE_COMPILER_URL` | Railway service URL |

Build command: `npm run build`
Publish directory: `dist`

### Resume Compiler (Railway)

The `resume-compiler/` directory is a self-contained Flask service:

```bash
cd resume-compiler
docker build -t resume-compiler .
docker run -p 8080:8080 resume-compiler
```

For Railway deployment: connect the repo, set the root directory to `resume-compiler/`, and Railway will auto-detect the `Dockerfile`. No additional env vars required — the service is stateless.

### GitHub Actions (Scrapers)

The daily scrape runs automatically at 13:00 UTC every day. Configure the following repository secrets for the Actions workflow:

| Secret | Purpose |
|---|---|
| `JSEARCH_API_KEY` | JSearch RapidAPI key |
| `APIFY_TOKEN` | Apify personal access token |
| `SERPAPI_KEY` | SerpAPI key |
| `THEIRSTACK_API_KEY` | TheirStack API key |

To trigger a manual run: GitHub → Actions → Daily Job Scrape → Run workflow.

The workflow:
1. Runs all scrapers via `engine/scraper_orchestrator.py` — each scraper is isolated so one failure does not block others
2. Merges and filters results via `pipeline/merge_pipeline.py` (filter stack F1–F9)
3. Enriches with company data via `pipeline/company_intelligence.py`
4. Commits the output back to the `output/` directory
5. Prints a summary of green/yellow job counts and sources

---

## Supabase Schema

The schema is defined in `supabase_schema.sql`. Key tables:

- `settings` — stores user API keys (Groq, Serper) and preferences
- `jobs` — pipeline tracker state (applied, interview, offer)
- `networking` — CRM contacts and outreach log
- `company_intel` — company research notes

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

## LinkedIn DM CRM Integration

This app integrates with a local LinkedIn CRM tool that parses your LinkedIn message export and classifies conversations. The output is stored in Supabase and displayed in the Networking → LinkedIn DMs tab.

### Setup

**1. Export your LinkedIn data**
1. Go to LinkedIn → Settings → Data privacy → Get a copy of your data
2. Select "Messages" (and optionally Connections)
3. Download the `.zip` when ready (can take up to 24 hours)

**2. Run the LinkedIn CRM tool**
```
cd ~/Desktop/linkedin-crm
python main.py --input ~/Downloads/Basic_LinkedInDataExport_*.zip
```
This produces `output/contacts_export.csv`.

**3. Import contacts to Supabase**
```
cd /path/to/jobagent-web
pip install supabase python-dotenv
python linkedin_crm_import.py --csv ~/Desktop/linkedin-crm/output/contacts_export.csv
```
Output: `Imported N contacts. Y follow-ups. Z active opportunities.`

**4. View in the UI**
Open the app → Networking → **LinkedIn DMs** tab.

You'll see:
- Summary stats (total contacts, follow-ups, active opportunities, recruiters)
- Filterable contact cards with role/status badges and priority scoring
- Expandable conversation summaries
- Editable notes (auto-saved on blur)
- Orange left border + 🔔 for contacts needing follow-up

**5. Re-sync after a new LinkedIn export**
Re-run step 3. The import is fully idempotent — it upserts by contact ID (name slug + LinkedIn URL hash).

---

## Credits

Built by Siddardth Pathipaka. AI assistance from Claude (Anthropic).
