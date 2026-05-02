import axe from 'axe-core';
import type {AccessibilityReport, AuditSettings, AuditStandard} from '../accessibility-report';
import {normalizeAxeViolations} from './axe-report-normalizer';
import {collectHeadings, collectLandmarks} from './dom-summary';

export async function analyzeCurrentPage(auditSettings: AuditSettings): Promise<AccessibilityReport> {
  const results = await runAxeWithoutPreloadNoise(auditSettings);

  return {
    auditSettings,
    generatedAt: Date.now(),
    headings: collectHeadings(),
    landmarks: collectLandmarks(),
    pageTitle: document.title || 'Untitled page',
    pageUrl: location.href,
    violations: normalizeAxeViolations(results.violations),
  };
}

async function runAxeWithoutPreloadNoise(auditSettings: AuditSettings): Promise<axe.AxeResults> {
  const originalWarn = console.warn;

  console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === 'string' && args[0].includes('Couldn\'t load preload assets')) {
      return;
    }

    originalWarn.apply(console, args as Parameters<typeof console.warn>);
  };

  try {
    return await axe.run(document, {
    resultTypes: ['violations'],
    runOnly: {
      type: 'tag',
      values: getAxeTags(auditSettings.standard),
    },
  });
  } finally {
    console.warn = originalWarn;
  }
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