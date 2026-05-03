import axe from 'axe-core';
import type {AccessibilityReport, AuditSettings, AuditStandard, KodeGlassViolation} from '../accessibility-report';
import {normalizeAxeViolations} from './axe-report-normalizer';
import {collectHeadings, collectLandmarks} from './dom-summary';

export async function analyzeCurrentPage(auditSettings: AuditSettings): Promise<AccessibilityReport> {
  const startedAt = performance.now();
  const violations = await analyzeWithAxe(auditSettings);

  return {
    auditSettings,
    engineStatuses: [{durationMs: Math.round(performance.now() - startedAt), engine: 'axe-core', label: 'axe', status: 'completed', violations: violations.length}],
    generatedAt: Date.now(),
    headings: collectHeadings(),
    landmarks: collectLandmarks(),
    pageTitle: document.title || 'Untitled page',
    pageUrl: location.href,
    violations,
  };
}

export async function analyzeWithAxe(auditSettings: AuditSettings): Promise<readonly KodeGlassViolation[]> {
  const results = await runAxe(auditSettings);

  return normalizeAxeViolations(results.violations);
}

async function runAxe(auditSettings: AuditSettings): Promise<axe.AxeResults> {
  return axe.run(document, {
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