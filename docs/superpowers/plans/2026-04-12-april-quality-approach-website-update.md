# April Quality Approach — Website Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update jobagent-web to be consistent with the April quality-focused job search strategy — fixing accuracy overclaims in AI prompts, aligning skills section structure, replacing the company database with 25 curated targets, and hiding the removed resume summary section from the UI.

**Architecture:** Three independent tracks. Track 1 fixes the AI prompt candidate background and skills data in `groq.js` and `scoring.js`. Track 2 replaces the 628-company `m628.js` data source with a new `april_targets.js` file containing 25 scored companies, and updates `CompanyIntel.jsx` to render rich priority/score/hook data. Track 3 hides the "Mod 1 — Summary" card in `JobAnalysis.jsx` since the summary section was removed from all resume variants.

**Tech Stack:** React 18, Vite, Vitest, Supabase. All changes are to `.js` / `.jsx` files — no schema migrations, no API changes.

---

## File Map

| File | Action | Track |
|---|---|---|
| `src/lib/groq.js` | Modify — fix candidate background facts block (lines 68–72) | 1 |
| `src/lib/scoring.js` | Modify — fix TEMPLATE_SUMMARIES[C] + rewrite TEMPLATE_SKILLS all 4 variants | 1 |
| `src/data/april_targets.js` | **Create** — 25 curated target companies with full data model | 2 |
| `src/components/CompanyIntel.jsx` | Modify — import, filters, card layout, add-company form | 2 |
| `src/components/JobAnalysis.jsx` | Modify — remove subtitle, hide Mod 1 card, make Skills full-width | 3 |

---

## Track 1 — Accuracy & Skills Fixes

### Task 1: Fix groq.js candidate background

**Files:**
- Modify: `src/lib/groq.js:68-72`

- [ ] **Step 1: Open the file and locate the CANDIDATE BACKGROUND block**

The block to replace is at approximately lines 68–72:
```
CANDIDATE BACKGROUND (use only these facts, never invent):
- Degree: MS Aerospace Engineering, UIUC, Dec 2025. Entry level — never claim seniority.
- Tata Boeing Aerospace: CMM-inspected 450+ flight-critical components to 0.02 mm, zero customer escapes; drove defect rate 15% → 3% using SPC and 8D root cause analysis on GE and Boeing programs; MRB disposition and RCCA investigations on aerospace flight hardware
- SAMPE Competition: Fabricated 24-inch composite fuselage to 2% void content, autoclave at 275°F and 40 psi
- Beckman Institute: Compressed composite cure cycle from 8 hours to 5 minutes using DOE-driven process development
```

- [ ] **Step 2: Replace with corrected facts (all 6 overclaims fixed + 2 projects added)**

Replace the entire block above with:
```
CANDIDATE BACKGROUND (use only these facts, never invent):
- Degree: MS Aerospace Engineering, UIUC, Dec 2025. Entry level — never claim seniority.
- Tata Boeing Aerospace: Audited GD&T-based CMM inspection records for 450+ flight-critical components to 0.02 mm accuracy, supporting zero customer escapes on GE and Boeing programs; introduced 8D structured problem-solving into MRB process reducing nonconformance cycle time by 22%; implemented SPC-guided corrective actions (revised CNC tool change intervals) reducing position tolerance defect rate from 15% to under 3%; built FMEA-based engineering justification for supplier nonconformance enabling use-as-is disposition that prevented ~$3,000 in scrap and 4-week lead time delay
- SAMPE Competition: Built 24-inch composite fuselage via prepreg layup and autoclave cure (275°F, lab-limited 40 psi) — part sustained 2,700 lbf at test (2.7× design requirement); built pFMEA ranking 5 failure modes (vacuum bag leaks highest, RPN=60 using S=5 O=4 D=3) and standardized pressurized hold test protocol at 20 psi achieving zero process deviations; optimized laminate stacking using Python simulated annealing + ABAQUS FEA achieving 38% deflection reduction vs baseline; redesigned layup to dual-blanket structure (7 inner + 7 outer plies) overnight after ply geometry fit failure
- Beckman Institute: Developed and validated out-of-autoclave cure method using frontal polymerization — proof-of-concept compression of composite processing cycle from 8+ hours to under 5 minutes in a research setting; predicted cure behavior within 10% velocity accuracy and 3°C of peak temperatures, accelerating process parameter optimization by 94% through computational modeling
- EQIC Dies & Moulds: Mapped 12-stage die production workflow (CNC machining, EDM, heat treatment, assembly) identifying inter-stage handoff points as primary sources of dimensional tolerance accumulation; verified die component tolerances to ±0.02 mm (GD&T) and confirmed parting surface alignment (>80% contact) on 800-bar HPDC tooling
- FMEA Risk Prioritization Tool (Project): Deployed Python/Streamlit tool implementing AIAG FMEA-4 standards — RPN scoring, Pareto 80/20 risk ranking, criticality flagging, PDF/Excel export; validated with 61 unit tests on aerospace CFRP composite panel dataset
- Virtual Composite Laminate Design & Optimization (Project): Classical Laminate Theory engine with Simulated Annealing stacking sequence optimizer, validated against CalculiX FEA achieving <1% deflection error and <3% stress error on IM7/8552 CFRP plate
```

- [ ] **Step 3: Verify the file builds**

```bash
cd /Users/jashwanth/jobagent-web && npm run build 2>&1 | tail -20
```
Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/groq.js
git commit -m "fix: correct 6 resume accuracy overclaims in groq.js AI candidate background"
```

---

### Task 2: Fix scoring.js TEMPLATE_SUMMARIES and TEMPLATE_SKILLS

**Files:**
- Modify: `src/lib/scoring.js`

- [ ] **Step 1: Fix TEMPLATE_SUMMARIES Variant C (line ~27)**

Find and replace:
```js
  C: "Materials and quality engineer specializing in composites manufacturing and CMM inspection. Led 24-inch composite fuselage achieving 2% void content at SAMPE. STEM OPT — 3 years, no sponsorship cost.",
```
Replace with:
```js
  C: "Quality and materials engineer with composites manufacturing and CMM inspection experience. Built 24-inch composite fuselage — part sustained 2,700 lbf at test (2.7× design requirement). STEM OPT — 3 years, no sponsorship cost.",
