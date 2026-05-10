import {computeAccessibleDescription, computeAccessibleName, getRole} from 'dom-accessibility-api';
import type {
  AccessibleNodeSummary,
  ElementBounds,
  KodeGlassViolation,
} from '../shared/accessibility-report';
import {getReadableViolationGuidance, getReadableViolationSummary} from '../shared/text/violation-copy';
import {isUrlLike} from './overlay-geometry';

export interface ViolationRenderTarget {
  readonly bounds: ElementBounds;
  readonly element: Element;
}

export interface OverlayBoxOptions {
  readonly bounds: ElementBounds;
  readonly color: string;
  readonly dashArray?: string;
  readonly fill: string;
  readonly label: string;
  readonly selected?: boolean;
}

export const severityColors: Record<KodeGlassViolation['severity'], string> = {
  critical: '#d9214f',
  info: '#207ff0',
  warning: '#d88400',
};

export const overlayFillColors: Record<KodeGlassViolation['severity'], string> = {
  critical: 'rgba(217, 33, 79, 0.08)',
  info: 'rgba(32, 127, 240, 0.08)',
  warning: 'rgba(216, 132, 0, 0.1)',
};

export function truncateLabel(label: string): string {
  return label.length > 22 ? `${label.slice(0, 19).trim()}...` : label;
}

export function formatCoverageCriteriaLabel(criteria: readonly string[]): string {
  const visibleCriteria = criteria.slice(0, 2).join(', ');
  const suffix = criteria.length > 2 ? ` +${criteria.length - 2}` : '';

  return `WCAG ${visibleCriteria}${suffix}`;
}

export function getViolationSummary(violation: KodeGlassViolation): string {
  return getReadableViolationSummary(violation);
}

export function getViolationFixText(violation: KodeGlassViolation): string {
  const guidance = getReadableViolationGuidance(normalizeOverlayText(violation.guidance ?? ''));

  if (guidance) {
    return guidance;
  }

  if (violation.ruleId === 'button-name') {
    return 'Add visible button text, aria-label, aria-labelledby, or another valid accessible-name source.';
  }

  if (violation.ruleId === 'link-name') {
    return 'Give the link meaningful visible text, aria-label, or aria-labelledby text that describes its destination or action.';
  }

  if (violation.ruleId === 'color-contrast') {
    return 'Increase the contrast between foreground and background colors until the text meets the required WCAG contrast ratio.';
  }

  if (violation.ruleId === 'image-alt') {
    return 'Add an alt attribute that describes the image purpose, or use alt="" only when the image is decorative.';
  }

  if (violation.ruleId === 'target-size') {
    return 'Increase the clickable area or spacing so the target meets the required minimum size.';
  }

  return 'Review the failed rule, inspect this exact element, and update the markup, ARIA, text, focus behavior, or styling required by the rule.';
}

export function normalizeOverlayText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function formatViolationEngines(engines: readonly KodeGlassViolation['engine'][]): string {
  return [...new Set(engines)].join(', ');
}

