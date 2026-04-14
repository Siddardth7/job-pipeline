// ─── Groq AI Helper ───────────────────────────────────────────────────────────
// Routes through /api/groq proxy (Vercel serverless) to avoid CORS issues and
// keep the API key server-side. apiKey param retained for signature compatibility
// but the proxy fetches the key from Supabase — it is not sent over the wire.

import { supabase } from '../supabase.js';

const MODEL = 'llama-3.3-70b-versatile';

export async function callGroq(systemPrompt, userPrompt, apiKey, maxTokens = 1000) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not signed in — please sign in to use AI features.');
  }

  const res = await fetch('/api/groq', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq error: ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ─── Job Analysis ─────────────────────────────────────────────────────────────
// ─── Summary Generation — focused separate call ───────────────────────────────
// Receives pre-extracted keywords + title from the data call so the model
// only has ONE job: write 3 sentences. No JSON, no competing fields.
async function _generateSummary(jd, variant, keywords, title, apiKey) {
  const VARIANT_LENS = {
    A: {
      description: "Manufacturing & Plant Ops",
      angle: "The role needs someone who can make parts, hold tolerances, and keep a production line moving. Anchor sentence 1 to shop-floor fabrication or hardware inspection — the candidate has been on the floor building real aerospace hardware, not studying it."
    },
    B: {
      description: "Process & Continuous Improvement",
      angle: "The role needs someone who can look at a broken process, find the variable that is causing the problem, and move the numbers. Anchor sentence 1 to a specific outcome where the candidate measured a problem and changed the result."
    },
    C: {
      description: "Quality & Materials",
      angle: "The role needs someone who can accept or reject hardware with confidence — inspection, root cause, materials knowledge. Anchor sentence 1 to a disposition or inspection decision the candidate made on real aerospace flight hardware."
    },
    D: {
      description: "Equipment & NPI",
      angle: "The role needs someone who can build a manufacturing process that does not exist yet — develop the steps, qualify the hardware, validate first article. Anchor sentence 1 to a first-time process build the candidate created from scratch."
    }
  };
  const lens = VARIANT_LENS[variant] || VARIANT_LENS.A;

  const system = `You are writing a 3-sentence resume summary. Output ONLY the 3 sentences as plain text — no JSON, no labels, no explanation, no formatting markers.

CANDIDATE BACKGROUND (use only these facts, never invent):
- Degree: MS Aerospace Engineering, UIUC, Dec 2025. Entry level — never claim seniority.
- Tata Boeing Aerospace: Audited GD&T-based CMM inspection records for 450+ flight-critical components to 0.02 mm accuracy, supporting zero customer escapes on GE and Boeing programs; initiated 5 Whys root cause investigation and escalated to 8D structured problem-solving for deeper resolution on GE engine component nonconformances, reducing NCR cycle time by 22%; implemented SPC-guided corrective actions (revised CNC tool change intervals) reducing position tolerance defect rate from 15% to under 3%; built FMEA-based engineering justification for supplier nonconformance enabling use-as-is disposition that prevented ~$3,000 in scrap and 4-week lead time delay
- SAMPE Competition: Built 24-inch composite fuselage via prepreg layup and autoclave cure (275°F, lab-limited 40 psi) — part sustained 2,700 lbf at test (2.7× design requirement); built pFMEA ranking 5 failure modes (vacuum bag leaks highest, RPN=60 using S=5 O=4 D=3) and standardized pressurized hold test protocol at 20 psi achieving zero process deviations; optimized laminate stacking using Python simulated annealing + ABAQUS FEA achieving 38% deflection reduction vs baseline; redesigned layup to dual-blanket structure (7 inner + 7 outer plies) overnight after ply geometry fit failure
- Beckman Institute: Developed and validated out-of-autoclave cure method using frontal polymerization — proof-of-concept compression of composite processing cycle from 8+ hours to under 5 minutes in a research setting; predicted cure behavior within 10% velocity accuracy and 3°C of peak temperatures, accelerating process parameter optimization by 94% through computational modeling
- EQIC Dies & Moulds: Mapped 12-stage die production workflow (CNC machining, EDM, heat treatment, assembly) identifying inter-stage handoff points as primary sources of dimensional tolerance accumulation; verified die component tolerances to ±0.02 mm (GD&T) and confirmed parting surface alignment (>80% contact) on 800-bar HPDC tooling
- FMEA Risk Prioritization Tool (Project): Deployed Python/Streamlit tool implementing AIAG FMEA-4 standards — RPN scoring, Pareto 80/20 risk ranking, criticality flagging, PDF/Excel export; validated with 61 unit tests on aerospace CFRP composite panel dataset
- Virtual Composite Laminate Design & Optimization (Project): Classical Laminate Theory engine with Simulated Annealing stacking sequence optimizer, validated against CalculiX FEA achieving <1% deflection error and <3% stress error on IM7/8552 CFRP plate

RESUME VARIANT: ${variant} — ${lens.description}
VARIANT LENS: ${lens.angle}`;

  const user = `TARGET ROLE: ${title}
JD KEYWORDS TO USE (already extracted — do not re-extract): ${keywords.join(', ')}

JD (first 1200 chars for context):
${jd.slice(0, 1200)}

---

WRITE EXACTLY 3 SENTENCES using the logic below. Plain text only. No bold, no dashes as bullet points, no labels like "Sentence 1:".

SENTENCE 1 — Identity + role fit (25–35 words):
Position the candidate as a fresh Aerospace Engineering graduate targeting this role — do NOT use "MS" as the opener, it sounds like a credential list. Open with who they are in relation to the role.

Good opener patterns (pick the one that fits the JD's environment and role most naturally):
- "Aerospace Engineering graduate with [domain expertise] experience across [programs/environments], targeting [role] in aerospace manufacturing."
- "Aerospace Engineering graduate who [key accomplishment tied to this role's primary need] — directly aligned for [role]."
- "[Manufacturing/Quality/Process]-focused Aerospace Engineering graduate with production floor experience in [relevant domain], targeting [role] in [composites/NPI/CI] environments."
- "Aerospace Engineering graduate with a foundation in [relevant domain 1], [relevant domain 2], and [relevant domain 3] — built for entry-level [role] in manufacturing."

After establishing identity, attach the ONE proof point that most directly answers what this role needs (use the VARIANT LENS above).
The environment and product of the JD matter — composites company gets composites reference, CI-heavy role gets a process result, NPI role gets a first-time build.
The sentence ends when a recruiter reading it would think: this person has done the core of this job before, even as a grad.

SENTENCE 2 — Proof for the keywords (20–30 words):
Use 2–3 of the JD keywords listed above. For each, state where or how it was applied — from the candidate background only.
The sentence must flow as one clause, not a keyword list. Each keyword earns its place by being attached to a place and an outcome.
Do NOT dangle a tool at the end: "...using SPC" is weak. Show SPC mid-sentence with context: "SPC flagged the CNC tool wear that was driving..."

SENTENCE 3 — What the candidate brings as a person (12–18 words):
Read the JD for what this company values non-technically: precision? ownership? problem-solving instinct? rigor?
Write a BEHAVIOR, not an output. These work: "Digs into the process until the variance disappears." / "Shows up to make parts right, not to report that they were wrong." / "Takes the accept/reject call seriously because the hardware is flying."
These do NOT work: anything starting with Delivers / Brings / Offers / Provides / Demonstrates.
These are banned: passionate, motivated, results-driven, dynamic, fast-paced, team player, leveraging, precision solutions.

The 3 sentences must flow together — sentence 2 should feel like evidence for sentence 1's claim, and sentence 3 should feel like the natural conclusion about who this person is.`;

  return callGroq(system, user, apiKey, 300);
}

export async function analyzeJobWithGroq(jd, variant, apiKey) {
  const RESUMES = {
    A: { name: "Manufacturing & Plant Ops" },
    B: { name: "Process & CI" },
    C: { name: "Quality & Materials" },
    D: { name: "Equipment & NPI" }
  };

  // Base skilllines per variant — Groq modifies these, never generates from scratch
  const BASE_SKILLLINES = {
    A: [
      { label: "Manufacturing & Tooling:", skills: "Fixture Design, Assembly Sequencing, Tooling Qualification, CNC Machining, GD&T, CMM Inspection, Blueprint Reading, SolidWorks" },
      { label: "Process & Quality Control:", skills: "pFMEA, SPC, 8D Root Cause Analysis, RCCA, First Article Inspection, MRB Disposition, CAPA, Lean Principles" },
      { label: "Composite Processing:", skills: "Prepreg Layup, Autoclave Processing, Vacuum Bagging, Cure Cycle Development, Out-of-Autoclave Methods" },
      { label: "Simulation & Software:", skills: "ABAQUS, FEA, Classical Lamination Theory, MATLAB, Python, AutoCAD" }
    ],
    B: [
      { label: "Continuous Improvement:", skills: "pFMEA, SPC, 8D Root Cause Analysis, RCCA, CAPA, Lean Principles, Defect Reduction, Process Repeatability" },
      { label: "Process Engineering:", skills: "Cure Cycle Development, Workflow Redesign, First Article Inspection, MRB Disposition, GD&T, CMM Inspection, Assembly Optimization" },
      { label: "Composite Processing:", skills: "Prepreg Layup, Autoclave Processing, Vacuum Bagging, Out-of-Autoclave Methods" },
      { label: "Simulation & Software:", skills: "ABAQUS, FEA, Classical Lamination Theory, SolidWorks, MATLAB, Python, AutoCAD" }
    ],
    C: [
      { label: "Quality Engineering:", skills: "pFMEA, SPC, 8D/A3 Root Cause Analysis, RCCA, CMM Inspection, GD&T, First Article Inspection, MRB Disposition, CAPA" },
      { label: "Materials & Process Engineering:", skills: "Prepreg Layup, Autoclave Processing, Cure Cycle Development, Out-of-Autoclave Methods, SEM/EDS Analysis, Vickers Hardness (ASTM E384)" },
      { label: "Simulation & Tools:", skills: "ABAQUS, FEA, Classical Lamination Theory, MATLAB, Python, SolidWorks, AutoCAD" },
      { label: "Certifications:", skills: "Six Sigma Green Belt (CSSC) | Inspection & Quality Control in Manufacturing" }
    ],
    D: [
      { label: "Equipment & Tooling:", skills: "Tooling Qualification, Autoclave & Cure Equipment, CNC Machining, EDM, HPDC Tooling, GD&T, CMM Inspection, SolidWorks, AutoCAD" },
      { label: "NPI & Validation:", skills: "pFMEA, First Article Inspection, Process Validation, SPC, RCCA, Build Sequencing, Cure Cycle Development" },
      { label: "Simulation & Analysis:", skills: "ABAQUS, FEA, Classical Lamination Theory, MATLAB, Python" },
      { label: "Composite Processing:", skills: "Prepreg Layup, Vacuum Bagging, Out-of-Autoclave Methods" }
    ]
  };

  const baseLines = BASE_SKILLLINES[variant] || BASE_SKILLLINES.A;
  const baseLinesJson = JSON.stringify(baseLines, null, 2);

  const system = `You are a resume data extractor for Siddardth Pathipaka (MS Aerospace Engineering, UIUC Dec 2025).
Resume variant: ${variant} — ${RESUMES[variant]?.name}

OUTPUT RULES:
1. Return valid JSON only — no markdown fences, no extra text before or after
2. top5_jd_skills: all 5 must be DIFFERENT from each other — no duplicates
3. Skill lines are reordered only — never add new skills not in the base list

KEYWORD QUALITY — extract SPECIFIC technical terms only:
  GOOD: "SPC", "FMEA", "autoclave processing", "GD&T", "CMM inspection", "lean manufacturing",
        "defect reduction", "AS9100", "NADCAP", "NDT", "CAPA", "PFMEA", "APQP", "DMAIC", "8D root cause"
  BAD — never extract: "problem solving", "communication", "computer skills", "teamwork",
        "attention to detail", "years of experience", "fast learner", "process improvements"`;

  const user = `JD:
${jd.slice(0, 3500)}

BASE SKILLLINES FOR RESUME ${variant}:
${baseLinesJson}

Return ONLY this JSON:
{
  "top5_jd_skills": ["kw1", "kw2", "kw3", "kw4", "kw5"],
  "summary_title": "exact job title from JD",
  "summary_structure_used": ${variant === 'A' ? 1 : variant === 'B' ? 2 : variant === 'C' ? 5 : 4},
  "mod2_skilllines": [
    {"label": "same label as base line 1", "skills": "reordered skills, add (Learning) tag if skill is weak"},
    {"label": "same label as base line 2", "skills": "reordered skills"},
    {"label": "same label as base line 3", "skills": "reordered skills"},
    {"label": "same label as base line 4", "skills": "reordered skills"}
  ],
  "missing_keywords": ["kw1", "kw2", "kw3", "kw4", "kw5"],
  "ats_coverage": "XX%",
  "composites_visible": true,
  "quantification_check": "Metrics present or Add metrics",
  "resumeReason": "One sentence why Resume ${variant} is best for this role",
  "top_matches": ["kw1", "kw2", "kw3"],
  "ai_insights": "3 to 5 specific actionable recommendations: what to emphasize in interview, red flags, sponsorship notes, or strategic tips for this specific JD"
}`;

  // Call 1: extract structured data (keywords, title, skilllines, ATS metrics)
  const dataText = await callGroq(system, user, apiKey, 1400);

  let parsed;
  try {
    const cleaned = dataText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    const match = dataText.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); }
      catch { throw new Error('Could not parse Groq response. Try again.'); }
    } else {
      throw new Error('Could not parse Groq response. Try again.');
    }
  }

  // Call 2: generate summary in isolation — model's only job is 3 sentences
  const summaryText = await _generateSummary(
    jd,
    variant,
    parsed.top5_jd_skills || [],
    parsed.summary_title || '',
    apiKey
  );

  // Clean and attach summary to parsed result
  parsed.mod1_summary = summaryText.trim();

  return applyQCBarriers(parsed, variant);
}

