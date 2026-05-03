import {Checker} from 'accessibility-checker-engine/ace-node.js';
import type {AuditSettings, AuditStandard, KodeGlassViolation, ViolationSeverity} from '../accessibility-report';
import {getElementBounds, getElementSelector} from './dom-summary';

type IbmResultValueKind = 'VIOLATION' | 'RECOMMENDATION' | 'INFORMATION';
type IbmResultValueOutcome = 'FAIL' | 'MANUAL' | 'PASS' | 'POTENTIAL';
type IbmResultLevel = 'manual' | 'pass' | 'potentialrecommendation' | 'potentialviolation' | 'recommendation' | 'violation';

interface IbmResultPath {
  readonly aria?: string;
  readonly dom?: string;
}

interface IbmResultBounds {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

interface IbmEngineResult {
  readonly bounds?: IbmResultBounds;
  readonly category?: string;
  readonly help?: string;
  readonly ignored?: boolean;
  level?: IbmResultLevel;
  readonly message?: string;
  readonly messageArgs?: readonly string[];
  readonly node?: Node;
  readonly path?: IbmResultPath;
  readonly reasonId?: string;
  readonly ruleId: string;
  readonly snippet?: string;
  readonly value?: readonly [IbmResultValueKind, IbmResultValueOutcome];
}

interface IbmEngineReport {
  readonly results?: readonly IbmEngineResult[];
}

const ibmHelpBaseUrl = 'https://www.ibm.com/able/requirements/checker-rule-sets/';

export async function analyzeWithIbmEqualAccess(auditSettings: AuditSettings): Promise<readonly KodeGlassViolation[]> {
  const policies = getIbmPolicies(auditSettings.standard);

  if (policies.length === 0) {
    return [];
  }

  const checker = new Checker();
  const report = await checker.check(document, [...policies]) as IbmEngineReport;

  return normalizeIbmViolations(report.results ?? []);
}

function normalizeIbmViolations(results: readonly IbmEngineResult[]): readonly KodeGlassViolation[] {
  return results
    .filter(result => !result.ignored && getIbmLevel(result) !== 'pass')
    .map((result, resultIndex) => normalizeIbmResult(result, resultIndex));
}

function normalizeIbmResult(result: IbmEngineResult, resultIndex: number): KodeGlassViolation {
  const element = getIbmResultElement(result);
  const selector = element ? getElementSelector(element) : result.path?.dom ?? result.path?.aria ?? 'document';
  const level = getIbmLevel(result);

  return {
    bounds: element ? getElementBounds(element) : normalizeIbmBounds(result.bounds),
    description: getIbmDescription(result, level),
    engine: 'ibm-equal-access',
    guidance: getIbmGuidance(result),
    helpUrl: ibmHelpBaseUrl,
    id: `ibm:${result.ruleId}:${result.reasonId ?? level}:${resultIndex}:${selector}`,
    impact: level,
    ruleId: result.ruleId,
    selector,
    severity: getIbmSeverity(level),
    summary: result.message ?? result.ruleId,
    title: result.message ?? result.ruleId,
  };
}

function getIbmDescription(result: IbmEngineResult, level: IbmResultLevel): string {
  return `${formatIbmLevel(level)} from IBM Equal Access rule ${formatIbmRuleId(result.ruleId)}.`;
}

function getIbmPolicies(standard: AuditStandard): readonly string[] {
  switch (standard) {
    case 'wcag2a':
      return [];
    case 'wcag2aa':
    case 'wcag2aaa':
      return ['WCAG_2_2'];
    case 'best-practice':
      return ['IBM_Accessibility'];
  }
}

function getIbmLevel(result: IbmEngineResult): IbmResultLevel {
  if (result.level) {
    return result.level;
  }

  const value = result.value;

  if (!value || value[1] === 'PASS') {
    return 'pass';
  }

  if (value[1] === 'MANUAL') {
    return 'manual';
  }

  if (value[0] === 'VIOLATION') {
    return value[1] === 'FAIL' ? 'violation' : 'potentialviolation';
  }

  if (value[0] === 'RECOMMENDATION') {
    return value[1] === 'FAIL' ? 'recommendation' : 'potentialrecommendation';
  }

  return 'manual';
}

function getIbmSeverity(level: IbmResultLevel): ViolationSeverity {
  switch (level) {
    case 'violation':
      return 'critical';
    case 'potentialviolation':
    case 'recommendation':
      return 'warning';
    default:
      return 'info';
  }
}

function getIbmGuidance(result: IbmEngineResult): string | undefined {
  const normalizedRuleId = result.ruleId.toLowerCase();

  if (normalizedRuleId.includes('contrast')) {
    return 'Increase the foreground and background contrast for the highlighted text until it meets the selected WCAG threshold.';
  }

  if (normalizedRuleId.includes('eventhandler') || normalizedRuleId.includes('onclick') || normalizedRuleId.includes('keyboard')) {
    return 'Use a native interactive element, or add the keyboard support and ARIA role needed for this custom interaction.';
  }

  if (normalizedRuleId.includes('label') || normalizedRuleId.includes('accessiblename')) {
    return 'Provide a clear accessible name using visible text, a label element, aria-label, or aria-labelledby.';
  }

  if (normalizedRuleId.includes('alt')) {
    return 'Provide equivalent text for meaningful media, or mark decorative content so assistive technology can ignore it.';
  }

  if (normalizedRuleId.includes('role')) {
    return 'Use a valid ARIA role that matches the element behavior, or prefer a native HTML element with the correct semantics.';
  }

  if (normalizedRuleId.includes('focus') || normalizedRuleId.includes('tabbable')) {
    return 'Make the highlighted control reachable, visible, and operable with keyboard focus in a predictable order.';
  }

  if (normalizedRuleId.includes('heading')) {
    return 'Use heading markup for real section headings and keep heading levels in a meaningful document order.';
  }

  if (normalizedRuleId.includes('landmark') || normalizedRuleId.includes('region')) {
    return 'Use clear landmarks and unique landmark labels so page regions are easy to navigate.';
  }

  if (normalizedRuleId.includes('target')) {
    return 'Increase the interactive target size or spacing so the control is easier to activate accurately.';
  }

  return result.message ? 'Review the highlighted element and update it so this IBM Equal Access rule passes.' : undefined;
}

function formatIbmLevel(level: IbmResultLevel): string {
  switch (level) {
    case 'potentialrecommendation':
      return 'Potential recommendation';
    case 'potentialviolation':
      return 'Potential violation';
    default:
      return level.charAt(0).toUpperCase() + level.slice(1);
  }
}

function formatIbmRuleId(ruleId: string): string {
  return ruleId
    .replace(/^ibma_/i, '')
    .replace(/^wcag\d+_/i, '')
    .replace(/_/g, ' ');
}

function getIbmResultElement(result: IbmEngineResult): Element | undefined {
  if (result.node instanceof Element) {
    return result.node;
  }

  if (!result.path?.dom) {
    return undefined;
  }

  try {
    const node = document.evaluate(result.path.dom, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

    return node instanceof Element ? node : undefined;
  } catch {
    return undefined;
  }
}

function normalizeIbmBounds(bounds: IbmResultBounds | undefined): KodeGlassViolation['bounds'] {
  if (!bounds || bounds.width === 0 && bounds.height === 0) {
    return undefined;
  }

  return {
    height: Math.round(bounds.height),
    width: Math.round(bounds.width),
    x: Math.round(bounds.left + window.scrollX),
    y: Math.round(bounds.top + window.scrollY),
  };
}