export function getAccessibleName(element: Element): string {
  return computeAccessibleName(element).replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function getAccessibleDescription(element: Element): string {
  return computeAccessibleDescription(element).replace(/\s+/g, ' ').trim();
}

export function getAccessibleRole(element: Element): string {
  const computedRole = getRole(element);

  if (computedRole) {
    return computedRole;
  }

  const tagName = element.tagName.toLowerCase();

  return ({
    a: element.hasAttribute('href') ? 'link' : 'generic',
    article: 'article',
    aside: 'complementary',
    button: 'button',
    footer: 'contentinfo',
    form: 'form',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    h4: 'heading',
    h5: 'heading',
    h6: 'heading',
    header: 'banner',
    img: 'img',
    input: getInputRole(element),
    main: 'main',
    nav: 'navigation',
    select: 'combobox',
    textarea: 'textbox',
  } as Record<string, string>)[tagName] ?? 'generic';
}

function getInputRole(element: Element): string {
  const type = element.getAttribute('type') ?? 'text';

  return ({
    button: 'button',
    checkbox: 'checkbox',
    radio: 'radio',
    range: 'slider',
    search: 'searchbox',
    submit: 'button',
  } as Record<string, string>)[type] ?? 'textbox';
}

export function getAccessibleState(element: Element): readonly string[] {
  return [
    ...getAttributeStates(element),
    ...getNativeStates(element),
    ...getStructuralStates(element),
  ];
}

function getAttributeStates(element: Element): readonly string[] {
  const states: string[] = [];
  const expanded = element.getAttribute('aria-expanded');
  const pressed = element.getAttribute('aria-pressed');
  const selected = element.getAttribute('aria-selected');
  const checked = element.getAttribute('aria-checked');
  const current = element.getAttribute('aria-current');
  const invalid = element.getAttribute('aria-invalid');

  if (expanded === 'true') {
    states.push('Expanded');
  } else if (expanded === 'false') {
    states.push('Collapsed');
  }

  if (pressed === 'true') {
    states.push('Pressed');
  } else if (pressed === 'mixed') {
    states.push('Partially pressed');
  }

  if (selected === 'true') {
    states.push('Selected');
  }

  if (checked === 'true') {
    states.push('Checked');
  } else if (checked === 'false') {
    states.push('Unchecked');
  } else if (checked === 'mixed') {
    states.push('Partially checked');
  }

  if (current && current !== 'false') {
    states.push(current === 'true' ? 'Current' : `Current ${current}`);
  }

  if (invalid === 'true') {
    states.push('Invalid');
  }

  return states;
}

function getNativeStates(element: Element): readonly string[] {
  const states: string[] = [];

  if (element.hasAttribute('disabled')) {
    states.push('disabled');
  }

  if (element.hasAttribute('required') || element.getAttribute('aria-required') === 'true') {
    states.push('required');
  }

  if (element instanceof HTMLInputElement) {
    const inputType = (element.type || 'text').toLowerCase();
    const hasSwitchRole = element.getAttribute('role')?.toLowerCase() === 'switch';

    if (inputType === 'checkbox' || hasSwitchRole) {
      states.push(element.checked ? 'Checked' : 'Unchecked');
    } else if (inputType === 'radio') {
      states.push(element.checked ? 'Checked' : 'Unchecked');
    }
  }

  if (element instanceof HTMLSelectElement) {
    const value = element.selectedOptions[0]?.textContent?.trim();

    if (value) {
      states.push(`value: ${value}`);
    }
  } else if (element instanceof HTMLTextAreaElement) {
    if (element.value) {
      states.push(`value: ${element.value}`);
    }
  } else if (element instanceof HTMLInputElement && shouldExposeInputValue(element)) {
    if (element.value) {
      states.push(`value: ${element.value}`);
    }
  }

  if (element instanceof HTMLAnchorElement && element.href) {
    states.push(`destination: ${element.href}`);
  }

  return states;
}

function shouldExposeInputValue(element: HTMLInputElement): boolean {
  const inputType = (element.type || 'text').toLowerCase();
  const hasSwitchRole = element.getAttribute('role')?.toLowerCase() === 'switch';

  if (hasSwitchRole) {
    return false;
  }

  return !new Set(['button', 'checkbox', 'file', 'hidden', 'image', 'radio', 'reset', 'submit']).has(inputType);
}

function getStructuralStates(element: Element): readonly string[] {
  const tagName = element.tagName.toLowerCase();
  const level = /^h[1-6]$/.test(tagName) ? tagName.slice(1) : element.getAttribute('aria-level');

  return level ? [`level: ${level}`] : [];
}

export function getPreviewDetails(states: readonly string[]): {readonly destination?: string; readonly states: readonly string[]} {
  const destinationPrefix = 'destination: ';
  const destination = states.find(state => state.toLowerCase().startsWith(destinationPrefix))?.slice(destinationPrefix.length).trim();

  return {
    destination,
    states: states.filter(state => !state.toLowerCase().startsWith(destinationPrefix)),
  };
}

export function createPreviewRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'data-row';

  const rowLabel = document.createElement('div');
  rowLabel.className = 'data-label';
  rowLabel.textContent = label;

  const rowValue = document.createElement('div');
  rowValue.className = 'data-value';

  if (label === 'Destination' && isUrlLike(value)) {
    const link = document.createElement('a');
    link.href = value;
    link.rel = 'noreferrer noopener';
    link.target = '_blank';
    link.textContent = value;
    rowValue.append(link);
  } else {
    rowValue.textContent = value;
  }

  row.append(rowLabel, rowValue);

  return row;
}

