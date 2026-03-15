const VARIANT_KEYWORDS = {
  A: {
    name: "Manufacturing & Plant Ops",
    primary: ["gd&t","gdandt","cmm","fixtures","jigs","dimensional inspection","metrology","tolerance","manufacturing engineer","assembly","plant operations","ppap","first article","fai","as9100","nadcap","production","machining","quality control","inspection","coordinate measuring"],
    secondary: ["shop floor","cnc","line balancing","capacity planning","stamping","casting","forging","welding","production planning"]
  },
  B: {
    name: "Process & CI",
    primary: ["fmea","pfmea","dfmea","spc","8d","lean","kaizen","six sigma","dmaic","continuous improvement","process engineer","vsm","value stream","poka-yoke","5s","root cause","capa","oee","defect reduction","process improvement","corrective action"],
    secondary: ["process optimization","cycle time","throughput","waste reduction","process validation","efficiency","yield improvement"]
  },
  C: {
    name: "Quality & Materials",
    primary: ["cmm","mrb","composites","quality assurance","ndt","non-destructive","capa","as9100","iso 9001","material review board","nonconformance","prepreg","autoclave","carbon fiber","cfrp","layup","vacuum bagging","materials engineer","composite structures","quality engineer"],
    secondary: ["supplier quality","incoming inspection","fiber reinforced","thermoplastic","certification","composite manufacturing","ultrasonics"]
  },
  D: {
    name: "Equipment & NPI",
    primary: ["tooling","pfmea","doe","design of experiments","npi","new product introduction","equipment engineer","process development","validation","qualification","iq oq pq","commissioning","prototype","apqp","r&d","manufacturing readiness"],
    secondary: ["product development","design review","tool design","fixture design","production launch","capital equipment"]
  }
};

const TEMPLATE_SUMMARIES = {
  A: "Manufacturing engineer with expertise in GD&T, CMM inspection, and fixture design. Reduced defect rates from 15% to 3% through SPC implementation at Tata Boeing. STEM OPT — 3 years, no sponsorship cost.",
  B: "Process and continuous improvement engineer with hands-on FMEA, SPC, and 8D problem-solving experience. Drove 15% to 3% defect reduction via lean methodology. STEM OPT — 3 years, no sponsorship cost.",
  C: "Materials and quality engineer specializing in composites manufacturing and CMM inspection. Led 24-inch composite fuselage achieving 2% void content at SAMPE. STEM OPT — 3 years, no sponsorship cost.",
  D: "Equipment and NPI engineer experienced in tooling design, DOE, and process validation. Reduced cure cycle from 8 hours to 5 minutes at Beckman Institute. STEM OPT — 3 years, no sponsorship cost."
};

