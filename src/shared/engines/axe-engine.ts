import axe from 'axe-core';
import type {AccessibilityReport, AuditSettings, AuditStandard, KodeGlassViolation} from '../accessibility-report';
import {normalizeAxeViolations} from './axe-report-normalizer';
import {collectHeadings, collectLandmarks} from './dom-summary';
import {findInteractiveNameViolations} from './interactive-name-guard';
import {collectAccessibilityScanScopes, toScanScopeSummaries, type AccessibilityScanScope} from './scan-scopes';
import {createWcagCoverage, enrichViolationsWithWcagCriteria} from '../wcag-coverage';

export async function analyzeCurrentPage(auditSettings: AuditSettings): Promise<AccessibilityReport> {
  const startedAt = performance.now();
  const scanScopes = collectAccessibilityScanScopes();
  const violations = enrichViolationsWithWcagCriteria(await analyzeWithAxe(auditSettings, scanScopes));
  const engineStatuses = [{durationMs: Math.round(performance.now() - startedAt), engine: 'axe-core' as const, label: 'axe', scopes: scanScopes.length, status: 'completed' as const, violations: violations.length}];

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

export async function analyzeWithAxe(
  auditSettings: AuditSettings,
  scanScopes: readonly AccessibilityScanScope[] = collectAccessibilityScanScopes(),
): Promise<readonly KodeGlassViolation[]> {
  const violations: KodeGlassViolation[] = [];

  for (const scanScope of scanScopes) {
    const result = await runAxe(auditSettings, scanScope.root);

    violations.push(...normalizeAxeViolations(result.violations, scanScope.root));
  }

  violations.push(...findInteractiveNameViolations(auditSettings, scanScopes));

  return violations;
}

async function runAxe(auditSettings: AuditSettings, root: Document | Element): Promise<axe.AxeResults> {
  return axe.run(root, {
    resultTypes: ['violations'],
    runOnly: {
      type: 'tag',
      values: getAxeTags(auditSettings.standard),
    },
  });
}

function getAxeTags(standard: AuditStandard): string[] {
  switch (standard) {
    case 'wcag2a':
      return ['wcag2a', 'wcag21a', 'wcag22a'];
    case 'wcag2aa':
      return ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
    case 'wcag2aaa':
      return ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
    case 'best-practice':
      return ['best-practice'];
  }
}