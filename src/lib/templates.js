export const DEFAULT_TEMPLATES = [
  {
    id: "linkedin-cold",
    name: "LinkedIn Cold Outreach",
    body: "Hi {{firstName}}, I'm a recently graduated aerospace engineer (MS UIUC, Dec 2025) with hands-on {{variantFocus}} experience — {{myAchievement}}. I noticed {{company}} is hiring for {{role}} and would love to connect and learn more about the team. Would you be open to a quick chat?"
  },
  {
    id: "recruiter-msg",
    name: "Recruiter Message",
    body: "Hi {{firstName}}, I'm reaching out about the {{role}} opening at {{company}}. MS Aerospace grad (UIUC, Dec 2025), STEM OPT — 3 years, zero sponsorship cost to employer. My background is in {{variantFocus}}: {{variantSkills}}. Happy to share my resume if there's a fit.\n\nBest,\nSiddardth"
  },
  {
    id: "referral-ask",
    name: "Referral Ask",
    body: "Hi {{firstName}}, I came across your profile while researching {{company}}. I'm applying for {{role}} and have a background in {{variantFocus}} with composites and manufacturing experience (Tata Boeing, SAMPE). If you're open to it, I'd really value your perspective on the team — happy to share my resume."
  },
  {
    id: "cover-letter",
    name: "Cover Letter",
    body: "Dear Hiring Manager,\n\nI am writing to apply for the {{role}} position at {{company}}. As an MS Aerospace Engineering graduate from UIUC (December 2025), I bring hands-on experience in {{variantFocus}}.\n\nAt Tata Boeing, I reduced defect rates from 15% to 3% through SPC and 8D methodology. At SAMPE, I led fabrication of a 24\" composite fuselage achieving 2% void content via autoclave cure at 275°F/40 psi.\n\nI am available on STEM OPT for 3 years with no sponsorship cost to the employer, and I am excited about the opportunity to contribute to {{company}}.\n\nSincerely,\nSiddardth Pathipaka"
  }
];

export function fillTemplate(template, vars) {
  let result = template.body || template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value || '');
  }
  return result;
}
