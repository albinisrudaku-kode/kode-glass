import type {Result, NodeResult} from 'axe-core';
import type {KodeGlassViolation, ViolationSeverity} from '../accessibility-report';
import {getElementBounds} from './dom-summary';

export function normalizeAxeViolations(results: readonly Result[]): readonly KodeGlassViolation[] {
  return results.flatMap(result =>
    result.nodes.map((node, nodeIndex) => normalizeAxeNode(result, node, nodeIndex)),
  );
}

function normalizeAxeNode(result: Result, node: NodeResult, nodeIndex: number): KodeGlassViolation {
  const selector = getAxeTargets(node).map(formatAxeTarget).join(', ');
  const element = getAxeTargetElement(node);

  return {
    bounds: element ? getElementBounds(element) : undefined,
    description: result.description,
    engine: 'axe-core',
    guidance: node.failureSummary?.replace(/\s+/g, ' ').trim(),
    helpUrl: result.helpUrl,
    id: `${result.id}:${nodeIndex}:${selector}`,
    impact: result.impact ?? undefined,
    ruleId: result.id,
    selector,
    severity: getViolationSeverity(result.impact),
    summary: result.help,
    title: result.help,
  };
}

function getViolationSeverity(impact: Result['impact']): ViolationSeverity {
  switch (impact) {
    case 'critical':
    case 'serious':
      return 'critical';
    case 'moderate':
      return 'warning';
    default:
      return 'info';
  }
}

function getAxeTargetElement(node: NodeResult): Element | null {
  const cssSelectors: string[] = [];

  for (const target of getAxeTargets(node)) {
    if (typeof target === 'string') {
      cssSelectors.push(target);
    }
  }

  for (const selector of cssSelectors) {
    const element = findElementByCssSelector(selector);

    if (element) {
      return element;
    }
  }

  if (!cssSelectors.length) {
    return null;
  }

  return findElementByCssSelector(cssSelectors.join(', '));
}

function getAxeTargets(node: NodeResult): readonly unknown[] {
  return node.target as readonly unknown[];
}

function formatAxeTarget(target: unknown): string {
  return typeof target === 'string' ? target : JSON.stringify(target);
}

function findElementByCssSelector(cssSelector: string): Element | null {
  try {
    return document.querySelector(cssSelector);
  } catch {
    return null;
  }
}