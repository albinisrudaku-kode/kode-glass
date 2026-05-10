import {normalizeViolationGuidance} from '../../shared/violation-text';
import type {
  AuditStandard,
  KodeGlassViolation,
  ViolationSeverity,
  WcagCoverageItem,
  WcagCoverageStatus,
} from '../../shared/accessibility-report';

// ── Types ────────────────────────────────────────────────

export interface ViolationGroup {
  readonly count: number;
  readonly description?: string;
  readonly engineLabel: string;
  readonly fix?: ViolationFix;
  readonly guidance?: string;
  readonly helpUrl?: string;
  readonly id: string;
  readonly ruleId: string;
  readonly selectors: readonly string[];
  readonly severity: ViolationSeverity;
  readonly summary: string;
  readonly title: string;
  readonly violationIds: readonly string[];
}

export interface ViolationFix {
  readonly segments: readonly ViolationFixSegment[];
  readonly text: string;
}

export interface ViolationFixSegment {
  readonly kind: 'chip' | 'text';
  readonly text: string;
}

export interface CoveragePrincipleSummary {
  readonly failed: number;
  readonly manual: number;
  readonly passed: number;
  readonly principle: WcagCoverageItem['principle'];
  readonly total: number;
}

export type PreviewMode = 'off' | 'reader' | 'inspect';

// ── Internal helpers ─────────────────────────────────────

interface InlineChipRange {
  readonly end: number;
  readonly start: number;
  readonly text: string;
}

function formatViolationEngine(engine: KodeGlassViolation['engine']): string {
  return ({
    'axe-core': 'axe',
    'ibm-equal-access': 'IBM',
    manual: 'Manual',
    playwright: 'Playwright',
  } as Record<KodeGlassViolation['engine'], string>)[engine];
}

function getEvidenceComponentKey(violation: KodeGlassViolation): string | undefined {
  const fallbackSelector = violation.selector.split('>').slice(0, 4).join('>').trim();

    return violation.componentScope?.tagName
    ?? violation.componentScope?.selector
    ?? (fallbackSelector || undefined);
}

function findCaptureRanges(text: string, pattern: RegExp): readonly InlineChipRange[] {
  return [...text.matchAll(pattern)].flatMap(match => {
    const capture = match[1];

    if (!capture || match.index === undefined) {
      return [];
    }

    const matchStart = match.index;
    const captureStartInMatch = match[0].indexOf(capture);

    if (captureStartInMatch < 0) {
      return [];
    }

    const trimmedCapture = capture.trim();
    const leadingSpace = capture.length - capture.trimStart().length;
    const start = matchStart + captureStartInMatch + leadingSpace;

    return [{start, end: start + trimmedCapture.length, text: trimmedCapture}];
  });
}

function findWholeMatchRanges(text: string, pattern: RegExp): readonly InlineChipRange[] {
  return [...text.matchAll(pattern)].flatMap(match => {
    if (!match[0] || match.index === undefined) {
      return [];
    }

    return [{start: match.index, end: match.index + match[0].length, text: match[0]}];
  });
}

function createInlineFixSegments(guidance: string): readonly ViolationFixSegment[] {
  const ranges = [
    ...findCaptureRanges(guidance, /contrast of ([\d.]+)/gi),
    ...findWholeMatchRanges(guidance, /foreground color: [^,]+/gi),
    ...findWholeMatchRanges(guidance, /background color: [^,]+/gi),
    ...findWholeMatchRanges(guidance, /font size: [^,]+/gi),
    ...findWholeMatchRanges(guidance, /font weight: [^)]+/gi),
    ...findCaptureRanges(guidance, /Expected contrast ratio of ([\d.:]+)/gi),
    ...findWholeMatchRanges(guidance, /\d+(?:\.\d+)?\s*px(?:\s+by\s+\d+(?:\.\d+)?\s*px)?/gi),
    ...findWholeMatchRanges(guidance, /\b(?:aria-[\w-]+|alt|title|href|tabindex)\b/g),
    ...findWholeMatchRanges(guidance, /role="[^"]+"/g),
  ]
    .sort((first, second) => first.start - second.start)
    .filter((range, index, sortedRanges) => {
      const previousRange = sortedRanges[index - 1];

      return !previousRange || range.start >= previousRange.end;
    });

  if (!ranges.length) {
    return [{kind: 'text', text: guidance}];
  }

  const segments: ViolationFixSegment[] = [];
  let cursor = 0;

  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({kind: 'text', text: guidance.slice(cursor, range.start)});
    }

    segments.push({kind: 'chip', text: range.text});
    cursor = range.end;
  }

  if (cursor < guidance.length) {
    segments.push({kind: 'text', text: guidance.slice(cursor)});
  }

  return segments;
}