// ── QC BARRIER — applied to every parsed Groq result ────────────────────────
// Bold is applied HERE deterministically — never trusted from Groq output.
// Groq writes plain text. We bold the title + all 5 keywords reliably.
function applyQCBarriers(parsed, variant) {
  if (parsed.mod2_skilllines && Array.isArray(parsed.mod2_skilllines)) {
    parsed.mod2_skills = parsed.mod2_skilllines
      .map(row => {
        const label = row.label.replace(/&/g, '\\&');
        const skills = row.skills.replace(/&/g, '\\&');
        return `\\skillline{${label}}{${skills}}`;
      })
      .join('\n');
  }

  if (parsed.mod1_summary) {
    let s = parsed.mod1_summary;

    // 1. Nuclear strip — Groq may output \textbf{} with unescaped backslash in JSON,
    //    which JSON.parse turns into [TAB]extbf{} (\t = tab). Handle both variants.
    s = s.replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1');   // proper \cmd{content} → content
    s = s.replace(/\t[a-zA-Z]+\{([^}]*)\}/g, '$1');   // tab-corrupted [TAB]cmd{content} → content
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1');            // **bold** → plain
    s = s.replace(/\*\*/g, '');                         // orphaned **
    s = s.replace(/[{}\\]/g, '');                       // remaining LaTeX chars
    s = s.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim(); // normalize whitespace

    // 2. Enforce max 3 sentences
    const sentences = s.match(/[^.!?]+[.!?]+/g) || [s];
    if (sentences.length > 3) s = sentences.slice(0, 3).join(' ');

    // 3. Hard word cap: 95 words
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length > 95) {
      s = words.slice(0, 95).join(' ').replace(/[,\s]+$/, '') + '.';
    }

    // 4. Clean up spacing
    s = s.replace(/ {2,}/g, ' ').replace(/ ,/g, ',').trim();

    // 5. Deterministic bold — sort by length descending to avoid partial overlaps
    const GENERIC_TITLES = new Set(['intern', 'engineer', 'technician', 'specialist', 'analyst', 'associate', 'coordinator']);
    const VARIANT_TITLES = { A: 'Manufacturing Engineer', B: 'Process Engineer', C: 'Quality Engineer', D: 'Equipment Engineer' };
    const rawTitle = (parsed.summary_title || '').trim();
    let title = rawTitle;
    if (!title || GENERIC_TITLES.has(title.toLowerCase()) || title.split(/\s+/).length < 2) {
      title = VARIANT_TITLES[variant] || 'Manufacturing Engineer';
      parsed.summary_title = title;
      // Replace old generic title at start of summary with corrected title
      if (rawTitle) {
        const escOld = rawTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        s = s.replace(new RegExp(`^${escOld}\\b`, 'i'), title);
      }
    }
    const keywords = [...(parsed.top5_jd_skills || [])].sort((a, b) => b.length - a.length);

    // Bold the title (first occurrence only)
    if (title) {
      const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      s = s.replace(new RegExp(esc, 'i'), `**${title}**`);
    }

    // Bold each keyword (first occurrence, skip if already inside **)
    for (const kw of keywords) {
      if (!kw) continue;
      const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Only match if not already wrapped in **
      s = s.replace(new RegExp(`(?<!\\*)\\b${esc}\\b(?!\\*)`, 'i'), `**${kw}**`);
    }

    // 6. Final safety check — if any LaTeX chars survived, strip them
    if (/[{}\\]/.test(s)) {
      s = s.replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
    }

    // 7. Build LaTeX version: **text** -> \textbf{text}, then escape LaTeX special chars
    parsed.mod1_summary_latex = s
      .replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}')
      .replace(/%/g, '\\%')
      .replace(/&/g, '\\&')
      .replace(/\$/g, '\\$')
      .replace(/#/g, '\\#');
    parsed.mod1_summary = s;
  }

  return parsed;
}

