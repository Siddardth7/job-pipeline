# Spec: April Quality Approach — Website Update
**Date:** 2026-04-12 | **Status:** Approved

---

## Context

March post-mortem: 3/3 interviews came from networking, 0 from applications. Primary track shifted from Manufacturing-first to **Quality Engineer** (QE / NPI QE / MQE / SQE). Resumes were rebuilt (Resume_April.tex, Resume_Quality_Engineer.tex) with:
- Summary section removed entirely — resumes start with SKILLS
- Skills order: Certifications → Quality/Analysis → Manufacturing/Process → Tools/Software
- All 6 accuracy overclaims corrected (audit report)
- Two new projects added: FMEA Risk Prioritization Tool, Virtual Composite Laminate Design
- 25 curated target companies scored and ranked (Target_Company_List.md)

This spec covers updating the website to match the new approach across 3 independent tracks.

---

## Track 1 — Accuracy & Skills Fixes

**Files:** `src/lib/groq.js`, `src/lib/scoring.js`

### groq.js — Candidate Background

The CANDIDATE BACKGROUND block injected into every AI-generated resume summary prompt contains 6 accuracy overclaims that were corrected in the resume audit. Replace the entire facts block:

**Current (overclaims):**
- SAMPE: "achieving first-article success with under 2% void content"
- SAMPE S3: "deploying automated leak detection"
- Tata Boeing T1: "Led SPC-based investigation"
- Tata Boeing T2: "Established GD&T-driven CMM inspection workflow validating 450+ components"
- Tata Boeing T3: "Drove cross-functional MRB dispositions"
- Beckman: "enabling scalable out-of-autoclave manufacturing"

**Corrected facts to use:**
```
- Tata Boeing Aerospace: Audited GD&T-based CMM inspection records for 450+ flight-critical components to 0.02 mm accuracy, supporting zero customer escapes; introduced 8D structured problem-solving into MRB process reducing nonconformance cycle time by 22%; implemented SPC-guided corrective actions (revised CNC tool change intervals) reducing position tolerance defect rate from 15% to under 3%; built FMEA-based justification for supplier nonconformance enabling use-as-is disposition that prevented ~$3,000 in scrap and 4-week delay
- SAMPE Competition: Built 24-inch composite fuselage via prepreg layup and autoclave cure (275°F, lab-limited 40 psi) — part sustained 2,700 lbf at test (2.7× design requirement); built pFMEA ranking 5 failure modes (vacuum bag leaks highest, RPN=60) and standardized pressurized hold test protocol (20 psi) achieving zero process deviations; optimized laminate stacking using Python (simulated annealing) + ABAQUS FEA achieving 38% deflection reduction vs baseline
- Beckman Institute: Developed and validated out-of-autoclave cure method using frontal polymerization — proof-of-concept compression from 8+ hours to under 5 minutes; predicted cure behavior within 10% velocity accuracy and 3°C of peak temperatures (94% optimization acceleration)
- EQIC: Mapped 12-stage die production workflow identifying inter-stage handoff points as primary tolerance accumulation sources; verified die component tolerances to ±0.02 mm (GD&T) on 800-bar HPDC tooling
- FMEA Risk Prioritization Tool: Python/Streamlit deployed tool implementing AIAG FMEA-4 standards — RPN scoring, Pareto 80/20 risk ranking, criticality flagging, PDF/Excel export; validated with 61 unit tests on aerospace CFRP dataset
- Virtual Composite Laminate Design & Optimization: Classical Laminate Theory engine with Simulated Annealing optimizer, validated against CalculiX FEA achieving <1% deflection error and <3% stress error on IM7/8552 CFRP plate
```

### scoring.js — TEMPLATE_SUMMARIES

Fix Variant C only: remove "2% void content" → use 2,700 lbf fact.

### scoring.js — TEMPLATE_SKILLS (all 4 variants)