export function buildPreviewShell(summary: AccessibleNodeSummary, includeSelector: boolean): HTMLElement {
  const previewDetails = getPreviewDetails(summary.state);
  const shell = document.createElement('div');
  shell.className = 'glass-panel';

  const header = document.createElement('div');
  header.className = 'panel-header';

  const roleLabel = document.createElement('div');
  roleLabel.className = 'role-label';
  roleLabel.textContent = summary.role || 'element';

  const title = document.createElement('div');
  title.className = 'element-title';
  title.textContent = summary.name || 'Unnamed element';

  header.append(roleLabel, title);

  if (summary.description) {
    const description = document.createElement('div');
    description.className = 'element-description';
    description.textContent = summary.description;
    header.append(description);
  }

  shell.append(header);

  const body = document.createElement('div');
  body.className = 'panel-body';

  if (previewDetails.states.length) {
    const stateTags = document.createElement('div');
    stateTags.className = 'state-tags';

    previewDetails.states.slice(0, 6).forEach(state => {
      const tag = document.createElement('span');
      tag.className = 'state-tag';
      tag.textContent = state;
      stateTags.append(tag);
    });

    body.append(stateTags);
  }

  if (previewDetails.destination) {
    body.append(createPreviewRow('Destination', previewDetails.destination));
  }

  if (includeSelector) {
    body.append(createPreviewRow('Selector', summary.selector));
  }

  body.append(createPreviewRow('Component', summary.componentScope?.label ?? 'Unknown component'));

  shell.append(body);

  return shell;
}

export function buildIdlePreviewShell(): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'glass-panel';

  const header = document.createElement('div');
  header.className = 'panel-header';

  const roleLabel = document.createElement('div');
  roleLabel.className = 'role-label';
  roleLabel.textContent = 'idle';

  const title = document.createElement('div');
  title.className = 'element-title';
  title.textContent = 'No focused element';

  header.append(roleLabel, title);
  shell.append(header);

  return shell;
}

export function renderBox(
  svg: SVGSVGElement,
  options: OverlayBoxOptions,
): void {
  const {bounds, color, dashArray = '', fill, label, selected = false} = options;
  const x = bounds.x - window.scrollX;
  const y = bounds.y - window.scrollY;
  const width = bounds.width;
  const height = bounds.height;

  if (x + width < 0 || y + height < 0 || x > window.innerWidth || y > window.innerHeight) {
    return;
  }

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(width));
  rect.setAttribute('height', String(height));
  rect.setAttribute('fill', fill);
  rect.setAttribute('stroke', color);
  rect.setAttribute('stroke-width', selected ? '4' : '2');
  rect.setAttribute('rx', '4');

  if (dashArray) {
    rect.setAttribute('stroke-dasharray', dashArray);
  }

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.append(rect, createBadge(label, color, x, y, height));

  svg.append(group);
}

export function createBadge(label: string, color: string, x: number, y: number, height: number): SVGGElement {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  const labelBackground = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  const labelHeight = 18;
  const labelGap = 4;
  const labelWidth = Math.max(28, Math.min(128, label.length * 7 + 12));
  const labelX = Math.max(8, Math.min(x, window.innerWidth - labelWidth - 8));
  const preferredLabelY = y - labelHeight - labelGap;
  const fallbackLabelY = y + height + labelGap;
  const labelY = preferredLabelY >= 8
    ? preferredLabelY
    : Math.max(8, Math.min(fallbackLabelY, window.innerHeight - labelHeight - 8));

  labelText.textContent = label;
  labelText.setAttribute('x', String(labelX + 6));
  labelText.setAttribute('y', String(labelY + 13));
  labelText.setAttribute('fill', '#ffffff');
  labelText.setAttribute('font-family', 'Arial, sans-serif');
  labelText.setAttribute('font-size', '11');
  labelText.setAttribute('font-weight', '700');

  labelBackground.setAttribute('x', String(labelX));
  labelBackground.setAttribute('y', String(labelY));
  labelBackground.setAttribute('width', String(labelWidth));
  labelBackground.setAttribute('height', String(labelHeight));
  labelBackground.setAttribute('rx', '9');
  labelBackground.setAttribute('fill', color);

  group.append(labelBackground, labelText);

  return group;
}

