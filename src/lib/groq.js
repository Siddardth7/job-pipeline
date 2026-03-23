// ─── Groq AI Helper ───────────────────────────────────────────────────────────
// Uses Groq's free API (llama-3.3-70b) for tailored analysis and drafting

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

export async function callGroq(systemPrompt, userPrompt, apiKey, maxTokens = 1000) {
  if (!apiKey) throw new Error('No Groq API key configured. Add it in Settings → Groq AI.');

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
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

  const system = `You are a resume optimization expert for an aerospace engineering job applicant.

CANDIDATE: Siddardth Pathipaka
- MS Aerospace Engineering, UIUC (Dec 2025)
- STEM OPT, 3 years, no sponsorship cost to employer
- Tata Boeing: reduced defect rates 15% to 3% using SPC and 8D methodology
- SAMPE: led fabrication of 24-inch composite fuselage, 2% void content via autoclave at 275F and 40 psi
- Beckman Institute: reduced cure cycle from 8 hours to 5 minutes
- Resume variant: ${variant} — ${RESUMES[variant]?.name}

STRICT RULES:
1. Only TWO modifications: Summary (mod1_summary) and Skills (mod2_skilllines)
2. Experience and project bullet points are LOCKED — never modify them
3. No em-dashes in output
4. Output must be valid JSON only — no markdown fences

SUMMARY RULES — HARD CONSTRAINTS (violating any rule means the output is rejected):

STEP 1 — IDENTIFY KEYWORDS
Put the top 5 JD duties/skills in top5_jd_skills as [Kw1, Kw2, Kw3, Kw4, Kw5].
These must appear VERBATIM in the summary. No synonyms, no paraphrasing.

STEP 2 — PICK ONE STRUCTURE based on what the JD emphasizes:
  Structure 1 (manufacturing execution, plant ops, quality ops):
    **[Title]** with hands-on **[Kw1]** and **[Kw2]** experience at [company/project]. Proven ability to drive **[Kw3]** and **[Kw4]** results using [skills]. [Soft close with **[Kw5]**].

  Structure 2 (quality systems, inspection, audits, AS9100):
    **[Title]** specializing in **[Kw1]** and **[Kw2]**, with direct industry exposure at [company/project]. Built a track record of **[Kw3]** improvements and **[Kw4]** delivery using [skills]. [Soft close with **[Kw5]**].

  Structure 3 (R&D to production, process development, cure cycle, materials):
    **[Title]** with end-to-end **[Kw1]** exposure from [experience1] to [experience2]. Applies **[Kw2]** and **[Kw3]** methods to deliver **[Kw4]** outcomes. [Soft close with **[Kw5]**].

  Structure 4 (NPI, tooling, product launch, APQP, commissioning):
    **[Title]** combining **[Kw1]** depth with **[Kw2]** execution at [company/project]. Consistently delivers **[Kw3]** and **[Kw4]** outcomes through disciplined [skills]. [Soft close with **[Kw5]**].

  Structure 5 (composites, NDT, validation, structural analysis, materials):
    **[Title]** built on **[Kw1]** and **[Kw2]** work at [company/project]. Validated through **[Kw3]** and **[Kw4]** projects that directly map to production environments. [Soft close with **[Kw5]**].

STEP 3 — FILL THE SLOTS:
  [Title]           -> JD job title if specific, else resume variant focus name.
                      Examples: "Composites Manufacturing Engineer", "NPI & Tooling Engineer", "Quality Systems Engineer"
  [Kw1]..[Kw5]     -> top5_jd_skills verbatim, each wrapped in ** bold markers
  [company/project] -> most relevant from: Tata Boeing (quality/manufacturing),
                      SAMPE (composites/fabrication), Beckman Institute (R&D/materials/cure cycle)
  [skills]          -> 2-3 specific tools/methods Siddardth actually used, relevant to the JD
  [Soft close]      -> pick from bank below, weave Kw5 in naturally

SOFT CLOSE BANK:
  A. Adapts quickly from lab scale to production floor, ready to apply **[Kw5]** from day one.
  B. Detail-oriented with a root-cause bias across **[Kw5]** workflows.
  C. Brings structured problem-solving to cross-functional **[Kw5]** environments.
  D. Comfortable driving alignment between engineering and production on **[Kw5]** initiatives.
  E. Consistently delivers zero-escape quality at the component level across **[Kw5]** programs.

STEP 4 — COMPLIANCE CHECK before finalizing:
  - All 5 keywords present verbatim in the summary
  - ** markers on: [Title] + all 5 keywords — nothing else bolded
  - Kw5 appears ONLY in the soft close sentence (S3) — never use Kw5 in the [skills] slot of S2
  - [skills] in S2 must use tools/methods from the candidate background, NOT keywords from top5_jd_skills
  - Exactly 3 sentences — one period each, no semicolons
  - Total word count 60 or under
  - No first-person: no "I am", "I have", "I bring", "I hold"
  - No passive voice: no "is applied", "has been", "was implemented", "are utilized"
  - No filler: no "passionate", "dynamic", "well-equipped", "excited to", "results-driven"
  - CRITICAL: Use ONLY ** markers for bold — never write \textbf{} or any LaTeX syntax in mod1_summary

SKILLS RULES:
- You are given the 5 base skilllines for this variant. You must return all 5 lines, modified
- Within each line, rearrange the skills order so JD-relevant skills appear FIRST
- For missing skills that appear in top5_jd_skills: add to the relevant line
  - Industry-adjacent skill the candidate could learn: append with (Learning) label
  - Transferable skill from related experience: append with (Transferable) label
  - Completely unrelated to aerospace/manufacturing: do NOT add at all
- Never add skills without a label if Siddardth has never used them
- Keep the same 5 label categories — do not rename or remove any line`;

  const user = `Analyze this JD and return the JSON object below.

BASE SKILLLINES FOR RESUME ${variant} (you must return all 5, modified):
${baseLinesJson}

JD:
${jd.slice(0, 3500)}

Return ONLY this JSON (no markdown, no code fences):
{
  "top5_jd_skills": ["skill1", "skill2", "skill3", "skill4", "skill5"],
  "summary_structure_used": 1,
  "mod1_summary": "EXACTLY 3 sentences. Use ** bold markers on Title and all 5 keywords. No I/me pronouns.",
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
    return applyQCBarriers(parsed);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return applyQCBarriers(JSON.parse(match[0])); }
      catch { /* fall through */ }
    }
    throw new Error('Could not parse Groq response. Try again.');
  }
}

// ── QC BARRIER — applied to every parsed Groq result ────────────────────────
// Enforces hard structural rules. Does NOT strip individual words —
// word-level removal breaks sentence grammar. Prompt handles content quality.
function applyQCBarriers(parsed) {
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

    // 1. Enforce max 3 sentences (hard structural rule)
    const sentences = s.match(/[^.!?]+[.!?]+/g) || [s];
    if (sentences.length > 3) s = sentences.slice(0, 3).join(' ');

    // 2. Hard word cap: 65 words — trim trailing words if over
    // Count words ignoring ** markers so bold tokens don't inflate the count
    const stripped = s.replace(/\*\*/g, '');
    const words = stripped.split(/\s+/).filter(Boolean);
    if (words.length > 65) {
      // Rebuild the trimmed sentence preserving ** markers
      let count = 0;
      let cutIdx = s.length;
      let inMarker = false;
      const tokens = s.split(/(\*\*|\s+)/);
      let rebuilt = '';
      for (const token of tokens) {
        if (token === '**') { rebuilt += token; inMarker = !inMarker; continue; }
        if (/^\s+$/.test(token)) { rebuilt += token; continue; }
        if (count >= 65) { cutIdx = rebuilt.length; break; }
        rebuilt += token;
        count++;
      }
      s = rebuilt.slice(0, cutIdx).replace(/[,\s*]+$/, '') + '.';
    }

    // 3. Clean up spacing artifacts
    s = s.replace(/ {2,}/g, ' ').replace(/ ,/g, ',').trim();

    // 4. Build LaTeX version: convert **text** -> \textbf{text}
    parsed.mod1_summary_latex = s.replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}');

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
