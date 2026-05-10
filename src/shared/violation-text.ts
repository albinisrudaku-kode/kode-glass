/**
 * Normalizes violation guidance text by:
 * - Collapsing internal whitespace
 * - Removing the "Fix any of the following:" prefix if present
 */
export function normalizeViolationGuidance(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/^Fix any of the following:\s*/i, '').trim();
}