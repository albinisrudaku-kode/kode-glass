import {computeAccessibleName, getRole} from 'dom-accessibility-api';
import type {AuditSettings, KodeGlassViolation} from '../accessibility-report';
import {getElementBounds, getElementSelector} from './dom-summary';
import type {AccessibilityScanScope} from './scan-scopes';

const interactiveNameSelectors = [
  'button',
  'a[href]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="image"]',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="switch"]',
] as const;

const interactiveNameSelector = interactiveNameSelectors.join(',');

export function findInteractiveNameViolations(
  auditSettings: AuditSettings,
  scanScopes: readonly AccessibilityScanScope[],
): readonly KodeGlassViolation[] {
  if (auditSettings.standard === 'best-practice') {
    return [];
  }

  const violations = new Map<string, KodeGlassViolation>();

  for (const scanScope of scanScopes) {
    for (const element of collectInteractiveElements(scanScope.root)) {
      if (!shouldReportMissingName(element)) {
        continue;
      }

      const selector = getElementSelector(element);
      violations.set(selector, createInteractiveNameViolation(element, selector));
    }
  }

  return [...violations.values()];
}

function collectInteractiveElements(root: Document | Element): readonly HTMLElement[] {
  const elements = new Set<HTMLElement>();

  if (root instanceof HTMLElement && root.matches(interactiveNameSelector)) {
    elements.add(root);
  }

  root.querySelectorAll<HTMLElement>(interactiveNameSelector).forEach(element => elements.add(element));

  return [...elements];
}

function shouldReportMissingName(element: HTMLElement): boolean {
  return isVisibleToUsers(element)
    && !isHiddenFromAssistiveTechnology(element)
    && getRequiredNameRole(element) !== undefined
    && computeAccessibleName(element).replace(/\s+/g, ' ').trim().length === 0;
}

function isVisibleToUsers(element: HTMLElement): boolean {
  const bounds = getElementBounds(element);

  if (!bounds || bounds.width === 0 || bounds.height === 0) {
    return false;
  }

  let current: HTMLElement | null = element;

  while (current) {
    const styles = getComputedStyle(current);

    if (styles.display === 'none' || styles.visibility === 'hidden' || Number(styles.opacity) === 0) {
      return false;
    }

    current = current.parentElement;
  }

  return true;
}

function isHiddenFromAssistiveTechnology(element: HTMLElement): boolean {
  return element.closest('[aria-hidden="true"], [hidden], [inert], kode-glass-overlay') !== null;
}

function getRequiredNameRole(element: HTMLElement): string | undefined {
  const role = getRole(element) ?? element.getAttribute('role') ?? element.tagName.toLowerCase();

  if (['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'tab', 'switch'].includes(role)) {
    return role;
  }

  if (element instanceof HTMLInputElement && ['button', 'submit', 'reset', 'image'].includes(element.type)) {
    return 'button';
  }

  return undefined;
}

function createInteractiveNameViolation(element: HTMLElement, selector: string): KodeGlassViolation {
  const role = getRequiredNameRole(element) ?? 'control';
  const isLink = role === 'link';
  const ruleId = isLink ? 'link-name' : 'button-name';

  return {
    bounds: getElementBounds(element),
    description: 'Visible interactive controls must expose a name to assistive technologies.',
    engine: 'axe-core',
    guidance: 'Add visible text, aria-label, aria-labelledby, or another valid accessible-name source.',
    helpUrl: `https://dequeuniversity.com/rules/axe/4.10/${ruleId}`,
    id: `interactive-name:${selector}`,
    impact: 'serious',
    ruleId,
    selector,
    severity: 'critical',
    sourceEngines: ['axe-core'],
    summary: `${formatRole(role)} has no accessible name`,
    title: `${formatRole(role)} has no accessible name`,
  };
}

function formatRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).replace(/-/g, ' ');
}
