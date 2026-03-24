import { VARIANT_KEYWORDS } from './scoring.js';

/**
 * Build the payload for the /generate-cover-letter endpoint
 * from the analysis result and job fields.
 */
export function buildCoverLetterPayload({ result, company, role }) {
  const variantFocus = VARIANT_KEYWORDS[result.recommendedResume]?.name ?? "";

  return {
    company,
    role,
    variant_focus: variantFocus,
    summary: result.mod1_summary,
  };
}