```

- [ ] **Step 2: Replace TEMPLATE_SKILLS Variant A**

Find the entire Variant A block:
```js
  A: `\\skillline{Manufacturing \\& Quality:}{GD\\&T, CMM Inspection, First Article Inspection, PPAP, AS9100, SPC, Dimensional Inspection}
\\skillline{Process \\& Tooling:}{Fixtures \\& Jigs, Metrology, Tolerance Analysis, NADCAP, Production Planning, Shop Floor}
\\skillline{Engineering Tools:}{SolidWorks, CATIA, MATLAB, Python}
\\skillline{Manufacturing Processes:}{Machining, Assembly, Stamping, Casting, Forging, Welding, CNC}
\\skillline{Project Management:}{Cross-Functional Collaboration, Continuous Improvement, Lean Methodologies}`,
```
Replace with:
```js
  A: `\\skillline{Certifications:}{Six Sigma Green Belt (CSSC) \\textbar\\ Inspection \\& Quality Control in Manufacturing (NPTEL -- IIT Roorkee)}
\\skillline{Quality / Analysis:}{pFMEA, SPC, 8D Root Cause Analysis, RCCA, CMM Inspection, GD\\&T, First Article Inspection, CAPA, MRB Disposition}
\\skillline{Manufacturing / Process:}{Prepreg Layup, Autoclave Processing, Cure Cycle Development, GD\\&T, CMM Inspection, AS9100, Process Validation, Lean Principles, NADCAP}
\\skillline{Tools / Software:}{SolidWorks, CATIA, MATLAB, Python, AutoCAD}`,
```

- [ ] **Step 3: Replace TEMPLATE_SKILLS Variant B**

Find:
```js
  B: `\\skillline{Quality \\& CI Systems:}{FMEA, SPC, 8D Root Cause Analysis, DMAIC, CAPA, Kaizen, Lean, Six Sigma}
\\skillline{Process Tools:}{Value Stream Mapping, Poka-Yoke, 5S, OEE, Defect Reduction, Process Optimization, Corrective Action}
\\skillline{Engineering Tools:}{SolidWorks, MATLAB, Python, Minitab}
\\skillline{Documentation:}{Technical Writing, SOPs, Control Plans, Work Instructions, Change Control}
\\skillline{Project Management:}{Cross-Functional Collaboration, Continuous Improvement, Lean Methodologies}`,
```
Replace with:
```js
  B: `\\skillline{Certifications:}{Six Sigma Green Belt (CSSC) \\textbar\\ Inspection \\& Quality Control in Manufacturing (NPTEL -- IIT Roorkee)}
\\skillline{Quality / Analysis:}{pFMEA, SPC, 8D Root Cause Analysis, RCCA, DMAIC, CAPA, MRB Disposition}
\\skillline{Process / CI:}{Value Stream Mapping, Poka-Yoke, 5S, OEE, Defect Reduction, Lean Principles, Kaizen, Process Validation, Corrective Action}
\\skillline{Tools / Software:}{SolidWorks, MATLAB, Python, Minitab, AutoCAD}`,
```

- [ ] **Step 4: Replace TEMPLATE_SKILLS Variant C**

Find:
```js
  C: `\\skillline{Quality Systems:}{CAPA, FMEA, 8D Root Cause Analysis, SPC, MRB, GD\\&T, CMM Inspection}
\\skillline{Regulatory \\& Documentation:}{Technical Writing, SOPs, Change Control, Quality Records, ISO Standards, AS9100}
\\skillline{Manufacturing \\& Materials:}{Prepreg Layup, Autoclave Processing, Vacuum Bagging, Composite Materials, NDT}
\\skillline{Engineering Tools:}{ABAQUS, ANSYS, FEA, SolidWorks, CATIA, MATLAB, Python}
\\skillline{Project Management:}{Cross-Functional Collaboration, Continuous Improvement, Lean Methodologies}`,
```
Replace with:
```js
  C: `\\skillline{Certifications:}{Six Sigma Green Belt (CSSC) \\textbar\\ Inspection \\& Quality Control in Manufacturing (NPTEL -- IIT Roorkee)}
\\skillline{Quality / Analysis:}{pFMEA, SPC, 8D Root Cause Analysis, RCCA, MRB Disposition, CAPA, GD\\&T, CMM Inspection, First Article Inspection}
\\skillline{Materials / Process:}{Prepreg Layup, Autoclave Processing, Vacuum Bagging, Cure Cycle Development, Out-of-Autoclave Methods, NDT, AS9100}
\\skillline{Tools / Software:}{ABAQUS, FEA, Classical Lamination Theory, SolidWorks, MATLAB, Python, AutoCAD}`,
```

- [ ] **Step 5: Replace TEMPLATE_SKILLS Variant D**

Find:
```js
  D: `\\skillline{NPI \\& Tooling:}{PFMEA, DOE, APQP, Tooling Design, Fixture Design, Process Validation, IQ/OQ/PQ}
\\skillline{Product Development:}{New Product Introduction, Design Review, Prototype, Manufacturing Readiness, Commissioning}
\\skillline{Engineering Tools:}{SolidWorks, CATIA, FEA, MATLAB, Python}
\\skillline{Manufacturing:}{Capital Equipment, Production Launch, Process Development, Validation, R\\&D}
\\skillline{Project Management:}{Cross-Functional Collaboration, Continuous Improvement, Lean Methodologies}`,
```
Replace with:
```js
  D: `\\skillline{Certifications:}{Six Sigma Green Belt (CSSC) \\textbar\\ Inspection \\& Quality Control in Manufacturing (NPTEL -- IIT Roorkee)}
\\skillline{Quality / Analysis:}{pFMEA, RCCA, CAPA, 8D Root Cause Analysis, SPC, First Article Inspection, CMM Inspection}
\\skillline{NPI / Tooling:}{DOE, APQP, Process Validation, New Product Introduction, Design Review, Manufacturing Readiness, IQ/OQ/PQ}
\\skillline{Tools / Software:}{SolidWorks, CATIA, FEA, MATLAB, Python, AutoCAD}`,
```

- [ ] **Step 6: Also update BASE_SKILLLINES in groq.js to match**

In `src/lib/groq.js`, find the `BASE_SKILLLINES` object (around line 124) which is the structured version used for AI skill reordering. Update all 4 variants to match the same structure. The format is an array of `{label, skills}` objects.

Find and replace `BASE_SKILLLINES`:
```js
  const BASE_SKILLLINES = {
    A: [
      { label: "Certifications:", skills: "Six Sigma Green Belt (CSSC) | Inspection & Quality Control in Manufacturing (NPTEL -- IIT Roorkee)" },
      { label: "Quality / Analysis:", skills: "pFMEA, SPC, 8D Root Cause Analysis, RCCA, CMM Inspection, GD&T, First Article Inspection, CAPA, MRB Disposition" },
      { label: "Manufacturing / Process:", skills: "Prepreg Layup, Autoclave Processing, Cure Cycle Development, AS9100, Process Validation, Lean Principles, NADCAP" },
      { label: "Tools / Software:", skills: "SolidWorks, CATIA, MATLAB, Python, AutoCAD" }
    ],
    B: [
      { label: "Certifications:", skills: "Six Sigma Green Belt (CSSC) | Inspection & Quality Control in Manufacturing (NPTEL -- IIT Roorkee)" },
      { label: "Quality / Analysis:", skills: "pFMEA, SPC, 8D Root Cause Analysis, RCCA, DMAIC, CAPA, MRB Disposition" },
      { label: "Process / CI:", skills: "Value Stream Mapping, Poka-Yoke, 5S, OEE, Defect Reduction, Lean Principles, Kaizen, Process Validation, Corrective Action" },
      { label: "Tools / Software:", skills: "SolidWorks, MATLAB, Python, Minitab, AutoCAD" }
    ],
    C: [
      { label: "Certifications:", skills: "Six Sigma Green Belt (CSSC) | Inspection & Quality Control in Manufacturing (NPTEL -- IIT Roorkee)" },
      { label: "Quality / Analysis:", skills: "pFMEA, SPC, 8D Root Cause Analysis, RCCA, MRB Disposition, CAPA, GD&T, CMM Inspection, First Article Inspection" },
      { label: "Materials / Process:", skills: "Prepreg Layup, Autoclave Processing, Vacuum Bagging, Cure Cycle Development, Out-of-Autoclave Methods, NDT, AS9100" },
      { label: "Tools / Software:", skills: "ABAQUS, FEA, Classical Lamination Theory, SolidWorks, MATLAB, Python, AutoCAD" }
    ],
    D: [
      { label: "Certifications:", skills: "Six Sigma Green Belt (CSSC) | Inspection & Quality Control in Manufacturing (NPTEL -- IIT Roorkee)" },
      { label: "Quality / Analysis:", skills: "pFMEA, RCCA, CAPA, 8D Root Cause Analysis, SPC, First Article Inspection, CMM Inspection" },
      { label: "NPI / Tooling:", skills: "DOE, APQP, Process Validation, New Product Introduction, Design Review, Manufacturing Readiness, IQ/OQ/PQ" },
      { label: "Tools / Software:", skills: "SolidWorks, CATIA, FEA, MATLAB, Python, AutoCAD" }
    ]
  };
