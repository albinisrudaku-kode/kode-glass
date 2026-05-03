import type {ElementBounds, HeadingSummary, LandmarkSummary} from '../accessibility-report';

const landmarkSelectors = [
  'header',
  'nav',
  'main',
  'aside',
  'footer',
  '[role="banner"]',
  '[role="navigation"]',
  '[role="main"]',
  '[role="complementary"]',
  '[role="contentinfo"]',
  '[role="search"]',
] as const;

export function collectHeadings(root: ParentNode = document): readonly HeadingSummary[] {
  return Array.from(root.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')).map(
    heading => ({
      level: Number(heading.tagName.slice(1)),
      selector: getElementSelector(heading),
      text: heading.textContent?.trim() ?? '',
    }),
  );
}

export function collectLandmarks(root: ParentNode = document): readonly LandmarkSummary[] {
  return Array.from(root.querySelectorAll<HTMLElement>(landmarkSelectors.join(','))).map(element => ({
    bounds: getElementBounds(element),
    label: getLandmarkLabel(element),
    role: getLandmarkRole(element),
    selector: getElementSelector(element),
  }));
}

export function getElementBounds(element: Element): ElementBounds | undefined {
  const rect = element.getBoundingClientRect();

  if (rect.width === 0 && rect.height === 0) {
    return undefined;
  }

  return {
    height: Math.round(rect.height),
    width: Math.round(rect.width),
    x: Math.round(rect.left + window.scrollX),
    y: Math.round(rect.top + window.scrollY),
  };
}

export function getElementSelector(element: Element): string {
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
    parts.unshift(getSelectorPart(current));
    current = current.parentElement;
  }

  return parts.join(' > ');
}

function getLandmarkRole(element: HTMLElement): string {
  const explicitRole = element.getAttribute('role');

  if (explicitRole) {
    return explicitRole;
  }

  const tagName = element.tagName.toLowerCase();

  return (
    {
      aside: 'complementary',
      footer: 'contentinfo',
      header: 'banner',
      main: 'main',
      nav: 'navigation',
    } as const
  )[tagName] ?? 'region';
}

function getLandmarkLabel(element: HTMLElement): string {
  const ariaLabel = element.getAttribute('aria-label')?.trim();

  if (ariaLabel) {
    return ariaLabel;
  }

  const labelledBy = element.getAttribute('aria-labelledby');

  if (!labelledBy) {
    return '';
  }

  const ownerDocument = element.ownerDocument ?? document;

  return labelledBy
    .split(/\s+/)
    .map(id => ownerDocument.getElementById(id)?.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
}

function getSelectorPart(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const parent = element.parentElement;

  if (!parent) {
    return tagName;
  }

  const siblings = Array.from(parent.children).filter(child => child.tagName === element.tagName);

  if (siblings.length <= 1) {
    return tagName;
  }

  return `${tagName}:nth-of-type(${siblings.indexOf(element) + 1})`;
}