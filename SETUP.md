# JobAgent v6.0 — Setup Guide

## Prerequisites
- A [Supabase](https://supabase.com) account (free tier works)
- A [Vercel](https://vercel.com) account (free tier works)
- A [GitHub](https://github.com) account
- A [Serper](https://serper.dev) API key (for Find Contacts feature)

---

## Step 1: Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the project to finish initializing (~2 minutes)
3. Go to **SQL Editor** in the left sidebar
4. Paste the entire contents of `supabase_schema.sql` and click **Run**
5. You should see 6 tables created: `jobs`, `applications`, `contacts`, `netlog`, `templates`, `settings`

**Get your credentials:**
- Go to **Settings > API** in your Supabase project
- Copy the **Project URL** (looks like `https://xxxxx.supabase.co`)
- Copy the **anon/public** key (a long JWT string)

---

## Step 2: Push to GitHub

```bash
cd /Users/jashwanth/jobagent-web
git init
git add -A
git commit -m "Initial commit — JobAgent v6.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/jobagent-web.git
git push -u origin main
```

---

## Step 3: Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and click **Add New Project**
2. Import your `jobagent-web` repository from GitHub
3. Vercel will auto-detect it as a Vite project — leave settings as-is
4. **DO NOT deploy yet** — add environment variables first (Step 4)

---

## Step 4: Add Environment Variables in Vercel

In your Vercel project settings, go to **Settings > Environment Variables** and add:

| Name | Value |
|------|-------|
| `VITE_SUPABASE_URL` | Your Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `SERPER_API_KEY` | Your Serper API key (get at serper.dev) |

Make sure all three are set for **Production**, **Preview**, and **Development** environments.

---

## Step 5: Deploy

1. Click **Deploy** in Vercel (or trigger a new deploy after adding env vars)
2. Wait ~1 minute for the build
3. Your app will be live at `https://your-project.vercel.app`

---

## Step 6: Migrate Old Data (Optional)

If you used JobAgent v5.x with GitHub Gist sync:

1. Open your deployed app
2. Go to **API & Settings** in the sidebar
3. Scroll to **Import from GitHub Gist**
4. Enter your old Gist ID and GitHub token
5. Click **Import from Gist**
6. Your applications and networking log will be migrated to Supabase

---

## Local Development

```bash
# Copy .env.local and fill in your values
cp .env.local.example .env.local

# Edit .env.local with your actual Supabase credentials
nano .env.local

# Install and run
npm install
npm run dev
```

Access the app at `http://localhost:5173`

---

## Architecture Overview

```
src/
  App.jsx              — Main app shell, routing, Supabase data loading
  supabase.js          — Supabase client initialization
  data/
    m628.js            — 257-company database with H-1B and ITAR data
  lib/
    scoring.js         — Keyword-based resume variant scoring (A/B/C/D)
    templates.js       — Message templates for networking outreach
    storage.js         — Supabase CRUD operations
  components/
    Dashboard.jsx      — Analytics overview
    FindJobs.jsx       — GitHub feed, JSON upload, external job entry
    Pipeline.jsx       — Job workflow management
    JobAnalysis.jsx    — ATS scoring, resume variant recommendation
    Networking.jsx     — Contact finding + message drafting
    Applied.jsx        — Application tracker + CSV export
    CompanyIntel.jsx   — Company database browser
    Settings.jsx       — Templates, Serper test, Gist migration

api/
  find-contacts.js     — Vercel serverless: Serper LinkedIn search
```

---

## Key Features

- **No AI API key required** — Job Analysis uses local keyword scoring
- **Find Contacts** uses Serper (Google search) to find LinkedIn profiles
- **Message Templates** — 4 default templates, fully editable
- **ITAR/Blacklist screening** — Real-time flags on job analysis
- **CSV Export** — Download applications and networking logs
- **Dark/Light mode** — Persisted to Supabase settings
- **257 companies** in M628 database with H-1B and ITAR status