```

- [ ] **Step 7: Run build to verify**

```bash
cd /Users/jashwanth/jobagent-web && npm run build 2>&1 | tail -20
```
Expected: build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/scoring.js src/lib/groq.js
git commit -m "fix: update TEMPLATE_SKILLS all variants — certifications first, align with April resume structure"
```

---

## Track 2 — Company Intel Rebuild

### Task 3: Create april_targets.js

**Files:**
- Create: `src/data/april_targets.js`

- [ ] **Step 1: Create the file with the full 25-company dataset**

Create `src/data/april_targets.js` with this exact content:

```js
// April 2026 — 25 curated target companies
// Source: Target_Company_List.md (April_Job_Search_Strategy)
// Scoring: D1=OPT/ITAR access, D2=Composites relevance, D3=Scale-up stage,
//          D4=Culture fit, D5=Quality roles match, D6=No clearance (each 1–3, total /18)

export const APRIL_TARGETS = [
  // ── eVTOL ──────────────────────────────────────────────────────────────────
  {
    name: "Joby Aviation",
    category: "eVTOL",
    location: "Santa Cruz CA / Marina CA",
    stage: "Pre-production, FAA Part 135 certification",
    score: 17,
    scores: { d1: 3, d2: 3, d3: 3, d4: 3, d5: 2, d6: 3 },
    h1b: "LIKELY", h1bCount: null, h1bNewHires: null,
    itar: "NO",
    roles: ["NPI QE", "QE"],
    priority: "top", priorityNote: "",
    hook: "Tata Boeing audit background + FMEA tool + composites layup inspection maps directly to eVTOL rotor blade and fuselage panel qualification.",
    watch: "Role may be titled 'Quality Engineer – NPI' or 'Manufacturing Quality Engineer' — both are the same function at this stage.",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "jobyaviation.com"
  },
  {
    name: "Archer Aviation",
    category: "eVTOL",
    location: "San Jose CA / Covington GA",
    stage: "Type certificate application, transition to production",
    score: 17,
    scores: { d1: 3, d2: 3, d3: 3, d4: 3, d5: 2, d6: 3 },
    h1b: "YES", h1bCount: 13, h1bNewHires: 5,
    itar: "NO",
    roles: ["NPI QE", "QE"],
    priority: "top", priorityNote: "",
    hook: "GE Aerospace supplier quality audit experience + SAMPE composites work. Georgia manufacturing facility actively building — Covington GA location worth noting in outreach if open to Southeast.",
    watch: "",
    atsBoardUrl: "", atsPlatform: "Greenhouse", domain: "archer.com"
  },
  {
    name: "Wisk Aero",
    category: "eVTOL",
    location: "Mountain View CA",
    stage: "Autonomous prototype / pre-production",
    score: 14,
    scores: { d1: 3, d2: 2, d3: 2, d4: 2, d5: 2, d6: 3 },
    h1b: "YES", h1bCount: 8, h1bNewHires: 3,
    itar: "NO",
    roles: ["QE", "NPI QE"],
    priority: "mid", priorityNote: "",
    hook: "Boeing supply chain quality process familiarity (Tata Boeing context). Role likely covers both NPI and production support.",
    watch: "Boeing/Google JV — more conservative culture. Path to production is less clear than Joby/Archer.",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "wisk.aero"
  },
  {
    name: "Beta Technologies",
    category: "eVTOL",
    location: "Burlington VT",
    stage: "Fleet deployment + manufacturing scale-up",
    score: 16,
    scores: { d1: 3, d2: 2, d3: 3, d4: 3, d5: 2, d6: 3 },
    h1b: "LIKELY", h1bCount: null, h1bNewHires: null,
    itar: "NO",
    roles: ["QE", "NPI QE"],
    priority: "mid", priorityNote: "",
    hook: "Broad quality + composites background suits a company where the QE owns the whole quality function. Small team = high impact.",
    watch: "Relocation to Vermont required. Confirm remote/hybrid availability before investing networking bandwidth.",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "beta.team"
  },
  {
    name: "Eve Air Mobility",
    category: "eVTOL",
    location: "Melbourne FL",
    stage: "Pre-production / certification",
    score: 15,
    scores: { d1: 3, d2: 2, d3: 3, d4: 2, d5: 2, d6: 3 },
    h1b: "LIKELY", h1bCount: null, h1bNewHires: null,
    itar: "NO",
    roles: ["QE", "NPI QE"],
    priority: "mid", priorityNote: "",
    hook: "Embraer subsidiary. AS9100 quality processes + composites familiarity. Embraer OPT track record is generally positive.",
    watch: "",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "eveairmobility.com"
  },
  {
    name: "Xwing",
    category: "Autonomous Air",
    location: "Concord CA",
    stage: "Autonomous cargo flight testing / pre-commercial",
    score: 16,
    scores: { d1: 3, d2: 2, d3: 3, d4: 3, d5: 2, d6: 3 },
    h1b: "LIKELY", h1bCount: null, h1bNewHires: null,
    itar: "NO",
    roles: ["QE"],
    priority: "mid", priorityNote: "",
    hook: "Small team = QE covers everything: incoming inspection, FAI, supplier quality, nonconformance. FMEA + SPC background applicable to avionics/structures integration quality.",
    watch: "",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "xwing.com"
  },

  // ── EV ─────────────────────────────────────────────────────────────────────
  {
    name: "Tesla",
    category: "EV",
    location: "Fremont CA / Austin TX / Sparks NV",
    stage: "Mass production + new model launches",
    score: 16,
    scores: { d1: 3, d2: 2, d3: 3, d4: 2, d5: 3, d6: 3 },
    h1b: "YES", h1bCount: 635, h1bNewHires: null,
    itar: "NO",
    roles: ["MQE", "SQE", "NPI QE"],
    priority: "top", priorityNote: "",
    hook: "Lead with SPC + CMM + MRB experience. Tesla interviews are fast-moving; prepare for case-style technical screens. Austin TX and Fremont CA are the two main QE hubs.",
    watch: "Gigafactory Nevada is battery-focused — not the right QE hub.",
    atsBoardUrl: "https://www.tesla.com/careers", atsPlatform: "Tesla", domain: "tesla.com"
  },
  {
    name: "Rivian",
    category: "EV",
    location: "Normal IL / Stanton Springs GA",
    stage: "Active production scale-up",
    score: 17,
    scores: { d1: 3, d2: 2, d3: 3, d4: 3, d5: 3, d6: 3 },
    h1b: "YES", h1bCount: 109, h1bNewHires: null,
    itar: "NO",
    roles: ["MQE", "NPI QE", "SQE"],
    priority: "top", priorityNote: "",
    hook: "Body panel + structural assembly quality (Tata Boeing → aluminum/composite structures). AIAG FMEA methodology — the exact automotive standard Rivian uses. Normal IL is in the scale-up pain zone where MQE roles multiply.",
    watch: "Normal IL requires relocation. Georgia R2 plant is earlier stage with more NPI QE openings.",
    atsBoardUrl: "https://rivian.com/careers", atsPlatform: "Rivian", domain: "rivian.com"
  },
  {
    name: "Lucid Motors",
    category: "EV",
    location: "Newark CA / Casa Grande AZ",
    stage: "Production + Saudi expansion",
    score: 16,
    scores: { d1: 3, d2: 2, d3: 3, d4: 3, d5: 2, d6: 3 },
    h1b: "YES", h1bCount: 100, h1bNewHires: 40,
    itar: "NO",
    roles: ["MQE", "NPI QE", "QE"],
    priority: "top", priorityNote: "",
    hook: "Casa Grande AZ factory = composites assembly quality (CFRP panels, carbon fiber interior). Composites inspection background is unusually relevant for an EV manufacturer. 40 new H1B hires = active recent hiring.",
    watch: "",
    atsBoardUrl: "https://lucidmotors.com/careers", atsPlatform: "Lucid", domain: "lucidmotors.com"
  },

  // ── Space ──────────────────────────────────────────────────────────────────
  {
    name: "AST SpaceMobile",
    category: "Space",
    location: "Midland TX",
    stage: "Active satellite manufacturing + scaling",
    score: 16,
    scores: { d1: 2, d2: 2, d3: 3, d4: 3, d5: 3, d6: 3 },
    h1b: "YES", h1bCount: 4, h1bNewHires: null,
    itar: "NO",
    roles: ["QE", "MQE"],
    priority: "top", priorityNote: "Live QE app",
    hook: "BlueWalker CFRP deployable structures — composites background uniquely relevant. Already proven competitive for manufacturing role there.",
    watch: "",
    atsBoardUrl: "https://boards.greenhouse.io/astspacemobile", atsPlatform: "Greenhouse", domain: "ast-science.com"
  },
  {
    name: "Relativity Space",
    category: "Space",
    location: "Long Beach CA",
    stage: "Terran R development + additive manufacturing scale-up",
    score: 16,
    scores: { d1: 3, d2: 2, d3: 3, d4: 3, d5: 2, d6: 3 },
    h1b: "LIKELY", h1bCount: null, h1bNewHires: null,
    itar: "NO",
    roles: ["QE", "NPI QE"],
    priority: "mid", priorityNote: "",
    hook: "Python + FMEA tool + metrology background is genuinely rare — most quality engineers can't build the tooling. Lead with FMEA Risk Analyzer in outreach.",
    watch: "Recent layoffs (2023–2024) — verify current headcount and open roles before investing networking bandwidth.",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "relativityspace.com"
  },
  {
    name: "Loft Orbital",
    category: "Space",
    location: "San Francisco CA",
    stage: "Small satellite integration + launch services",
    score: 14,
    scores: { d1: 2, d2: 1, d3: 3, d4: 3, d5: 2, d6: 3 },
    h1b: "YES", h1bCount: 1, h1bNewHires: null,
    itar: "NO",
    roles: ["QE"],
    priority: "low", priorityNote: "",
    hook: "Small satellite integration — one QE covers supplier quality, incoming inspection, nonconformance.",
    watch: "Thin H1B signal (1 filing). Electronics-dominant role — not composites-primary. Lower priority.",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "loftorbital.com"
  },
  {
    name: "Vast",
    category: "Commercial Space",
    location: "Long Beach CA",
    stage: "Haven-1 space station development",
    score: 16,
    scores: { d1: 3, d2: 2, d3: 3, d4: 3, d5: 2, d6: 3 },
    h1b: "LIKELY", h1bCount: null, h1bNewHires: null,
    itar: "NO",
    roles: ["QE", "NPI QE"],
    priority: "mid", priorityNote: "",
    hook: "Commercial space station — startup culture, NPI quality organization being built from scratch.",
    watch: "",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "vast.space"
  },

  // ── Commercial Aircraft ────────────────────────────────────────────────────
  {
    name: "Boom Supersonic",
    category: "Commercial Aircraft",
    location: "Denver CO / Greeley CO",
    stage: "XB-1 flight test + Overture production design",
    score: 17,
    scores: { d1: 3, d2: 3, d3: 3, d4: 3, d5: 2, d6: 3 },
    h1b: "LIKELY", h1bCount: null, h1bNewHires: null,
    itar: "NO",
    roles: ["NPI QE", "QE"],
    priority: "top", priorityNote: "",
    hook: "100% composites fuselage and wing. Strongest composites alignment outside Joby/Archer. Hook: 'Two years doing composites audit and quality at Tata Boeing on GE Aerospace programs — I want to do the same thing on the most ambitious commercial aircraft being built right now.'",
    watch: "",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "boomsupersonic.com"
  },
  {
    name: "Spirit AeroSystems",
    category: "Commercial Aircraft",
    location: "Wichita KS / Kinston NC",
    stage: "Restructuring — Boeing acquisition pending",
    score: 12,
    scores: { d1: 2, d2: 3, d3: 2, d4: 1, d5: 2, d6: 2 },
    h1b: "YES", h1bCount: 1, h1bNewHires: null,
    itar: "MIXED",
    roles: ["MQE", "SQE", "QE"],
    priority: "hold", priorityNote: "Restructuring",
    hook: "Kinston NC composites site is most relevant. 737 fuselage, composites structures. Background maps well.",
    watch: "Boeing acquiring Wichita ops; Airbus taking Kinston and Belfast. Hiring likely frozen. Revisit in May once restructuring clarity improves.",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "spiritaero.com"
  },

  // ── Composites Suppliers ───────────────────────────────────────────────────
  {
    name: "Hexcel",
    category: "Composites Supplier",
    location: "Stamford CT / Decatur AL / Dublin CA",
    stage: "Established, growing aerospace demand",
    score: 15,
    scores: { d1: 3, d2: 3, d3: 2, d4: 2, d5: 2, d6: 3 },
    h1b: "LIKELY", h1bCount: null, h1bNewHires: null,
    itar: "NO",
    roles: ["QE", "SQE"],
    priority: "mid", priorityNote: "",
    hook: "World's largest aerospace prepreg manufacturer. Composites manufacturing background + cure cycle knowledge is your strongest hook — most quality hires don't have hands-on processing experience.",
    watch: "Role is materials QC, not structural assembly QC — slightly different domain. SPC applies directly to fiber areal weight, resin content.",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "hexcel.com"
  },
  {
    name: "Toray Composite Materials America",
    category: "Composites Supplier",
    location: "Tacoma WA",
    stage: "Established, capacity expansion",
    score: 14,
    scores: { d1: 3, d2: 3, d3: 2, d4: 1, d5: 2, d6: 3 },
    h1b: "LIKELY", h1bCount: null, h1bNewHires: null,
    itar: "NO",
    roles: ["QE"],
    priority: "mid", priorityNote: "",
    hook: "Carbon fiber and CFRP manufacturer (T700, T800 — Boeing 787, Airbus A350). CFRP knowledge + SPC + NADCAP experience from Tata Boeing audits directly relevant.",
    watch: "Large Japanese parent, Tacoma WA location, narrower roles. Lower priority than startup targets.",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "toraycma.com"
  },
  {
    name: "Syensqo",
    category: "Composites Supplier",
    location: "Alpharetta GA",
    stage: "Established + growing composites portfolio",
    score: 15,
    scores: { d1: 3, d2: 3, d3: 2, d4: 2, d5: 2, d6: 3 },
    h1b: "LIKELY", h1bCount: null, h1bNewHires: null,
    itar: "NO",
    roles: ["QE", "SQE"],
    priority: "mid", priorityNote: "",
    hook: "Specialty composites resins and CYCOM prepreg. Resin systems knowledge from prepreg processing is niche — most quality hires don't bring it. Solvay/Syensqo strong OPT hire history.",
    watch: "Confirm Syensqo vs Solvay entity — company separated in 2023. Check current legal entity for H1B.",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "syensqo.com"
  },
  {
    name: "Chasm Advanced Materials",
    category: "Composites Supplier",
    location: "Canton MA",
    stage: "Early startup, CNT composites scale-up",
    score: 16,
    scores: { d1: 3, d2: 3, d3: 3, d4: 3, d5: 1, d6: 3 },
    h1b: "YES", h1bCount: 1, h1bNewHires: 1,
    itar: "NO",
    roles: ["QE"],
    priority: "monitor", priorityNote: "",
    hook: "Carbon nanotube-enhanced composites. Materials science background (SEM, mechanical testing, cure characterization) is rare at this scale.",
    watch: "Very small company (~20-40 employees). Quality Engineering may not be a defined function yet. Check LinkedIn every 2 weeks for new postings.",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "chasmadvancedmaterials.com"
  },
  {
    name: "Munich Composites SC Inc",
    category: "Composites Mfg",
    location: "Landrum SC",
    stage: "Established CFRP parts production, US facility",
    score: 15,
    scores: { d1: 3, d2: 3, d3: 2, d4: 2, d5: 2, d6: 3 },
    h1b: "YES", h1bCount: 1, h1bNewHires: 1,
    itar: "NO",
    roles: ["QE", "MQE"],
    priority: "top", priorityNote: "If SC ok",
    hook: "Most direct composites manufacturing quality fit on the list. Tata Boeing composites audit (prepreg layup, autoclave, NADCAP, FAI) is textbook for a CFRP parts manufacturer's QE.",
    watch: "Landrum SC is rural (near Spartanburg). Relocation required. German parent = structured quality culture (ISO 9001, IATF 16949).",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "munich-composites.com"
  },

  // ── Advanced Mfg ───────────────────────────────────────────────────────────
  {
    name: "Re:Build Manufacturing",
    category: "Advanced Mfg",
    location: "Multiple US sites",
    stage: "Active acquisition + integration",
    score: 15,
    scores: { d1: 3, d2: 1, d3: 3, d4: 3, d5: 2, d6: 3 },
    h1b: "LIKELY", h1bCount: null, h1bNewHires: null,
    itar: "NO",
    roles: ["MQE", "QE"],
    priority: "mid", priorityNote: "",
    hook: "Acquires and rebuilds US advanced manufacturing facilities. Multi-industry quality background (aerospace audit + composites manufacturing) fits their model.",
    watch: "Not composites-primary in most acquired sites. Role fit is strong on quality systems but composites angle is weaker.",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "rebuildmanufacturing.com"
  },
  {
    name: "Divergent Technologies",
    category: "Advanced Mfg",
    location: "Torrance CA",
    stage: "Active production scale-up (Czinger + aerospace programs)",
    score: 14,
    scores: { d1: 2, d2: 2, d3: 3, d4: 3, d5: 2, d6: 2 },
    h1b: "LIKELY", h1bCount: null, h1bNewHires: null,
    itar: "MIXED",
    roles: ["QE", "NPI QE"],
    priority: "mid", priorityNote: "",
    hook: "Additive manufacturing for structural components (titanium + CFRP hybrid). FMEA + Python background is strong — their QE needs to build quality processes around brand-new manufacturing methods.",
    watch: "Some defense DARPA work — confirm role-level access requirements before applying.",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "divergent3d.com"
  },
  {
    name: "Hermeus",
    category: "Hypersonic",
    location: "Atlanta GA",
    stage: "Halcyon demonstrator development",
    score: 14,
    scores: { d1: 2, d2: 2, d3: 3, d4: 3, d5: 2, d6: 2 },
    h1b: "LIKELY", h1bCount: null, h1bNewHires: null,
    itar: "MIXED",
    roles: ["QE"],
    priority: "low", priorityNote: "",
    hook: "Small team = high ownership. FMEA + quality systems gives the process maturity they need.",
    watch: "ITAR-adjacent (hypersonic propulsion with Pratt & Whitney). Some programs may require US person access. Confirm before applying.",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "hermeus.com"
  },

  // ── MRO ────────────────────────────────────────────────────────────────────
  {
    name: "StandardAero",
    category: "MRO",
    location: "Scottsdale AZ / Multiple MRO sites",
    stage: "Established, growing MRO volume",
    score: 13,
    scores: { d1: 2, d2: 2, d3: 2, d4: 2, d5: 2, d6: 3 },
    h1b: "LIKELY", h1bCount: null, h1bNewHires: null,
    itar: "NO",
    roles: ["QE", "MQE"],
    priority: "mid", priorityNote: "",
    hook: "RCCA + MRB disposition from Tata Boeing directly transferable to MRO quality — same process on in-service parts.",
    watch: "Turbine/avionics MRO — not composites-primary. Good fit if eVTOL pipeline is slow.",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "standardaero.com"
  },

  // ── USCIS Data Finds ───────────────────────────────────────────────────────
  {
    name: "Wing Aviation LLC",
    category: "UAV / Drone",
    location: "Palo Alto CA",
    stage: "Commercial drone delivery scaling (Australia live, US expansion)",
    score: 16,
    scores: { d1: 3, d2: 2, d3: 3, d4: 3, d5: 2, d6: 3 },
    h1b: "YES", h1bCount: 7, h1bNewHires: 2,
    itar: "NO",
    roles: ["QE", "NPI QE"],
    priority: "top", priorityNote: "",
    hook: "Alphabet subsidiary. FMEA tool for actuator/flight system failure modes directly applicable. Alphabet = strongest H1B sponsorship record globally. Confirmed OPT-accessible.",
    watch: "",
    atsBoardUrl: "", atsPlatform: "Unknown", domain: "wing.com"
  },
];
```

