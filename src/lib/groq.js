// ─── Groq AI Helper ───────────────────────────────────────────────────────────
// Uses Groq's free API (llama-3.3-70b) for tailored analysis and drafting

// Route through /api/groq (Vercel serverless proxy) to avoid CORS —
// browser → same-origin proxy → api.groq.com (server-side, no CORS).
const GROQ_PROXY_URL = '/api/groq';
const MODEL = 'llama-3.3-70b-versatile';

export async function callGroq(systemPrompt, userPrompt, apiKey, maxTokens = 1000) {
  if (!apiKey) throw new Error('No Groq API key configured. Add it in Settings → Groq AI.');

  const res = await fetch(GROQ_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
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
      { label: "Manufacturing & Quality:", skills: "GD&T, CMM Inspection, First Article Inspection, PPAP, AS9100, SPC, Dimensional Inspection" },
      { label: "Process & Tooling:", skills: "Fixtures & Jigs, Metrology, Tolerance Analysis, NADCAP, Production Planning, Shop Floor" },
      { label: "Engineering Tools:", skills: "SolidWorks, CATIA, MATLAB, Python" },
      { label: "Manufacturing Processes:", skills: "Machining, Assembly, Stamping, Casting, Forging, Welding, CNC" },
      { label: "Project Management:", skills: "Cross-Functional Collaboration, Continuous Improvement, Lean Methodologies" }
    ],
    B: [
      { label: "Quality & CI Systems:", skills: "FMEA, SPC, 8D Root Cause Analysis, DMAIC, CAPA, Kaizen, Lean, Six Sigma" },
      { label: "Process Tools:", skills: "Value Stream Mapping, Poka-Yoke, 5S, OEE, Defect Reduction, Process Optimization, Corrective Action" },
      { label: "Engineering Tools:", skills: "SolidWorks, MATLAB, Python, Minitab" },
      { label: "Documentation:", skills: "Technical Writing, SOPs, Control Plans, Work Instructions, Change Control" },
      { label: "Project Management:", skills: "Cross-Functional Collaboration, Continuous Improvement, Lean Methodologies" }
    ],
    C: [
      { label: "Quality Systems:", skills: "CAPA, FMEA, 8D Root Cause Analysis, SPC, MRB, GD&T, CMM Inspection" },
      { label: "Regulatory & Documentation:", skills: "Technical Writing, SOPs, Change Control, Quality Records, ISO Standards, AS9100" },
      { label: "Manufacturing & Materials:", skills: "Prepreg Layup, Autoclave Processing, Vacuum Bagging, Composite Materials, NDT" },
      { label: "Engineering Tools:", skills: "ABAQUS, ANSYS, FEA, SolidWorks, CATIA, MATLAB, Python" },
      { label: "Project Management:", skills: "Cross-Functional Collaboration, Continuous Improvement, Lean Methodologies" }
    ],
    D: [
      { label: "NPI & Tooling:", skills: "PFMEA, DOE, APQP, Tooling Design, Fixture Design, Process Validation, IQ/OQ/PQ" },
      { label: "Product Development:", skills: "New Product Introduction, Design Review, Prototype, Manufacturing Readiness, Commissioning" },
      { label: "Engineering Tools:", skills: "SolidWorks, CATIA, FEA, MATLAB, Python" },
      { label: "Manufacturing:", skills: "Capital Equipment, Production Launch, Process Development, Validation, R&D" },
      { label: "Project Management:", skills: "Cross-Functional Collaboration, Continuous Improvement, Lean Methodologies" }
    ]
  };

  const baseLines = BASE_SKILLLINES[variant] || BASE_SKILLLINES.A;
  const baseLinesJson = JSON.stringify(baseLines, null, 2);

  // Variant → structure skeleton. Picked deterministically — no model choice.
  const STRUCTURE_SKELETONS = {
    A: { // Manufacturing & Plant Ops
      s1: '[JOB_TITLE] with hands-on [KW1] and [KW2] experience at [COMPANY].',
      s2: 'Delivered [KW3] and [KW4] results using [TOOL_A] and [TOOL_B].',
      s3: '[SOFT_CLOSE_WITH_KW5].'
    },
    B: { // Process & CI
      s1: '[JOB_TITLE] specializing in [KW1] and [KW2], with direct exposure at [COMPANY].',
      s2: 'Built a track record of [KW3] and [KW4] improvements using [TOOL_A] and [TOOL_B].',
      s3: '[SOFT_CLOSE_WITH_KW5].'
    },
    C: { // Quality & Materials
      s1: '[JOB_TITLE] built on [KW1] and [KW2] work at [COMPANY].',
      s2: 'Validated [KW3] and [KW4] programs using [TOOL_A] and [TOOL_B].',
      s3: '[SOFT_CLOSE_WITH_KW5].'
    },
    D: { // Equipment & NPI
      s1: '[JOB_TITLE] combining [KW1] depth with [KW2] execution at [COMPANY].',
      s2: 'Delivers [KW3] and [KW4] milestones using [TOOL_A] and [TOOL_B].',
      s3: '[SOFT_CLOSE_WITH_KW5].'
    }
  };
  const skeleton = STRUCTURE_SKELETONS[variant] || STRUCTURE_SKELETONS.A;

  const system = `You are a resume optimizer for Siddardth Pathipaka (MS Aerospace Engineering, UIUC Dec 2025).

CANDIDATE FACTS — use only these, never invent:
- Tata Boeing: reduced defect rates 15% to 3% using SPC and 8D methodology
- SAMPE: fabricated 24-inch composite fuselage, 2% void content, autoclave at 275F and 40 psi
- Beckman Institute: reduced cure cycle from 8 hours to 5 minutes
- Candidate tools: SPC, 8D methodology, FMEA, GD&T, CMM inspection, ABAQUS, SolidWorks, PFMEA, DOE, autoclave processing
- Resume variant: ${variant} — ${RESUMES[variant]?.name}

OUTPUT RULES:
1. Return valid JSON only — no markdown fences, no extra text before or after
2. mod1_summary: PLAIN TEXT ONLY — zero bold markers, zero LaTeX, zero backslashes, zero curly braces
3. top5_jd_skills: all 5 must be DIFFERENT from each other — no duplicates
4. Skills and experience bullet points are LOCKED — do not modify them

KEYWORD QUALITY — extract SPECIFIC technical terms only:
  GOOD: "SPC", "FMEA", "autoclave processing", "GD&T", "CMM inspection", "lean manufacturing",
        "defect reduction", "AS9100", "NADCAP", "NDT", "CAPA", "PFMEA", "APQP", "DMAIC", "8D root cause"
  BAD — never extract: "problem solving", "communication", "computer skills", "teamwork",
        "attention to detail", "years of experience", "fast learner", "process improvements"`;

  const user = `JD:
${jd.slice(0, 3500)}

BASE SKILLLINES FOR RESUME ${variant}:
${baseLinesJson}

STEP 1 — Extract top5_jd_skills: 5 specific technical keywords from the JD, all different.
STEP 2 — Extract summary_title: exact job title from the JD.
STEP 3 — Fill this summary skeleton (replace each [SLOT] with the specified value):

${skeleton.s1}
${skeleton.s2}
${skeleton.s3}

SLOT RULES:
- [JOB_TITLE] = summary_title (verbatim)
- [KW1] = top5_jd_skills[0] verbatim
- [KW2] = top5_jd_skills[1] verbatim
- [KW3] = top5_jd_skills[2] verbatim
- [KW4] = top5_jd_skills[3] verbatim
- [KW5] = top5_jd_skills[4] verbatim — appears ONLY in sentence 3
- [COMPANY] = "Tata Boeing" or "SAMPE" or "Beckman Institute" — pick the most relevant
- [TOOL_A], [TOOL_B] = pick 2 from candidate tools list: SPC, 8D methodology, FMEA, GD&T, CMM inspection, ABAQUS, SolidWorks
- [SOFT_CLOSE_WITH_KW5] = one 10-15 word sentence that naturally uses KW5 as a topic
- Total summary: 60 words or fewer — count carefully
- mod1_summary value must be plain text only — no ** markers, no backslashes, no curly braces

EXAMPLE (for a composites QA role — use your own keywords for the actual JD):
  top5_jd_skills: ["autoclave processing", "defect inspection", "SPC-driven quality", "CAPA closure", "AS9100 compliance"]
  summary_title: "Quality Engineer"
  mod1_summary: "Quality Engineer built on autoclave processing and defect inspection work at Tata Boeing. Validated SPC-driven quality and CAPA closure programs using 8D methodology and CMM inspection. Brings rigorous AS9100 compliance discipline to every manufacturing program."

Now return ONLY this JSON for the actual JD:
{
  "top5_jd_skills": ["kw1", "kw2", "kw3", "kw4", "kw5"],
  "summary_title": "exact job title from JD",
  "summary_structure_used": ${variant === 'A' ? 1 : variant === 'B' ? 2 : variant === 'C' ? 5 : 4},
  "mod1_summary": "3 sentences, plain text, no formatting, 60 words max",
  "mod2_skilllines": [
    {"label": "same label as base line 1", "skills": "reordered skills, added (Learning) if needed"},
    {"label": "same label as base line 2", "skills": "reordered skills"},
    {"label": "same label as base line 3", "skills": "reordered skills"},
    {"label": "same label as base line 4", "skills": "reordered skills"},
    {"label": "same label as base line 5", "skills": "reordered skills"}
  ],
  "missing_keywords": ["kw1", "kw2", "kw3", "kw4", "kw5"],
  "ats_coverage": "XX%",
  "composites_visible": true,
  "quantification_check": "Metrics present or Add metrics",
  "resumeReason": "One sentence why Resume ${variant} is best for this role",
  "top_matches": ["kw1", "kw2", "kw3"],
  "ai_insights": "3 to 5 specific actionable recommendations: what to emphasize in interview, red flags, sponsorship notes, or strategic tips for this specific JD"
}`;

  const text = await callGroq(system, user, apiKey, 1800);

  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return applyQCBarriers(parsed, variant);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return applyQCBarriers(JSON.parse(match[0]), variant); }
      catch { /* fall through */ }
    }
    throw new Error('Could not parse Groq response. Try again.');
  }
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

    // 3. Hard word cap: 65 words
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length > 65) {
      s = words.slice(0, 65).join(' ').replace(/[,\s]+$/, '') + '.';
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

    // 7. Build LaTeX version: **text** -> \textbf{text}
    //    Also escape bare & (e.g. GD&T → GD\&T) — LaTeX-only; mod1_summary
    //    keeps the readable form for UI display.
    parsed.mod1_summary_latex = s
      .replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}')
      .replace(/&/g, '\\&');
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
- ZERO metrics. ZERO numbers. ZERO stats. Not "15% to 3%". Not "2% void content". Not "defect rates". Not "autoclave at 275F". Not "8 hours to 5 minutes". Not any achievement number whatsoever.
- ZERO achievement statements. "At Tata Boeing I reduced..." is FORBIDDEN here. So is any variant of it.
- The reader decides whether to accept based on your context and intent, not your resume. Save the resume for the follow-up.
- No subject line. No sign-off. No dashes. No em-dashes. No exclamation marks. No bullets.`,

    followup:
`TASK: Write a LinkedIn Follow-up Message (sent after the connection is accepted).
HARD LIMIT: 100 words.
STRUCTURE (4 sentences, natural paragraph):
  S1: Thank you for connecting.
  S2: Why you reached out: Siddardth ${intentSummary}.
  S3: One relevant stat — choose the best fit: Tata Boeing defect rate 15% to 3% using SPC and 8D, OR SAMPE 24-inch composite fuselage with 2% void content via autoclave at 275F and 40 psi, OR Beckman Institute cure cycle from 8 hours to 5 minutes.
  S4: One specific ask: ${personaAsk}.
Sign off: Siddardth
No bullets. No dashes. No jargon.`,

    cold_email:
`TASK: Write a Cold Email.
OUTPUT FORMAT — first line is the subject line, then one blank line, then the body:
Subject: [60 chars max — include role or company name, UIUC, and hint of STEM OPT availability]

BODY — 4 paragraphs, under 150 words total:
P1: Siddardth Pathipaka. M.S. Aerospace Engineering, UIUC, December 2025. ${intent === 'job_application_ask' ? `Applied for the ${role} position at ${company}.` : `Writing to introduce myself and explore opportunities at ${company}.`}
P2: Reference their specific work area. Connect to Tata Boeing composites (defect rate 15% to 3%), SAMPE (24-inch fuselage, 2% void content, autoclave at 275F and 40 psi), or ABAQUS/ANSYS structural analysis. Be specific. 2 to 3 sentences.
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
- SAMPE: led fabrication of a 24-inch composite fuselage, 2% void content via autoclave cure at 275F and 40 psi
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