Add `Certifications:` line at top of every variant. Align skill groupings to match new resume structure. Remove skills absent from new resume (ANSYS Fluent, MOOSE Framework, HyperWorks, C/C++). Add RCCA, Process Validation, Lean Principles where missing.

New structure per variant:

**Variant A — Manufacturing & Plant Ops:**
```
Certifications: Six Sigma Green Belt (CSSC) | Inspection & Quality Control in Manufacturing (NPTEL)
Quality / Analysis: pFMEA, SPC, 8D Root Cause Analysis, RCCA, CMM Inspection, GD&T, First Article Inspection, CAPA
Manufacturing / Process: Prepreg Layup, Autoclave Processing, Cure Cycle Development, GD&T, CMM Inspection, PPAP, AS9100, Process Validation, Lean Principles
Tools / Software: SolidWorks, CATIA, MATLAB, Python, AutoCAD
```

**Variant B — Process & CI:**
```
Certifications: Six Sigma Green Belt (CSSC) | Inspection & Quality Control in Manufacturing (NPTEL)
Quality / Analysis: pFMEA, SPC, 8D Root Cause Analysis, RCCA, DMAIC, CAPA, MRB Disposition
Process / CI: Value Stream Mapping, Poka-Yoke, 5S, OEE, Defect Reduction, Lean Principles, Kaizen, Process Validation
Tools / Software: SolidWorks, MATLAB, Python, Minitab, AutoCAD
```

**Variant C — Quality & Materials:**
```
Certifications: Six Sigma Green Belt (CSSC) | Inspection & Quality Control in Manufacturing (NPTEL)
Quality / Analysis: pFMEA, SPC, 8D Root Cause Analysis, RCCA, MRB Disposition, CAPA, GD&T, CMM Inspection
Materials / Process: Prepreg Layup, Autoclave Processing, Vacuum Bagging, Cure Cycle Development, Out-of-Autoclave Methods, NDT, AS9100
Tools / Software: ABAQUS, FEA, Classical Lamination Theory, SolidWorks, MATLAB, Python, AutoCAD
```

**Variant D — Equipment & NPI:**
```
Certifications: Six Sigma Green Belt (CSSC) | Inspection & Quality Control in Manufacturing (NPTEL)
Quality / Analysis: pFMEA, RCCA, CAPA, 8D Root Cause Analysis, SPC, First Article Inspection
NPI / Tooling: DOE, APQP, Process Validation, New Product Introduction, Design Review, Manufacturing Readiness
Tools / Software: SolidWorks, CATIA, FEA, MATLAB, Python, AutoCAD
```

---

## Track 2 — Company Intel Rebuild

**Files:** `src/data/april_targets.js` (new file), `src/components/CompanyIntel.jsx`

### Data Model

```js
{
  name: string,           // "Joby Aviation"
  category: string,       // "eVTOL" | "EV" | "Space" | "Commercial Aircraft" | "Composites Supplier" | "Advanced Mfg" | "MRO" | "UAV / Drone"
  location: string,       // "Santa Cruz CA / Marina CA"
  stage: string,          // "Pre-production, FAA certification"
  score: number,          // total score out of 18
  scores: {               // individual dimension scores (1-3 each)
    d1: number,           // OPT/ITAR access
    d2: number,           // Composites relevance
    d3: number,           // Scale-up stage
    d4: number,           // Culture fit
    d5: number,           // Quality roles match
    d6: number            // No clearance
  },
  h1b: string,            // "YES" | "LIKELY" | "NO"
  h1bCount: number|null,  // confirmed FY2026 filings or null
  h1bNewHires: number|null,
  itar: string,           // "NO" | "YES" | "MIXED"
  roles: string[],        // ["NPI QE", "QE"] — role type codes
  priority: string,       // "top" | "mid" | "low" | "monitor" | "hold"
  priorityNote: string,   // "" | "Live QE app" | "If SC ok" | etc.
  hook: string,           // Why this company / what to lead with
  watch: string,          // Watch flag text (empty string if none)
  atsBoardUrl: string,
  atsPlatform: string,
  domain: string
}
```