- [ ] **Step 2: Verify the file has no syntax errors**

```bash
cd /Users/jashwanth/jobagent-web && node -e "import('./src/data/april_targets.js').then(m => console.log('Count:', m.APRIL_TARGETS.length))" 2>&1
```
Expected: `Count: 25`

If ES module import doesn't work in Node directly, use the build check instead:
```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/data/april_targets.js
git commit -m "feat: add april_targets.js — 25 curated target companies with full scoring data"
```

---

### Task 4: Update CompanyIntel.jsx

**Files:**
- Modify: `src/components/CompanyIntel.jsx`

- [ ] **Step 1: Replace the M628 import**

Find:
```js
import { M628 } from '../data/m628.js';
```
Replace with:
```js
import { APRIL_TARGETS } from '../data/april_targets.js';
```

- [ ] **Step 2: Add role badge style constants after the imports**

Add after the import block, before the `Card` component definition:
```js
const ROLE_BADGE = {
  'NPI QE': { bg: 'rgba(124,58,237,0.13)', color: '#7c3aed' },
  'QE':     { bg: 'rgba(2,132,199,0.13)',  color: '#0284c7' },
  'MQE':    { bg: 'rgba(217,119,6,0.13)',  color: '#d97706' },
  'SQE':    { bg: 'rgba(22,163,74,0.13)',  color: '#16a34a' },
};
const PRIORITY_EMOJI = { top: '🔴', mid: '🟡', low: '🟢', monitor: '👁', hold: '⏸' };
```

