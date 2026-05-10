import type {ComponentScope, ComponentScopeOption, KodeGlassViolation} from '../shared/accessibility-report';
import {getElementSelector} from '../shared/engines/dom-summary';

interface AngularDebugApi {
  readonly getComponent?: (element: Element) => object | null;
  readonly getHostElement?: (component: object) => Element | null;
  readonly getOwningComponent?: (element: Element) => object | null;
}

interface AngularWindow extends Window {
  readonly ng?: AngularDebugApi;
}

const overlayComponentInventorySelector = [
  '.cdk-overlay-container',
  '.cdk-overlay-container *',
  '.cdk-global-overlay-wrapper',
  '.cdk-global-overlay-wrapper *',
  '.cdk-overlay-popover',
  '.cdk-overlay-popover *',
  '.cdk-overlay-pane',
  '.cdk-overlay-pane *',
].join(',');

export function collectDetectedComponentOptions(): readonly ComponentScopeOption[] {
  const componentMap = new Map<string, ComponentScopeOption>();
  const elements = collectComponentInventoryElements();

  for (const element of elements) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }

    const scope = resolveComponentScopeForElement(element);

    if (!scope) {
      continue;
    }

    componentMap.set(scope.tagName, {id: scope.tagName, ...scope});
  }

  return [...componentMap.values()].sort((first, second) => first.label.localeCompare(second.label));
}

function collectComponentInventoryElements(): readonly Element[] {
  const allElements = document.querySelectorAll('*');
  const maxElements = 4000;
  const upperBound = Math.min(allElements.length, maxElements);
  const elements = new Set<Element>();

  for (let index = 0; index < upperBound; index += 1) {
    const element = allElements[index];

    if (element) {
      elements.add(element);
    }
  }

  document.querySelectorAll(overlayComponentInventorySelector).forEach(element => elements.add(element));

  return [...elements];
}

export function enrichViolationsWithComponentScope(
  violations: readonly KodeGlassViolation[],
): readonly KodeGlassViolation[] {
  return violations.map(violation => ({
    ...violation,
    componentScope: resolveComponentScopeForSelector(violation.selector) ?? undefined,
  }));
}

export function resolveComponentScopeForSelector(selector: string): ComponentScope | null {
  const element = getElementBySelector(selector);

  return element ? resolveComponentScopeForElement(element) : null;
}

export function resolveComponentScopeForElement(element: Element): ComponentScope | null {
  const angularScope = resolveAngularComponentScope(element);

  if (angularScope) {
    return angularScope;
  }

  const customElement = element.closest('*');

  if (!customElement) {
    return null;
  }

  const host = findClosestCustomElement(customElement);

  if (!host) {
    return null;
  }

  const tagName = host.tagName.toLowerCase();

  return createComponentScope(host, tagName);
}

function resolveAngularComponentScope(element: Element): ComponentScope | null {
  const ng = (window as AngularWindow).ng;

  if (!ng?.getOwningComponent && !ng?.getComponent) {
    return null;
  }

  const componentInstance = ng.getOwningComponent?.(element) ?? ng.getComponent?.(element);

  if (!componentInstance) {
    return null;
  }

  const hostElement = ng.getHostElement?.(componentInstance) ?? findHostElementFallback(element, componentInstance, ng);

  if (!(hostElement instanceof HTMLElement)) {
    return null;
  }

  const tagName = getAngularComponentTagName(componentInstance, hostElement);

  return createComponentScope(hostElement, tagName);
}

function findHostElementFallback(
  sourceElement: Element,
  componentInstance: object,
  ng: AngularDebugApi,
): Element | null {
  let current: Element | null = sourceElement;
  let guard = 0;

  while (current && guard < 50) {
    if (ng.getComponent?.(current) === componentInstance) {
      return current;
    }

    current = current.parentElement;
    guard += 1;
  }

  return null;
}

function getAngularComponentTagName(componentInstance: object, hostElement: HTMLElement): string {
  const cmpSelectors = (componentInstance as {readonly constructor?: {readonly ɵcmp?: {readonly selectors?: readonly (readonly string[])[]}}})
    .constructor?.ɵcmp?.selectors;
  const firstSelector = cmpSelectors?.[0] ?? [];
  const elementSelector = firstSelector.find(token => token.length > 0 && !token.startsWith('[') && !token.startsWith('.'));

  if (elementSelector && elementSelector.includes('-')) {
    return elementSelector.toLowerCase();
  }

  return hostElement.tagName.toLowerCase();
}

function findClosestCustomElement(element: Element): HTMLElement | null {
  let current: Element | null = element;

  while (current) {
    if (current instanceof HTMLElement && current.tagName.includes('-')) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function createComponentScope(hostElement: HTMLElement, tagName: string): ComponentScope {
  return {
    label: `<${tagName}>`,
    selector: getElementSelector(hostElement),
    tagName,
  };
}

function getElementBySelector(selector: string): Element | null {
  if (!selector || selector === 'document') {
    return null;
  }

  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}
