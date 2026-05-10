import type {ScanScopeKind, ScanScopeSummary} from '../accessibility-report';
import {getElementBounds, getElementSelector} from './dom-summary';

export interface AccessibilityScanScope extends ScanScopeSummary {
  readonly root: Document | Element;
}

const overlayRootSelectors = [
  '.cdk-overlay-container',
  '.cdk-global-overlay-wrapper',
  '.cdk-overlay-popover',
  '.cdk-overlay-pane',
  '[popover].cdk-overlay-popover',
] as const;

const overlayContentSelectors = [
  'ui-dialog',
  'ui-dropdown',
  'ui-drawer',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tooltip"]',
] as const;

export function collectAccessibilityScanScopes(rootDocument: Document = document): readonly AccessibilityScanScope[] {
  return [createDocumentScope(rootDocument), ...collectOverlayScanScopes(rootDocument)];
}

export function toScanScopeSummaries(scanScopes: readonly AccessibilityScanScope[]): readonly ScanScopeSummary[] {
  return scanScopes.map(({root: _root, ...summary}) => summary);
}

function collectOverlayScanScopes(rootDocument: Document): readonly AccessibilityScanScope[] {
  const overlays = new Map<Element, AccessibilityScanScope>();

  for (const selector of overlayRootSelectors) {
    rootDocument.querySelectorAll(selector).forEach(element => {
      if (!shouldScanOverlayRoot(element)) {
        return;
      }

      overlays.set(element, createElementScope(element, 'overlay'));
    });
  }

  return [...overlays.values()].sort((first, second) => first.selector.localeCompare(second.selector));
}

function createDocumentScope(rootDocument: Document): AccessibilityScanScope {
  return {
    elementCount: rootDocument.querySelectorAll('*').length,
    id: 'document',
    kind: 'document',
    label: 'Document',
    root: rootDocument,
    selector: 'document',
  };
}

function createElementScope(element: Element, kind: ScanScopeKind): AccessibilityScanScope {
  const selector = getElementSelector(element);

  return {
    bounds: getElementBounds(element) ?? getVisibleDescendantBounds(element),
    elementCount: element.querySelectorAll('*').length + 1,
    id: `${kind}:${selector}`,
    kind,
    label: getOverlayLabel(element),
    root: element,
    selector,
  };
}

function shouldScanOverlayRoot(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.closest('kode-glass-overlay')) {
    return false;
  }

  if (element.querySelector('.cdk-overlay-pane, ui-dialog, ui-dropdown, [role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"]')) {
    return true;
  }

  return hasVisibleBox(element) || getVisibleDescendantBounds(element) !== undefined;
}

function hasVisibleBox(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const styles = getComputedStyle(element);

  if (styles.display === 'none' || styles.visibility === 'hidden' || Number(styles.opacity) === 0) {
    return false;
  }

  const rect = element.getBoundingClientRect();

  return rect.width > 0 || rect.height > 0;
}

function getVisibleDescendantBounds(element: Element): ScanScopeSummary['bounds'] {
  const visibleDescendant = Array.from(element.querySelectorAll('*')).find(hasVisibleBox);

  return visibleDescendant ? getElementBounds(visibleDescendant) : undefined;
}

function getOverlayLabel(element: Element): string {
  const contentHost = findOverlayContentHost(element);

  if (contentHost) {
    return `Overlay: <${contentHost.tagName.toLowerCase()}>`;
  }

  if (element.classList.contains('cdk-overlay-container')) {
    return 'CDK overlay container';
  }

  if (element.classList.contains('cdk-overlay-pane')) {
    return 'CDK overlay pane';
  }

  if (element.classList.contains('cdk-global-overlay-wrapper')) {
    return 'CDK global overlay wrapper';
  }

  return 'CDK overlay';
}

function findOverlayContentHost(element: Element): Element | undefined {
  for (const selector of overlayContentSelectors) {
    const match = element.matches(selector) ? element : element.querySelector(selector);

    if (match) {
      return match;
    }
  }

  return Array.from(element.querySelectorAll('*')).find(descendant => descendant.tagName.includes('-'));
}