- [ ] **Step 3: Update the BLANK_FORM constant**

Find:
```js
const BLANK_FORM = { name:'', industry:'', tier:'2', h1b:'LIKELY', itar:'NO', roles:'', atsBoardUrl:'' };
```
Replace with:
```js
const BLANK_FORM = { name:'', category:'', location:'', h1b:'LIKELY', itar:'NO', roles:'', atsBoardUrl:'' };
```

- [ ] **Step 4: Update the component state — replace tierFilter with priorityFilter, add expandedHooks**

Find:
```js
  const [tierFilter, setTierFilter] = useState('all');
```
Replace with:
```js
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [expandedHooks, setExpandedHooks] = useState(new Set());
```

Add the toggleHook helper right after the `useEffect` block:
```js
  const toggleHook = (name) => setExpandedHooks(prev => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });
```

- [ ] **Step 5: Update allCos to use APRIL_TARGETS**

Find:
```js
  const allCos = [...M628, ...(customCompanies||[]).filter(c => !M628.find(m => m.name === c.name))];
```
Replace with:
```js
  const allCos = [...APRIL_TARGETS, ...(customCompanies||[]).filter(c => !APRIL_TARGETS.find(m => m.name === c.name))];
```

- [ ] **Step 6: Update the filtered logic — replace tier filter with priority filter**