// LaTeX skillline format — copy-paste directly into Overleaf
const TEMPLATE_SKILLS = {
  A: `\\skillline{Manufacturing \\& Quality:}{GD\\&T, CMM Inspection, First Article Inspection, PPAP, AS9100, SPC, Dimensional Inspection}
\\skillline{Process \\& Tooling:}{Fixtures \\& Jigs, Metrology, Tolerance Analysis, NADCAP, Production Planning, Shop Floor}
\\skillline{Engineering Tools:}{SolidWorks, CATIA, MATLAB, Python}
\\skillline{Manufacturing Processes:}{Machining, Assembly, Stamping, Casting, Forging, Welding, CNC}
\\skillline{Project Management:}{Cross-Functional Collaboration, Continuous Improvement, Lean Methodologies}`,

  B: `\\skillline{Quality \\& CI Systems:}{FMEA, SPC, 8D Root Cause Analysis, DMAIC, CAPA, Kaizen, Lean, Six Sigma}
\\skillline{Process Tools:}{Value Stream Mapping, Poka-Yoke, 5S, OEE, Defect Reduction, Process Optimization, Corrective Action}
\\skillline{Engineering Tools:}{SolidWorks, MATLAB, Python, Minitab}
\\skillline{Documentation:}{Technical Writing, SOPs, Control Plans, Work Instructions, Change Control}
\\skillline{Project Management:}{Cross-Functional Collaboration, Continuous Improvement, Lean Methodologies}`,

  C: `\\skillline{Quality Systems:}{CAPA, FMEA, 8D Root Cause Analysis, SPC, MRB, GD\\&T, CMM Inspection}
\\skillline{Regulatory \\& Documentation:}{Technical Writing, SOPs, Change Control, Quality Records, ISO Standards, AS9100}
\\skillline{Manufacturing \\& Materials:}{Prepreg Layup, Autoclave Processing, Vacuum Bagging, Composite Materials, NDT}
\\skillline{Engineering Tools:}{ABAQUS, ANSYS, FEA, SolidWorks, CATIA, MATLAB, Python}
\\skillline{Project Management:}{Cross-Functional Collaboration, Continuous Improvement, Lean Methodologies}`,

  D: `\\skillline{NPI \\& Tooling:}{PFMEA, DOE, APQP, Tooling Design, Fixture Design, Process Validation, IQ/OQ/PQ}
\\skillline{Product Development:}{New Product Introduction, Design Review, Prototype, Manufacturing Readiness, Commissioning}
\\skillline{Engineering Tools:}{SolidWorks, CATIA, FEA, MATLAB, Python}
\\skillline{Manufacturing:}{Capital Equipment, Production Launch, Process Development, Validation, R\\&D}
\\skillline{Project Management:}{Cross-Functional Collaboration, Continuous Improvement, Lean Methodologies}`,
};

export function analyzeJob(jdText, selectedVariant = null) {
  const text = jdText.toLowerCase();

  // Score each variant
  const scores = {};
  for (const [key, variant] of Object.entries(VARIANT_KEYWORDS)) {
    let hits = 0;
    const totalPossible = (variant.primary.length * 2) + variant.secondary.length;

    for (const kw of variant.primary) {
      if (text.includes(kw)) hits += 2;
    }
    for (const kw of variant.secondary) {
      if (text.includes(kw)) hits += 1;
    }

    scores[key] = totalPossible > 0 ? (hits / totalPossible) * 100 : 0;
  }

  // Pick best variant (or use override)
  let recommended = selectedVariant;
  if (!recommended || !['A','B','C','D'].includes(recommended)) {
    recommended = Object.entries(scores).sort((a,b) => b[1]-a[1])[0][0];
  }

  const variant = VARIANT_KEYWORDS[recommended];
  const rawScore = scores[recommended];
  const atsCoverage = Math.min(92, Math.max(25, Math.round(rawScore))) + '%';

  // Missing keywords: top 5 primary from recommended not in JD
  const missing_keywords = variant.primary
    .filter(kw => !text.includes(kw))
    .slice(0, 5);

  // Composites visible
  const compositeTerms = ['composites','cfrp','prepreg','autoclave','layup','carbon fiber'];
  const composites_visible = compositeTerms.some(t => text.includes(t));

  // Quantification check
  const hasMetrics = /\d+%|\d+\s*(years?|months?|units?|parts?|%)/i.test(jdText);
  const quantification_check = hasMetrics ? "Metrics present" : "Add metrics";

  // Top matches
  const top_matches = variant.primary.filter(kw => text.includes(kw)).slice(0, 8);

  return {
    recommendedResume: recommended,
    resumeReason: `Highest keyword alignment with ${VARIANT_KEYWORDS[recommended].name} profile (${Math.round(rawScore)}% match)`,
    ats_coverage: atsCoverage,
    missing_keywords,
    composites_visible,
    quantification_check,
    mod1_summary: TEMPLATE_SUMMARIES[recommended],
    mod2_skills: TEMPLATE_SKILLS[recommended],
    top_matches
  };
}

export { VARIANT_KEYWORDS, TEMPLATE_SUMMARIES, TEMPLATE_SKILLS };