// ─── Message Drafting ─────────────────────────────────────────────────────────
// persona: 'Recruiter' | 'Hiring Manager' | 'Peer Engineer' | 'Executive' | 'UIUC Alumni' | 'Senior Engineer'
// intent:  'job_application_ask' | 'cold_outreach'
// format:  'connection_note' | 'followup' | 'cold_email'
export async function draftMessageWithGroq(persona, intent, format, contact, job, apiKey, regenNote = '') {
  const role     = job?.role || 'engineering position';
  const company  = contact.company || job?.company || '';
  const jobId    = job?.id || job?.jobId || job?.job_id || '';
  const location = job?.location || job?.city || '';

  // Job reference line — always include role + company; add ID and location when available
  const jobRef = [
    `the ${role} role at ${company}`,
    jobId    ? `(Job ID: ${jobId})`    : '',
    location ? `based in ${location}`  : '',
  ].filter(Boolean).join(' ');

  const intentSummary = intent === 'job_application_ask'
    ? `applied for the ${role} role at ${company} and found this contact while searching for people at the company`
    : `interested in ${company}'s work in aerospace and advanced manufacturing`;

  const personaAsk = {
    'Recruiter':        'confirm my application is under active review, or point me to the right hiring contact',
    'Hiring Manager':   'have a 15-minute call to learn what you are looking for in this role',
    'Peer Engineer':    'share your honest take on the team experience and day-to-day work',
    'Executive':        'have a brief call to discuss whether my background maps to what the team needs',
    'UIUC Alumni':      'share your advice on the culture and how engineering decisions get made at the company',
    'Senior Engineer':  'share your perspective on how composites manufacturing experience fits the team',
  }[persona] || 'have a brief conversation';

  // Persona-specific angle for the connection note's one clause
  const connectionNoteAngle = {
    'Recruiter': intent === 'job_application_ask'
      ? `I applied for ${jobRef} and am looking for the right person to connect with so my application gets the right visibility. I want to make sure it reaches the right hiring contact or team.`
      : `I am exploring composites and aerospace manufacturing roles at ${company} and wanted to connect with the right person on the recruiting side.`,

    'Hiring Manager': intent === 'job_application_ask'
      ? `I applied for ${jobRef} and wanted to introduce myself directly to the team. I am looking for the right direction to put my application in front of the people making the hiring decision.`
      : `I have been following ${company}'s work in aerospace manufacturing and wanted to connect with the engineering leadership directly.`,

    'Peer Engineer': intent === 'job_application_ask'
      ? `I applied for ${jobRef} and would love to hear what the engineering work looks like day to day from someone on the team.`
      : `I am a composites and manufacturing engineer exploring opportunities at ${company} and wanted to connect with someone doing the hands-on engineering work.`,

    'Executive': intent === 'job_application_ask'
      ? `I applied for ${jobRef} and wanted to introduce my background directly to someone in the leadership team who can point me in the right direction.`
      : `I have been following ${company}'s direction in aerospace and advanced manufacturing and wanted to introduce myself to the leadership.`,

    'UIUC Alumni':
      `Fellow Illini, I saw you are at ${company}${intent === 'job_application_ask' ? ` and I applied for ${jobRef}` : ''}. As a current M.S. Aerospace student at UIUC I would love to hear your perspective on the team and work there.`,

    'Senior Engineer': intent === 'job_application_ask'
      ? `I applied for ${jobRef} and wanted to connect with a senior engineer on the team who can give me a real sense of what the work involves and whether my composites background is a strong fit.`
      : `I am a composites and manufacturing engineer with autoclave processing and quality systems experience and wanted to connect with someone doing similar work at ${company}.`,
  }[persona] || `I am interested in ${company}'s work and wanted to connect.`;

  const formatRules = {
    connection_note:
`TASK: Write a LinkedIn Connection Note.
HARD LIMIT: 300 characters total. Count every character including spaces. Trim if over.
STRUCTURE (exactly this):
  Hi [FirstName], I am Siddardth, M.S. Aerospace from UIUC. [One clause drawn from THE ANGLE below]. Would love to connect.

THE ANGLE — use this as the basis for the one clause (adapt wording to fit 300 chars, do not copy verbatim):
${connectionNoteAngle}

REFERENCE REQUIREMENT:
- The note MUST mention at least one of: the role title, the company name, or the job location. The reader must immediately know what specific opportunity this is about.
${jobId ? `- Job ID to reference if space allows: ${jobId}` : ''}

CONNECTION NOTE RULES — ABSOLUTE, NO EXCEPTIONS:
- CONTEXT ONLY. The only job of this note is to tell the reader WHY you are connecting and WHAT role you are talking about. Nothing else.
- The "one clause" must reflect THE ANGLE above — different personas get meaningfully different reasons for connecting.
- ZERO metrics. ZERO numbers. ZERO stats. Not "15% to 3%". Not "2,700 lbf". Not "defect rates". Not "autoclave at 275F". Not "8 hours to 5 minutes". Not any achievement number whatsoever.
- ZERO achievement statements. "At Tata Boeing I reduced..." is FORBIDDEN here. So is any variant of it.
- The reader decides whether to accept based on your context and intent, not your resume. Save the resume for the follow-up.
- No subject line. No sign-off. No dashes. No em-dashes. No exclamation marks. No bullets.`,

    followup:
`TASK: Write a LinkedIn Follow-up Message (sent after the connection is accepted).
HARD LIMIT: 100 words.
STRUCTURE (4 sentences, natural paragraph):
  S1: Thank you for connecting.
  S2: Why you reached out: Siddardth ${intentSummary}.
  S3: One relevant stat — choose the best fit: Tata Boeing defect rate 15% to 3% using SPC and 8D, OR SAMPE 24-inch composite fuselage sustained 2,700 lbf at test (2.7x design requirement) via autoclave at 275F and 40 psi, OR Beckman Institute cure cycle from 8 hours to 5 minutes.
  S4: One specific ask: ${personaAsk}.
Sign off: Siddardth
No bullets. No dashes. No jargon.`,

    cold_email:
`TASK: Write a Cold Email.
OUTPUT FORMAT — first line is the subject line, then one blank line, then the body:
Subject: [60 chars max — include role or company name, UIUC, and hint of STEM OPT availability]

BODY — 4 paragraphs, under 150 words total:
P1: Siddardth Pathipaka. M.S. Aerospace Engineering, UIUC, December 2025. ${intent === 'job_application_ask' ? `Applied for the ${role} position at ${company}.` : `Writing to introduce myself and explore opportunities at ${company}.`}
P2: Reference their specific work area. Connect to Tata Boeing composites (defect rate 15% to 3%), SAMPE (24-inch fuselage sustained 2,700 lbf at test via autoclave at 275F and 40 psi), or ABAQUS/ANSYS structural analysis. Be specific. 2 to 3 sentences.
P3: Write this exact sentence verbatim: "I am authorized to work in the US for 3 years under STEM OPT with no sponsorship cost to the employer."
P4: One clear ask: ${personaAsk}.
Closing: Thank you for your time.
Signature: Siddardth Pathipaka, siddardth.pathipaka@gmail.com
No bullets. No dashes. No jargon.`,
  }[format] || '';

  const system = `You are writing outreach messages for Siddardth Pathipaka, an aerospace engineering job applicant. Follow every rule exactly or the output will be rejected.

CANDIDATE:
- Full name: Siddardth Pathipaka
- Degree: M.S. Aerospace Engineering, University of Illinois Urbana-Champaign (UIUC), December 2025
- Work authorization: STEM OPT, 3 years, zero sponsorship cost to employer
- Tata Boeing Aerospace: reduced defect rates from 15% to 3% using SPC and 8D methodology
- SAMPE: built 24-inch composite fuselage via prepreg layup and autoclave cure (275F, 40 psi) — part sustained 2,700 lbf at test (2.7x design requirement)
- Beckman Institute: reduced cure cycle from 8 hours to 5 minutes using novel resin system
- Tools: ABAQUS, ANSYS, SolidWorks, CATIA, MATLAB, Python
- Skills: composites manufacturing, quality engineering, GD&T, CMM, Lean, SPC, FMEA, NDT

ABSOLUTE RULES — apply to all message types:
1. No dashes or em-dashes anywhere. Use commas, periods, or the word "and".
2. No bullet points in the message body. Natural sentences and paragraphs only.
3. No jargon: no "synergy", "leverage", "circle back", "passionate about", "pick your brain", "touch base", "excited to", "thrilled to".
4. Active voice. Short sentences, 12 to 18 words average.
5. Maximum one exclamation mark per entire message.
6. Never fabricate facts about the company or the contact.
7. Never invent skills or experiences Siddardth does not have.
8. CONNECTION NOTES: absolute zero metrics, zero stats, zero numbers from achievements. Context and intent only.
9. STEM OPT sentence appears in cold emails only. Never in LinkedIn messages.
10. LinkedIn sign-off: "Siddardth". Email sign-off: full name and email address.`;

  const user = `CONTACT:
- Name: ${contact.name}
- Persona: ${persona}
- Job title: ${contact.title || persona}
- Company: ${company}
- Context about them: ${contact.why || `works at ${company}`}
- UIUC alumni: ${contact.uiuc ? 'Yes' : 'No'}

JOB / COMPANY:
- Role: ${role}
- Company: ${company}

OUTREACH INTENT: ${intent === 'job_application_ask' ? 'Job Application Ask — applied for this role, reaching out to find right contact or get insights' : 'Cold Outreach — no specific open role, reaching out to explore opportunities and learn about the company'}

${formatRules}

Return ONLY the final message text. No explanation. No label like "Here is the message:" before it.${regenNote ? `\n\nREGENERATION DIRECTION (apply to this revision): ${regenNote}` : ''}`;

  return callGroq(system, user, apiKey, 600);
}