Find:
```js
    if (tierFilter !== 'all' && c.tier !== parseInt(tierFilter)) return false;
    if (filterVisa && c.h1b !== 'YES') return false;
```
Replace with:
```js
    if (priorityFilter !== 'all' && c.priority !== priorityFilter) return false;
    if (filterVisa && c.h1b !== 'YES') return false;
```

- [ ] **Step 7: Update the header subtitle**

Find:
```js
          <p style={{margin:0,fontSize:14,color:t.sub}}>{allCos.length} companies tracked{(customCompanies||[]).length>0?` (${(customCompanies||[]).length} custom)`:''}</p>
```
Replace with:
```js
          <p style={{margin:0,fontSize:14,color:t.sub}}>25 target companies · April 2026{(customCompanies||[]).length>0?` + ${(customCompanies||[]).length} custom`:''}</p>
```

- [ ] **Step 8: Replace the Tier filter select with Priority filter chips**

Find the entire `<select>` element for tier filter:
```jsx
        <select value={tierFilter} onChange={e => setTierFilter(e.target.value)} style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:9,padding:"9px 14px",color:t.tx,fontSize:13.5,fontFamily:"inherit",outline:"none"}}>
          <option value="all">All Tiers</option>
          {[1,2,3,4,5,6].map(n => <option key={n} value={n}>Tier {n}</option>)}
        </select>
```
Replace with:
```jsx
        {[
          { key: 'all',     label: 'All' },
          { key: 'top',     label: '🔴 Top' },
          { key: 'mid',     label: '🟡 Mid' },
          { key: 'low',     label: '🟢 Low' },
          { key: 'monitor', label: '👁 Monitor' },
          { key: 'hold',    label: '⏸ Hold' },
        ].map(opt => (
          <Chip key={opt.key} active={priorityFilter === opt.key} onClick={() => setPriorityFilter(opt.key)} t={t}>
            {opt.label}
          </Chip>
        ))}
```

