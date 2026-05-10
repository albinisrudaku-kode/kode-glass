import type {NarratorNavigationUnit} from '../shared/accessibility-report';

const unitSelectors: Record<Exclude<NarratorNavigationUnit, 'line' | 'element' | 'control'>, string> = {
  button: 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]',
  'form-field': 'input:not([type="hidden"]), select, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"], [role="switch"]',
  heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
  landmark: 'main, nav, aside, header, footer, section[aria-label], [role="main"], [role="navigation"], [role="region"], [role="banner"], [role="contentinfo"], [role="complementary"]',
  link: 'a[href], [role="link"]',
};

export interface NarratorTarget {
  readonly element: Element;
  readonly index: number;
  readonly total: number;
  readonly unit: NarratorNavigationUnit;
}

export function getNarratorTarget(
  unit: NarratorNavigationUnit,
  currentElement: Element | null,
  direction: 'next' | 'previous',
): NarratorTarget | null {
  const elements = collectNavigableElements(unit);

  if (!elements.length) {
    return null;
  }

  const currentIndex = currentElement ? elements.findIndex(element => element === currentElement) : -1;
  const nextIndex = resolveNextIndex(elements.length, currentIndex, direction);
  const element = elements[nextIndex];

  if (!element) {
    return null;
  }

  return {
    element,
    index: nextIndex + 1,
    total: elements.length,
    unit,
  };
}

export function collectNavigableElements(unit: NarratorNavigationUnit): Element[] {
  if (unit === 'element') {
    return collectVoiceOverStyleElements();
  }

  if (unit === 'line' || unit === 'control') {
    return collectDefaultNarratorElements(unit);
  }

  const selector = unitSelectors[unit];

  if (!selector) {
    return [];
  }

  return Array.from(document.querySelectorAll(selector))
    .filter(isElementNavigable);
}

function collectDefaultNarratorElements(unit: NarratorNavigationUnit): Element[] {
  const universalSelector = unit === 'control'
    ? `${unitSelectors.button}, ${unitSelectors['form-field']}, ${unitSelectors.link}, [tabindex]:not([tabindex="-1"])`
    : [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '[role]',
      '[tabindex]:not([tabindex="-1"])',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
    ].join(', ');

  return Array.from(document.querySelectorAll(universalSelector)).filter(isElementNavigable);
}

function collectVoiceOverStyleElements(): Element[] {
  return Array.from(document.querySelectorAll('body *'))
    .filter(isElementNavigable);
}

function resolveNextIndex(total: number, currentIndex: number, direction: 'next' | 'previous'): number {
  if (total <= 0) {
    return 0;
  }

  if (currentIndex < 0) {
    return direction === 'next' ? 0 : total - 1;
  }

  if (direction === 'next') {
    return (currentIndex + 1) % total;
  }

  return (currentIndex - 1 + total) % total;
}

function isElementNavigable(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.closest('kode-glass-overlay')) {
    return false;
  }

  if (element.hidden || element.inert) {
    return false;
  }

  const styles = getComputedStyle(element);

  if (styles.display === 'none' || styles.visibility === 'hidden' || Number(styles.opacity) === 0) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const tagName = element.tagName.toLowerCase();

  if (new Set(['script', 'style', 'template', 'noscript']).has(tagName)) {
    return false;
  }

  const explicitRole = element.getAttribute('role')?.trim().toLowerCase();

  if (explicitRole === 'none' || explicitRole === 'presentation') {
    return hasOwnReadableText(element);
  }

  if (element.getAttribute('aria-hidden') === 'true') {
    return false;
  }

  return (rect.width > 0 && rect.height > 0) || hasOwnReadableText(element);
}

function hasOwnReadableText(element: Element): boolean {
  return Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim().length);
}