// ─── Cover Letter Generation ───────────────────────────────────────────────────
// tone: 'professional' | 'technical' | 'conversational'
// regenNote: optional user direction for re-generation
export async function generateCoverLetterWithGroq(role, company, jd, analysis, tone, apiKey, regenNote = '') {
  const top5 = (analysis?.top5_jd_skills || []).slice(0, 5);

  const toneInstr = {
    professional:    'Formal and precise. Every sentence carries a specific fact, metric, or named skill. No warmth filler.',
    technical:       'Highly technical. Lead with engineering specifics, tools, and domain terminology before anything else.',
    conversational:  'Direct and approachable — factual but slightly warmer tone. Still zero buzzwords.',
  }[tone] || 'Formal and precise.';

  const system = `You are writing a cover letter for Siddardth Pathipaka, an aerospace engineering job applicant. Follow every rule exactly or the output will be rejected.

CANDIDATE:
- Full name: Siddardth Pathipaka
- Email: siddardth.pathipaka@gmail.com
- Degree: M.S. Aerospace Engineering, University of Illinois Urbana-Champaign (UIUC), December 2025
- Work authorization: STEM OPT, 3 years, zero sponsorship cost to employer
- Tata Boeing Aerospace: reduced composite defect rates from 15% to 3% using SPC and 8D root-cause methodology
- SAMPE student chapter: led fabrication of a 24-inch composite fuselage section; achieved 2% void content via autoclave cure at 275°F and 40 psi
- Beckman Institute: reduced resin cure cycle from 8 hours to 5 minutes using novel resin formulation
- Tools: ABAQUS, ANSYS Mechanical, SolidWorks, CATIA V5, MATLAB, Python
- Skills: composites manufacturing, quality engineering, GD&T, CMM inspection, Lean, SPC, FMEA, PFMEA, NDT, structural analysis

ABSOLUTE RULES:
1. Target: 320 to 360 words total in the body. Do not exceed 360. Count carefully.
2. Zero filler phrases: no "I am passionate about", "excited to join", "thrilled", "synergy", "leverage", "align with your values", "dynamic team", "fast-paced environment".
3. Every sentence must contain at least one specific fact, named skill, metric, tool, or JD-sourced requirement.
4. Reference at least 3 of the provided top JD requirements by their exact name.
5. Include at least 2 quantified achievements (use the Tata Boeing and SAMPE data above).
6. STEM OPT sentence: include this exact sentence once near the end of the final paragraph: "I am authorized to work in the US for 3 years under STEM OPT with no sponsorship cost to the employer."
7. No bullet points anywhere. Paragraphs only.
8. No dashes or em-dashes. Use commas, periods, or the word "and".
9. Do NOT include: date, address block, company address, or "Dear Hiring Manager" salutation. Start immediately with Paragraph 1.
10. End with exactly two lines: "Sincerely," then a blank line then "Siddardth Pathipaka".
11. Tone instruction: ${toneInstr}
12. Do not fabricate company details. Only use the company name and role title as provided.`;

  const user = `ROLE: ${role}
COMPANY: ${company}

TOP JD REQUIREMENTS (reference at least 3 by name):
${top5.length > 0 ? top5.map((k, i) => `${i + 1}. ${k}`).join('\n') : '(no analysis yet — infer from JD below)'}

JOB DESCRIPTION (first 1400 characters):
${jd.slice(0, 1400)}
${analysis?.ai_insights ? `\nAI INSIGHTS FROM JD ANALYSIS:\n${analysis.ai_insights}\n` : ''}
STRUCTURE TO FOLLOW:

Paragraph 1 (2-3 sentences): State the role and company. Degree from UIUC, December 2025. Open with the strongest skill match to the top JD requirements.

Paragraph 2 (3-4 sentences): Tata Boeing defect rate achievement (15% to 3%, SPC, 8D). Tie directly to 2 named JD requirements from the list. Be specific with the numbers.

Paragraph 3 (2-3 sentences): SAMPE fuselage achievement (24-inch, 2% void, autoclave) or Beckman cure cycle reduction. Reference 1 more named JD requirement. Name at least one tool (ABAQUS, ANSYS, SolidWorks, etc.).

Paragraph 4 (2-3 sentences): STEM OPT sentence verbatim. Request a conversation to discuss the role. Thank them for their time.

End: Sincerely,\n\nSiddardth Pathipaka

Return ONLY the cover letter body starting from Paragraph 1. No preamble, no "Here is the cover letter:" label.${regenNote ? `\n\nREGENERATION DIRECTION (apply to this revision): ${regenNote}` : ''}`;

  return callGroq(system, user, apiKey, 900);
}

