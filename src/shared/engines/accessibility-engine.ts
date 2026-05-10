import type {
  AccessibilityEngine,
  AccessibilityEngineStatus,
  AccessibilityReport,
  AuditSettings,
  KodeGlassViolation,
  ViolationSeverity,
} from '../accessibility-report';
import {analyzeWithAxe} from './axe-engine';
import {collectHeadings, collectLandmarks} from './dom-summary';
import {analyzeWithIbmEqualAccess} from './ibm-equal-access-engine';
import {collectAccessibilityScanScopes, toScanScopeSummaries, type AccessibilityScanScope} from './scan-scopes';
import {createWcagCoverage, enrichViolationsWithWcagCriteria} from '../wcag-coverage';
import {logger} from '../logger';

interface EngineRunResult {
  readonly status: AccessibilityEngineStatus;
  readonly violations: readonly KodeGlassViolation[];
}

export async function analyzeCurrentPage(auditSettings: AuditSettings): Promise<AccessibilityReport> {
  const scanScopes = collectAccessibilityScanScopes();
  const [axeResult, ibmResult] = await Promise.all([
    analyzeEngine('axe-core', 'Axe', scanScopes, () => analyzeWithAxe(auditSettings, scanScopes)),
    shouldRunIbmEqualAccess(auditSettings)
      ? analyzeEngine('ibm-equal-access', 'IBM Equal Access', scanScopes, () => analyzeWithIbmEqualAccess(auditSettings, scanScopes))
      : Promise.resolve(createSkippedEngineResult('ibm-equal-access', 'IBM Equal Access', 'IBM Equal Access is not used for WCAG A-only scans.')),
  ]);
  const violations = enrichViolationsWithWcagCriteria(mergeDuplicateViolations([...axeResult.violations, ...ibmResult.violations]));
  const engineStatuses = [axeResult.status, ibmResult.status];

  return {
    auditSettings,
    coverage: createWcagCoverage(auditSettings, violations, engineStatuses),
    engineStatuses,
    generatedAt: Date.now(),
    headings: collectHeadings(),
    landmarks: collectLandmarks(),
    pageTitle: document.title || 'Untitled page',
    pageUrl: location.href,
    scanScopes: toScanScopeSummaries(scanScopes),
    violations,
  };
}

async function analyzeEngine(
  engine: AccessibilityEngine,
  label: string,
  scanScopes: readonly AccessibilityScanScope[],
  analyze: () => Promise<readonly KodeGlassViolation[]>,
): Promise<EngineRunResult> {
  const startedAt = performance.now();

  try {
    const violations = await analyze();

    return {
      status: {
        durationMs: Math.round(performance.now() - startedAt),
        engine,
        label,
        scopes: scanScopes.length,
        status: 'completed',
        violations: violations.length,
      },
      violations,
    };
  } catch (error) {
    logger.warn(`${label} analysis failed, error: ${getErrorMessage(error)}`);

    return {
      status: {
        durationMs: Math.round(performance.now() - startedAt),
        engine,
        error: getErrorMessage(error),
        label,
        scopes: scanScopes.length,
        status: 'failed',
        violations: 0,
      },
      violations: [],
    };
  }
}

function createSkippedEngineResult(engine: AccessibilityEngine, label: string, reason: string): EngineRunResult {
  return {
    status: {
      durationMs: 0,
      engine,
      error: reason,
      label,
      status: 'skipped',
      violations: 0,
    },
    violations: [],
  };
}

function shouldRunIbmEqualAccess(auditSettings: AuditSettings): boolean {
  return auditSettings.standard !== 'wcag2a';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mergeDuplicateViolations(violations: readonly KodeGlassViolation[]): readonly KodeGlassViolation[] {
  const mergedViolations = new Map<string, KodeGlassViolation>();

  for (const violation of violations) {
    const duplicateKey = getDuplicateKey(violation);
    const existingViolation = mergedViolations.get(duplicateKey);

    if (!existingViolation) {
      mergedViolations.set(duplicateKey, withSourceEngines(violation, [violation.engine]));
      continue;
    }

    mergedViolations.set(duplicateKey, mergeViolation(existingViolation, violation));
  }

  return [...mergedViolations.values()];
}

function mergeViolation(existingViolation: KodeGlassViolation, nextViolation: KodeGlassViolation): KodeGlassViolation {
  return {
    ...existingViolation,
    description: existingViolation.description ?? nextViolation.description,
    guidance: existingViolation.guidance ?? nextViolation.guidance,
    helpUrl: existingViolation.helpUrl ?? nextViolation.helpUrl,
    severity: getHighestSeverity(existingViolation.severity, nextViolation.severity),
    sourceEngines: mergeSourceEngines(existingViolation.sourceEngines ?? [existingViolation.engine], [nextViolation.engine]),
  };
}

function withSourceEngines(
  violation: KodeGlassViolation,
  sourceEngines: readonly AccessibilityEngine[],
): KodeGlassViolation {
  return {
    ...violation,
    sourceEngines,
  };
}

function mergeSourceEngines(
  currentEngines: readonly AccessibilityEngine[],
  nextEngines: readonly AccessibilityEngine[],
): readonly AccessibilityEngine[] {
  return [...new Set([...currentEngines, ...nextEngines])];
}

function getDuplicateKey(violation: KodeGlassViolation): string {
  const family = getViolationFamily(violation);
  const selector = normalizeSelector(violation.selector);

  if (!family) {
    return `${violation.engine}:${violation.ruleId}:${selector}`;
  }

  return `${family}:${selector}`;
}

function getViolationFamily(violation: KodeGlassViolation): string | undefined {
  const text = `${violation.ruleId} ${violation.summary} ${violation.title ?? ''}`.toLowerCase();

  if (text.includes('contrast')) {
    return 'contrast';
  }

  if (text.includes('alt') || text.includes('non-text')) {
    return 'alt-text';
  }

  if (text.includes('accessiblename') || text.includes('accessible name') || text.includes('label') || text.includes('link-name')) {
    return 'accessible-name';
  }

  if (text.includes('role')) {
    return 'role';
  }

  if (text.includes('keyboard') || text.includes('tabbable') || text.includes('focus')) {
    return 'keyboard-focus';
  }

  if (text.includes('heading')) {
    return 'heading';
  }

  if (text.includes('landmark') || text.includes('region')) {
    return 'landmark';
  }

  if (text.includes('target')) {
    return 'target-size';
  }

  return undefined;
}

function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, ' ').trim().toLowerCase();
}

function getHighestSeverity(first: ViolationSeverity, second: ViolationSeverity): ViolationSeverity {
  return getSeverityRank(first) >= getSeverityRank(second) ? first : second;
}

function getSeverityRank(severity: ViolationSeverity): number {
  return {critical: 3, warning: 2, info: 1}[severity];
}
