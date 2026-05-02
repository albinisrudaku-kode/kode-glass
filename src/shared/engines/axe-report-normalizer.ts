import type {Result, NodeResult} from 'axe-core';
import type {KodeGlassViolation, ViolationSeverity} from '../accessibility-report';
import {getElementBounds} from './dom-summary';

export function normalizeAxeViolations(results: readonly Result[]): readonly KodeGlassViolation[] {
  return results.flatMap(result =>
    result.nodes.map((node, nodeIndex) => normalizeAxeNode(result, node, nodeIndex)),
  );
}

function normalizeAxeNode(result: Result, node: NodeResult, nodeIndex: number): KodeGlassViolation {
  const selector = node.target.join(', ');
  const element = document.querySelector(selector);

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