// ─── Application Q&A ──────────────────────────────────────────────────────────
// Answers open-ended application form questions with full job context.
// question: the form question the user is filling in (e.g. "Message to the hiring team")
// ctx: { company, role, jd, summary, top5Skills }
export async function answerApplicationQuestion(question, { company, role, jd, summary, top5Skills }, apiKey) {
  const skillsList = (top5Skills || []).join(', ');

  const system = `You are writing application form answers for Siddardth Pathipaka, an aerospace engineering candidate. Answer naturally in first person, as Siddardth.

CANDIDATE FACTS (use these — do not invent):
- MS Aerospace Engineering, UIUC, December 2025
- STEM OPT eligible — 3 years, zero sponsorship cost to employer
- Tata Boeing: cut defect rate from 15% to 3% using SPC and 8D methodology
- SAMPE: fabricated 24-inch composite fuselage, 2% void content, autoclave at 275°F and 40 psi
- Beckman Institute: reduced cure cycle from 8 hours to 5 minutes
- Tools: SolidWorks, CATIA, ABAQUS, ANSYS, MATLAB, Python, GD&T, CMM, PFMEA, DOE, Lean/Six Sigma

ROLE CONTEXT:
- Company: ${company || 'the company'}
- Role: ${role || 'the position'}
- Key JD requirements targeted: ${skillsList || 'aerospace manufacturing, quality, composites'}
- Resume summary tailored for this role: ${summary || ''}

RULES:
- Answer ONLY the question asked. Do not pad, do not add disclaimers.
- Use at least one specific metric or achievement from the candidate facts above
- Tie the answer directly to the role and company when possible
- NO filler: no "passionate", "excited to", "dynamic", "hands-on individual"
- Tone: direct, confident, specific
- Length: match the question type — short form questions get 2-3 sentences, longer prompts get a short paragraph
- Return ONLY the answer text. No "Here is my answer:" preamble.`;

  const user = `JD SNIPPET (for context, first 2000 chars):
${(jd || '').slice(0, 2000)}

QUESTION TO ANSWER:
${question}`;

  return callGroq(system, user, apiKey, 400);
}

