import type {KodeGlassViolation} from '../accessibility-report';
import {normalizeViolationGuidance} from '../violation-text';

const summaryOverrides: Record<string, string> = {
  'button-name': 'Button has no accessible name',
  'color-contrast': 'Text contrast is too low',
  'image-alt': 'Image is missing alternate text',
  'link-name': 'Link has no accessible name',
  'target-size': 'Tap target is too small',
};

export function getReadableViolationSummary(violation: Pick<KodeGlassViolation, 'ruleId' | 'summary' | 'title'>): string {
  const override = summaryOverrides[violation.ruleId];

  if (override) {
    return override;
  }

  const summary = normalizeViolationGuidance(violation.title ?? violation.summary);
  return summary || violation.ruleId;
}

export function getReadableViolationGuidance(guidance: string): string {
  return guidance
    .replace(/\s+/g, ' ')
    .replace(/^Fix (?:any|all) of the following:\s*/i, '')
    .replace(/(?:Fix (?:any|all) of the following:)/gi, '')
    .trim();
}