- [ ] **Step 9: Replace the card rendering**

Find the entire inner `<Card>` render block (the one that starts with `<Card key={c.name} t={t} style={{padding:"16px 18px"}}>` and ends with `</Card>`), and replace it with:

```jsx
            <Card key={c.name} t={t} style={{padding:"16px 18px"}}>
              {/* Header: priority emoji + name + score badge */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14.5,fontWeight:700,color:t.tx,marginBottom:2,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span>{PRIORITY_EMOJI[c.priority] || ''}</span>
                    <span>{c.name}</span>
                    {c.priorityNote && <span style={{fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:10,background:t.priL,color:t.pri}}>{c.priorityNote}</span>}
                    {isCustom && <span style={{fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:10,background:t.priL,color:t.pri}}>Custom</span>}
                  </div>
                  <div style={{fontSize:12.5,color:t.muted}}>{c.category} · {c.location}</div>
                </div>
                <div style={{fontSize:12,fontWeight:800,padding:"3px 9px",borderRadius:6,flexShrink:0,marginLeft:8,
                  background: c.score>=15 ? t.greenL : c.score>=12 ? t.yellowL : t.redL,
                  color:      c.score>=15 ? t.green  : c.score>=12 ? t.yellow  : t.red}}>
                  {c.score}/18
                </div>
              </div>

              {/* Roles + H1B + ITAR */}
              <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
                {(c.roles||[]).map(r => {
                  const rb = ROLE_BADGE[r] || { bg: t.priL, color: t.pri };
                  return <span key={r} style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:rb.bg,color:rb.color}}>{r}</span>;
                })}
                <span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:5,
                  background: c.h1b==="YES" ? t.greenL : c.h1b==="LIKELY" ? t.yellowL : t.redL,
                  color:      c.h1b==="YES" ? t.green  : c.h1b==="LIKELY" ? t.yellow  : t.red}}>
                  H1B: {c.h1bCount ? c.h1bCount : c.h1b}
                </span>
                {c.itar==="YES"   && <span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:5,background:t.redL,color:t.red}}>ITAR</span>}
                {c.itar==="MIXED" && <span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:5,background:t.yellowL,color:t.yellow}}>ITAR: MIXED</span>}
              </div>

              {/* Hook — collapsed by default */}
              {c.hook && (
                <div style={{marginBottom:6}}>
                  <button onClick={() => toggleHook(c.name)}
                    style={{fontSize:11.5,fontWeight:700,color:t.pri,background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
                    {expandedHooks.has(c.name) ? '▲' : '▼'} Why this company
                  </button>
                  {expandedHooks.has(c.name) && (
                    <div style={{fontSize:12,color:t.sub,lineHeight:1.6,marginTop:4,padding:"8px 10px",background:t.bg,borderRadius:6,border:`1px solid ${t.border}`}}>
                      {c.hook}
                    </div>
                  )}
                </div>
              )}

              {/* Watch note */}
              {c.watch && (
                <div style={{fontSize:11.5,color:t.yellow,marginBottom:6,display:"flex",alignItems:"flex-start",gap:5}}>
                  <span style={{flexShrink:0}}>⚠</span><span>{c.watch}</span>
                </div>
              )}

              {/* Actions */}
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginTop:8}}>
                {c.atsBoardUrl && (
                  <a href={c.atsBoardUrl} target="_blank" rel="noreferrer"
                    style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:12,color:t.pri,textDecoration:"none",fontWeight:600}}>
                    <ExternalLink size={12}/>{c.atsPlatform !== "Unknown" ? `Apply via ${c.atsPlatform}` : "Job Board"}
                  </a>
                )}
                <button onClick={() => { setOutreachCo(c); setOrPersonas(['Recruiter','Hiring Manager']); setOrCount(5); }}
                  style={{display:"inline-flex",alignItems:"center",gap:5,padding:"4px 12px",borderRadius:7,background:t.priL,border:`1px solid ${t.priBd}`,color:t.pri,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  <Rocket size={12}/> Cold Outreach
                </button>
              </div>
            </Card>
```

- [ ] **Step 10: Update the Cold Outreach modal subtitle**

Find:
```jsx
          <div style={{fontSize:13,color:t.sub,marginBottom:20}}>{outreachCo.name} · {outreachCo.industry} · T{outreachCo.tier}</div>
```
Replace with:
```jsx
          <div style={{fontSize:13,color:t.sub,marginBottom:20}}>{outreachCo.category} · {outreachCo.location} · {outreachCo.score}/18</div>
```