// ── Exported helpers ─────────────────────────────────────

export function formatAuditStandard(standard: AuditStandard): string {
  return ({
    'best-practice': 'Best practices',
    wcag2a: 'WCAG A',
    wcag2aa: 'WCAG AA',
    wcag2aaa: 'WCAG AAA',
  } as Record<AuditStandard, string>)[standard];
}

export function formatViolationEngines(engines: readonly KodeGlassViolation['engine'][]): string {
  return engines.map(formatViolationEngine).join(' + ');
}

export function formatCoverageStatus(status: WcagCoverageStatus): string {
  return ({
    failed: 'Failed',
    'needs-manual-review': 'Needs manual review',
    'not-tested': 'Not tested',
    'passed-automated': 'Passed automated checks',
  } as Record<WcagCoverageStatus, string>)[status];
}

export function getReadableSummary(violation: KodeGlassViolation): string {
  const summary = normalizeViolationGuidance(violation.title ?? violation.summary);

  if (violation.ruleId === 'color-contrast') {
    return 'Text contrast is too low';
  }

  if (violation.ruleId === 'image-alt') {
    return 'Image is missing alternate text';
  }

  if (violation.ruleId === 'link-name') {
    return 'Link has no accessible name';
  }

  if (violation.ruleId === 'target-size') {
    return 'Tap target is too small';
  }

  return summary;
}

export function getReadableGuidance(guidance: string): string {
  return guidance
    .replace(/\s+/g, ' ')
    .replace(/^Fix (?:any|all) of the following:\s*/i, '')
    .replace(/(?:Fix (?:any|all) of the following:)/gi, '')
    .trim();
}

export function createViolationFix(violation: KodeGlassViolation): ViolationFix | undefined {
  if (!violation.guidance) {
    return undefined;
  }

  const guidance = getReadableGuidance(violation.guidance);

  if (!guidance) {
    return undefined;
  }

  return {
    segments: createInlineFixSegments(guidance),
    text: guidance,
  };
}

export function selectEvidenceViolations(
  violations: readonly KodeGlassViolation[],
  maxImages: number,
): readonly KodeGlassViolation[] {
  const rankedViolations = [...violations].sort((first, second) => {
    const severityDelta = getSeverityRank(second.severity) - getSeverityRank(first.severity);

    return severityDelta || first.ruleId.localeCompare(second.ruleId) || first.selector.localeCompare(second.selector);
  });
  const selected: KodeGlassViolation[] = [];
  const selectedIds = new Set<string>();
  const componentKeys = new Set<string>();
  const ruleKeys = new Set<string>();

  for (const violation of rankedViolations) {
    const componentKey = getEvidenceComponentKey(violation);

    if (!componentKey || componentKeys.has(componentKey)) {
      continue;
    }

    selected.push(violation);
    selectedIds.add(violation.id);
    componentKeys.add(componentKey);

    if (selected.length >= maxImages) {
      return selected;
    }
  }

  for (const violation of rankedViolations) {
    const ruleKey = `${formatViolationEngines(violation.sourceEngines ?? [violation.engine])}:${violation.ruleId}`;

    if (selectedIds.has(violation.id) || ruleKeys.has(ruleKey)) {
      continue;
    }

    selected.push(violation);
    selectedIds.add(violation.id);
    ruleKeys.add(ruleKey);

    if (selected.length >= maxImages) {
      return selected;
    }
  }

  for (const violation of rankedViolations) {
    if (selectedIds.has(violation.id)) {
      continue;
    }

    selected.push(violation);

    if (selected.length >= maxImages) {
      return selected;
    }
  }

  return selected;
}

export function getHighestSeverity(current: ViolationSeverity | undefined, next: ViolationSeverity): ViolationSeverity {
  if (!current) {
    return next;
  }

  return getSeverityRank(next) > getSeverityRank(current) ? next : current;
}

export function getSeverityRank(severity: ViolationSeverity): number {
  return ({critical: 3, warning: 2, info: 1} as Record<ViolationSeverity, number>)[severity];
}

export async function wait(durationMs: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, durationMs));
}