// ─── Resume Analysis ──────────────────────────────────────────────────────────
// Returns a structured JSON report. Throws if Groq fails or returns malformed JSON.
export async function analyzeResumeWithGroq(structuredSections, targetRoles, apiKey) {
  const SYSTEM = `You are a strict, honest resume evaluator for early-career engineering candidates
(Aerospace, Manufacturing, Industrial, Mechanical). You evaluate resumes for:
1. Impact: Are bullets quantified? Vague bullets fail.
2. Skills relevance: Do skills match modern engineering job descriptions?
3. Formatting clarity: Are sections structured, scannable, consistent?
4. Experience framing: Is work experience framed around outcomes, not tasks?
5. Overall readiness for ATS and recruiter review.

You MUST respond with ONLY valid JSON matching this exact shape:
{
  "score": "A" | "B" | "C" | "D",
  "summary": "2-3 sentence overall evaluation",
  "highlights": [
    { "section": "Experience | Skills | Education | Summary", "note": "what is working well" }
  ],
  "issues": [
    {
      "severity": "urgent" | "critical" | "optional",
      "problem": "specific problem statement",
      "why": "why this hurts your application",
      "suggestion": "exact improvement to make"
    }
  ]
}
Score guide: A = ready to send, B = minor fixes, C = significant work needed, D = major gaps.
Produce at minimum 3 issues and 2 highlights. Be specific — never generic.
Do NOT wrap in markdown code fences. Return raw JSON only.`;

  const sections = structuredSections || {};
  const experience = (sections.experience || [])
    .map(e => `${e.role} at ${e.company} (${e.start_date}–${e.current ? 'Present' : e.end_date})\n${(e.bullets || []).map(b => `  • ${b}`).join('\n')}`)
    .join('\n\n');
  const skills = (sections.skills || [])
    .map(s => `${s.category}: ${(s.items || []).join(', ')}`)
    .join('\n');
  const education = (sections.education || [])
    .map(e => `${e.degree} in ${e.field}, ${e.school} (${e.end_date})${e.gpa ? `, GPA ${e.gpa}` : ''}`)
    .join('\n');

  const USER = `Target roles: ${(targetRoles || []).join(', ') || 'Engineering (general)'}

RESUME:
---
SUMMARY
${sections.summary || '(none)'}

EXPERIENCE
${experience || '(none)'}

EDUCATION
${education || '(none)'}

SKILLS
${skills || '(none)'}
---

Evaluate this resume.`;

  const raw = await callGroq(SYSTEM, USER, apiKey, 1200);

  // Strip any accidental markdown fences
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('Resume analysis returned invalid JSON from Groq. Try again.');
  }
}