- [ ] **Step 11: Update the Add Company form — replace Industry/Tier with Category/Location**

Find the two-column grid inside the Add Company modal that contains Industry and Tier fields:
```jsx
            <div>
              <label style={labelStyle}>Industry</label>
              <input value={addForm.industry} onChange={e => setAddForm(f=>({...f,industry:e.target.value}))} placeholder="e.g. Aerospace" style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>Tier</label>
              <select value={addForm.tier} onChange={e => setAddForm(f=>({...f,tier:e.target.value}))} style={selStyle}>
                {[1,2,3,4,5,6].map(n=><option key={n} value={n}>Tier {n}</option>)}
              </select>
            </div>
```
Replace with:
```jsx
            <div>
              <label style={labelStyle}>Category</label>
              <input value={addForm.category} onChange={e => setAddForm(f=>({...f,category:e.target.value}))} placeholder="e.g. eVTOL, EV, Space" style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>Location</label>
              <input value={addForm.location} onChange={e => setAddForm(f=>({...f,location:e.target.value}))} placeholder="e.g. Austin TX" style={inputStyle}/>
            </div>
```

- [ ] **Step 12: Update handleAddSave to use new fields**

Find:
```js
    const newCo = {
      name: addForm.name.trim(),
      industry: addForm.industry.trim() || 'Unknown',
      tier: parseInt(addForm.tier) || 2,
      h1b: addForm.h1b,
      itar: addForm.itar,
      roles: addForm.roles.trim(),
      atsBoardUrl: addForm.atsBoardUrl.trim(),
      atsPlatform: addForm.atsBoardUrl.trim() ? 'Custom' : 'Unknown',
    };
```
Replace with:
```js
    const newCo = {
      name: addForm.name.trim(),
      category: addForm.category.trim() || 'Unknown',
      location: addForm.location.trim() || '',
      h1b: addForm.h1b,
      h1bCount: null, h1bNewHires: null,
      itar: addForm.itar,
      roles: addForm.roles.trim() ? addForm.roles.split(',').map(r => r.trim()).filter(Boolean) : [],
      priority: 'mid', priorityNote: '',
      score: 0, scores: { d1:0, d2:0, d3:0, d4:0, d5:0, d6:0 },
      hook: '', watch: '', stage: '',
      atsBoardUrl: addForm.atsBoardUrl.trim(),
      atsPlatform: addForm.atsBoardUrl.trim() ? 'Custom' : 'Unknown',
      domain: '',
    };
```

- [ ] **Step 13: Verify the build**

```bash
cd /Users/jashwanth/jobagent-web && npm run build 2>&1 | tail -20
```
Expected: build succeeds with no errors.

- [ ] **Step 14: Smoke test in dev**

```bash
npm run dev &
```
Open browser to localhost, navigate to Company Intel. Verify:
- 25 companies show (not 628)
- Priority chips replace Tier dropdown
- Cards show emoji, score badge, role chips, H1B count
- "Why this company" toggle expands hook text
- Watch notes appear in amber for companies with watch text
- Cold Outreach button still works

- [ ] **Step 15: Commit**

```bash
git add src/components/CompanyIntel.jsx
git commit -m "feat: rebuild Company Intel with 25 April target companies — priority filters, score badges, hook/watch display"
```

---

## Track 3 — Hide Summary in JobAnalysis

### Task 5: Hide Mod 1 Summary card in JobAnalysis.jsx

**Files:**
- Modify: `src/components/JobAnalysis.jsx`

- [ ] **Step 1: Remove the subtitle paragraph**

Find (around line 601):
```jsx
        <p style={{margin:0,fontSize:14,color:t.sub}}>Resume modifications for ATS optimization (2 edits only: Summary + Skills)</p>
```
Replace with nothing — delete this line entirely.

- [ ] **Step 2: Hide the Mod 1 Summary card and make Skills full-width**

Find the 2-column grid that wraps both mod cards:
```jsx
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>

            {/* MOD 1: Summary */}
            <Card t={t} style={{borderColor:t.greenBd}}>
```

Change `gridTemplateColumns:"1fr 1fr"` to `gridTemplateColumns:"1fr"` AND wrap the entire Mod 1 Summary card in a hidden div:

```jsx
          <div style={{display:"grid",gridTemplateColumns:"1fr",gap:16,marginBottom:16}}>

            {/* MOD 1: Summary — hidden (summary section removed from resume) */}
            <div style={{display:"none"}}>
            <Card t={t} style={{borderColor:t.greenBd}}>
```

Then find the closing `</Card>` of the Mod 1 block (right before the `{/* MOD 2: Skills */}` comment) and add the closing `</div>` after it:

```jsx
            </Card>
            </div>

            {/* MOD 2: Skills */}
```

- [ ] **Step 3: Verify the build**

```bash
cd /Users/jashwanth/jobagent-web && npm run build 2>&1 | tail -20
```
Expected: build succeeds with no errors.

- [ ] **Step 4: Smoke test**

Open Job Analysis in the dev server. Verify:
- No subtitle below "Job Analysis" heading
- Only the Skills card is visible, rendered full-width
- Skills card still shows the reordered skill lines and Copy LaTeX button

- [ ] **Step 5: Commit**

```bash
git add src/components/JobAnalysis.jsx
git commit -m "fix: hide Mod 1 Summary card in Job Analysis — summary section removed from April resumes"
```

---

## Final Verification

- [ ] **Run full build one last time**

```bash
cd /Users/jashwanth/jobagent-web && npm run build 2>&1 | tail -20
```
Expected: clean build, no errors, no warnings about unused imports.

- [ ] **Run existing tests**

```bash
npm test 2>&1 | tail -20
```
Expected: all existing tests pass (dashboard-utils, resolver, adapters, supabase tests are unchanged).

- [ ] **Final commit if any cleanup needed**

```bash
git log --oneline -6
```
Should show 5 new commits:
1. `fix: correct 6 resume accuracy overclaims in groq.js AI candidate background`
2. `fix: update TEMPLATE_SKILLS all variants — certifications first, align with April resume structure`
3. `feat: add april_targets.js — 25 curated target companies with full scoring data`
4. `feat: rebuild Company Intel with 25 April target companies — priority filters, score badges, hook/watch display`
5. `fix: hide Mod 1 Summary card in Job Analysis — summary section removed from April resumes`
