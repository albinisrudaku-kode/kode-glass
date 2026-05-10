import type {ElementBounds} from '../shared/accessibility-report';
import {getElementBounds} from '../shared/engines/dom-summary';

export function getElementBySelector(selector: string): Element | null {
  if (!selector || selector === 'document') {
    return null;
  }

  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

export function getActiveModalElement(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'))
    .filter(element => !element.closest('kode-glass-overlay') && isElementVisibleForOverlay(element));

  return candidates.at(-1) ?? null;
}

export function isElementVisibleForOverlay(element: Element): boolean {
  if (element.closest('kode-glass-overlay')) {
    return false;
  }

  const bounds = getElementBounds(element);

  if (!bounds) {
    return false;
  }

  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    if (current instanceof HTMLElement) {
      if (current.hidden || current.inert) {
        return false;
      }

      const styles = getComputedStyle(current);

      if (styles.display === 'none' || styles.visibility === 'hidden' || Number(styles.opacity) === 0) {
        return false;
      }
    }

    current = current.parentElement;
  }

  return true;
}

export function isUrlLike(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function positionInspectPopover(
  nodeLabel: HTMLElement,
  event: MouseEvent,
): void {
  const padding = 12;
  const gap = 14;
  const rect = nodeLabel.getBoundingClientRect();
  const availableRight = window.innerWidth - event.clientX;
  const left = availableRight > rect.width + gap + padding
    ? event.clientX + gap
    : event.clientX - rect.width - gap;
  const top = event.clientY + rect.height + gap + padding < window.innerHeight
    ? event.clientY + gap
    : event.clientY - rect.height - gap;

  nodeLabel.style.left = `${Math.max(padding, Math.min(left, window.innerWidth - rect.width - padding))}px`;
  nodeLabel.style.top = `${Math.max(padding, Math.min(top, window.innerHeight - rect.height - padding))}px`;
}

export function positionViolationDetail(
  nodeLabel: HTMLElement,
  bounds: ElementBounds,
): void {
  const padding = 12;
  const gap = 14;
  const rect = nodeLabel.getBoundingClientRect();
  const viewportX = bounds.x - window.scrollX;
  const viewportY = bounds.y - window.scrollY;
  const rightSpace = window.innerWidth - (viewportX + bounds.width);
  const leftSpace = viewportX;
  const topSpace = viewportY;
  const bottomSpace = window.innerHeight - (viewportY + bounds.height);

  const left = rightSpace >= rect.width + gap + padding || rightSpace >= leftSpace
    ? viewportX + bounds.width + gap
    : viewportX - rect.width - gap;
  const top = bottomSpace >= rect.height + gap + padding || bottomSpace >= topSpace
    ? viewportY
    : viewportY + bounds.height - rect.height;

  nodeLabel.style.left = `${Math.max(padding, Math.min(left, window.innerWidth - rect.width - padding))}px`;
  nodeLabel.style.top = `${Math.max(padding, Math.min(top, window.innerHeight - rect.height - padding))}px`;
}

export function isOverlayEvent(host: HTMLElement, event: Event): boolean {
  return event.composedPath().includes(host);
}