### 25 Companies (from Target_Company_List.md)

All 25 companies from the April target list populated with the full data model above.

Priority mapping:
- 🔴 Top: Joby, Archer, Tesla, Rivian, Lucid, AST SpaceMobile, Boom Supersonic, Wing Aviation, Munich Composites SC
- 🟡 Mid: Wisk Aero, Beta Technologies, Eve Air Mobility, Xwing, Relativity Space, Hexcel, Toray, Syensqo, Re:Build Mfg, Divergent, Vast, StandardAero
- 🟢 Low/Monitor: Loft Orbital, Hermeus, Chasm Advanced Materials
- ⏸ Hold: Spirit AeroSystems

### CompanyIntel.jsx Changes

**Import:** Replace `M628` with `APRIL_TARGETS` from `'../data/april_targets.js'`

**Header:** Update subtitle to "25 target companies | April 2026"

**Filters:**
- Replace Tier filter dropdown (1–6) with Priority filter chips: All / Top / Mid / Low / Monitor / Hold
- Keep H-1B Sponsors chip filter (maps to `h1b === "YES"`)
- Keep search by name/category

**Card layout (updated):**
```
┌─────────────────────────────────────────────────┐
│ 🔴 Joby Aviation                    [17/18]      │
│ eVTOL · Santa Cruz CA · Pre-production           │
│                                                  │
│ [NPI QE] [QE]   H1B: LIKELY  ITAR: NO           │
│                                                  │
│ ▼ Why this company (collapsed by default)        │
│   "Tata Boeing audit background + FMEA tool..."  │
│                                                  │
│ ⚠ Watch: "Role may be titled Quality Engineer-NPI│
│                                                  │
│ [Job Board]  [Cold Outreach →]                  │
└─────────────────────────────────────────────────┘
```

- Priority emoji: 🔴 top / 🟡 mid / 🟢 low / 👁 monitor / ⏸ hold
- Score badge: `17/18` pill in top-right
- Role chips: each role type rendered as a small chip
- H1B: show count if known (e.g. "H1B: 635") else "H1B: LIKELY"
- Hook: collapsed by default, expand on click ("Why?" toggle)
- Watch: amber warning row, only shown if `watch` is non-empty
- Cold Outreach and Job Board buttons unchanged (same behavior)

**Add Company modal:** Keep existing fields — new companies users add manually don't need the full scoring model.

---

## Track 3 — Hide Summary in JobAnalysis

**File:** `src/components/JobAnalysis.jsx`

**Changes:**
- Remove the subtitle paragraph "Resume modifications for ATS optimization (2 edits only: Summary + Skills)" entirely
- Wrap "Mod 1 — Summary" card with `display: 'none'`
- Change the 2-column grid (`gridTemplateColumns: "1fr 1fr"`) holding [Summary | Skills] to a single column so "Mod 2 — Skills" renders full width
- All wiring to `mod1_summary` / `_generateSummary` left intact — logic unchanged

---

## Implementation Order

All 3 tracks are independent. Implement in parallel via subagent-driven-development:
- Agent A → Track 1 (groq.js + scoring.js)
- Agent B → Track 2 (april_targets.js + CompanyIntel.jsx)
- Agent C → Track 3 (JobAnalysis.jsx summary hide)

---

## Success Criteria

- [ ] No "2% void content" or other audit overclaims appear in any AI-generated output
- [ ] All 4 resume variant skill blocks include Certifications as first line
- [ ] Company Intel shows exactly 25 companies with priority, score, roles, hook, watch data
- [ ] Priority filter chips work correctly (Top/Mid/Low/Monitor/Hold)
- [ ] "Mod 1 — Summary" card is not visible in Job Analysis
- [ ] Mod 2 — Skills renders full width
- [ ] No subtitle text below Job Analysis heading
- [ ] All existing functionality (Cold Outreach planner, Add Company, networking route) still works