export function renderFocusedViolationHalo(
  svg: SVGSVGElement,
  bounds: ElementBounds,
): void {
  const x = bounds.x - window.scrollX;
  const y = bounds.y - window.scrollY;
  const width = bounds.width;
  const height = bounds.height;
  const halo = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  halo.setAttribute('x', String(Math.max(2, x - 8)));
  halo.setAttribute('y', String(Math.max(2, y - 8)));
  halo.setAttribute('width', String(width + 16));
  halo.setAttribute('height', String(height + 16));
  halo.setAttribute('rx', '10');
  halo.setAttribute('fill', 'rgba(251, 191, 36, 0.08)');
  halo.setAttribute('stroke', '#f59e0b');
  halo.setAttribute('stroke-width', '3');
  halo.setAttribute('stroke-dasharray', '8 6');
  halo.setAttribute('filter', 'drop-shadow(0 10px 20px rgb(245 158 11 / 35%))');
  halo.setAttribute('pointer-events', 'none');
  svg.append(halo);
}

export function renderSelectionBackdrop(
  svg: SVGSVGElement,
): void {
  const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  backdrop.setAttribute('x', '0');
  backdrop.setAttribute('y', '0');
  backdrop.setAttribute('width', String(window.innerWidth));
  backdrop.setAttribute('height', String(window.innerHeight));
  backdrop.setAttribute('fill', 'rgba(15, 23, 42, 0.18)');
  backdrop.setAttribute('pointer-events', 'none');
  svg.append(backdrop);
}

export function renderFocusedElementHalo(
  svg: SVGSVGElement,
  bounds: ElementBounds,
): void {
  const x = bounds.x - window.scrollX;
  const y = bounds.y - window.scrollY;
  const width = bounds.width;
  const height = bounds.height;

  if (x + width < 0 || y + height < 0 || x > window.innerWidth || y > window.innerHeight) {
    return;
  }

  const halo = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  halo.setAttribute('x', String(Math.max(4, x - 6)));
  halo.setAttribute('y', String(Math.max(4, y - 6)));
  halo.setAttribute('width', String(width + 12));
  halo.setAttribute('height', String(height + 12));
  halo.setAttribute('fill', 'rgba(82, 110, 211, 0.12)');
  halo.setAttribute('stroke', '#526ed3');
  halo.setAttribute('stroke-width', '3');
  halo.setAttribute('rx', '8');
  halo.setAttribute('filter', 'drop-shadow(0 8px 18px rgb(82 110 211 / 26%))');

  svg.append(halo);
}

export function renderInspectedElementHalo(
  svg: SVGSVGElement,
  bounds: ElementBounds,
): void {
  const x = bounds.x - window.scrollX;
  const y = bounds.y - window.scrollY;
  const width = bounds.width;
  const height = bounds.height;

  if (x + width < 0 || y + height < 0 || x > window.innerWidth || y > window.innerHeight) {
    return;
  }

  const halo = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  halo.setAttribute('x', String(Math.max(4, x - 5)));
  halo.setAttribute('y', String(Math.max(4, y - 5)));
  halo.setAttribute('width', String(width + 10));
  halo.setAttribute('height', String(height + 10));
  halo.setAttribute('fill', 'rgba(82, 110, 211, 0.08)');
  halo.setAttribute('stroke', '#526ed3');
  halo.setAttribute('stroke-width', '2');
  halo.setAttribute('stroke-dasharray', '7 5');
  halo.setAttribute('rx', '8');
  halo.setAttribute('filter', 'drop-shadow(0 8px 18px rgb(82 110 211 / 22%))');

  svg.append(halo);
}
