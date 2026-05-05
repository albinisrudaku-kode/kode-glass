import {computeAccessibleDescription, computeAccessibleName, getRole} from 'dom-accessibility-api';
import type {
  AccessibilityReport,
  AccessibleNodeSummary,
  ElementBounds,
  KodeGlassViolation,
  LandmarkSummary,
  LayerVisibility,
  ReaderModeSettings,
  ViolationFilterSettings,
} from '../shared/accessibility-report';
import {RuntimeMessageType} from '../shared/messages';
import {getElementBounds, getElementSelector} from '../shared/engines/dom-summary';
import {initialViolationFilterSettings, matchesViolationFilters} from '../shared/violation-filters';
import type {ViolationSelectedPayload} from '../shared/messages';

interface FocusPathPoint {
  readonly bounds?: ElementBounds;
  readonly label: string;
  readonly order: number;
  readonly selector: string;
}

interface OverlayBoxOptions {
  readonly bounds: ElementBounds;
  readonly color: string;
  readonly dashArray?: string;
  readonly fill: string;
  readonly label: string;
  readonly violation?: KodeGlassViolation;
}

const severityColors: Record<KodeGlassViolation['severity'], string> = {
  critical: '#d9214f',
  info: '#207ff0',
  warning: '#d88400',
};

const overlayFillColors: Record<KodeGlassViolation['severity'], string> = {
  critical: 'rgba(217, 33, 79, 0.08)',
  info: 'rgba(32, 127, 240, 0.08)',
  warning: 'rgba(216, 132, 0, 0.1)',
};

const initialLayerVisibility: LayerVisibility = {
  errors: true,
  focusPath: false,
  landmarks: false,
  pageOverlay: true,
};

const initialReaderMode: ReaderModeSettings = {
  enabled: false,
  inspectWithMouse: false,
  rate: 0.92,
  speak: false,
};

export class PageOverlay {
  private readonly host = document.createElement('kode-glass-overlay');
  private readonly shadowRoot = this.host.attachShadow({mode: 'open'});
  private readonly svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private readonly activeNodeLabel = document.createElement('div');
  private focusPath: readonly FocusPathPoint[] = [];
  private focusPathOrder = 0;
  private layerVisibility: LayerVisibility = initialLayerVisibility;
  private latestReport: AccessibilityReport | null = null;
  private latestFocusedElement: Element | null = null;
  private latestMouseElement: Element | null = null;
  private latestMouseSummary: AccessibleNodeSummary | null = null;
  private latestSummary: AccessibleNodeSummary | null = null;
  private mutationObserver: MutationObserver | undefined;
  private observingMutations = false;
  private violationFilters: ViolationFilterSettings = initialViolationFilterSettings;
  private readerMode: ReaderModeSettings = initialReaderMode;
  private renderQueued = false;
  private renderListenersAttached = false;
  private focusListenerAttached = false;
  private clickSelectionAttached = false;
  private inspectListenerAttached = false;
  private lastPointerSyncAt = 0;
  private activeNodeChanged: (activeNode: AccessibleNodeSummary | null) => void = () => undefined;
  private violationSelected: (payload: ViolationSelectedPayload) => void = () => undefined;

  constructor() {
    this.mount();
    this.syncRuntimeSubscriptions();
  }

  setLayerVisibility(layerVisibility: LayerVisibility): void {
    this.layerVisibility = layerVisibility;
    this.syncRuntimeSubscriptions();
    this.queueRender();
  }

  setReport(report: AccessibilityReport): void {
    this.latestReport = report;
    this.syncRuntimeSubscriptions();
    this.queueRender();
  }

  setViolationFilters(violationFilters: ViolationFilterSettings): void {
    this.violationFilters = violationFilters;
    this.syncRuntimeSubscriptions();
    this.queueRender();
  }

  reset(): void {
    this.latestReport = null;
    this.focusPath = [];
    this.focusPathOrder = 0;
    this.layerVisibility = initialLayerVisibility;
    this.readerMode = initialReaderMode;
    this.latestFocusedElement = null;
    this.latestMouseElement = null;
    this.latestMouseSummary = null;
    this.latestSummary = null;
    this.violationFilters = initialViolationFilterSettings;
    this.stopMutationObserver();
    this.syncRuntimeSubscriptions();
    this.svg.replaceChildren();
    this.hideActiveNode();
    window.speechSynthesis?.cancel();
  }

  setReaderMode(readerMode: ReaderModeSettings): void {
    this.readerMode = readerMode;

    if (!readerMode.inspectWithMouse || readerMode.enabled) {
      this.latestMouseElement = null;
      this.latestMouseSummary = null;
    }

    if (!readerMode.enabled) {
      window.speechSynthesis?.cancel();
      this.latestFocusedElement = null;
      this.latestSummary = null;
      this.hideActiveNode();
    } else if (this.latestSummary) {
      this.showReaderSubtitle(this.latestSummary);
    } else {
      this.showReaderIdleSubtitle();
    }

    this.syncRuntimeSubscriptions();
    this.queueRender();
  }

  onActiveNodeChanged(listener: (activeNode: AccessibleNodeSummary | null) => void): void {
    this.activeNodeChanged = listener;
  }

  onViolationSelected(listener: (payload: ViolationSelectedPayload) => void): void {
    this.violationSelected = listener;
  }

  getActiveNodeSummary(element: Element): AccessibleNodeSummary {
    return {
      bounds: getElementBounds(element),
      description: getAccessibleDescription(element),
      name: getAccessibleName(element),
      role: getAccessibleRole(element),
      selector: getElementSelector(element),
      state: getAccessibleState(element),
    };
  }

  private mount(): void {
    this.host.style.all = 'initial';
    this.host.style.position = 'fixed';
    this.host.style.inset = '0';
    this.host.style.pointerEvents = 'none';
    this.host.style.zIndex = '2147483647';

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
      }

      svg {
        block-size: 100vh;
        inline-size: 100vw;
        inset: 0;
        overflow: visible;
        pointer-events: none;
        position: fixed;
      }

      .interactive-box {
        cursor: pointer;
        pointer-events: auto;
      }

      .active-node-label {
        --kg-accent: #526ed3;
        --kg-accent-hover: #4258b8;
        --kg-accent-soft: #eef2ff;
        --kg-border: #dde3ee;
        --kg-border-soft: #edf1f7;
        --kg-muted: #667085;
        --kg-surface: #ffffff;
        --kg-surface-muted: #f8fafc;
        --kg-text: #111827;

        background: #ffffff;
        border: 1px solid var(--kg-border);
        border-radius: 12px;
        box-shadow: 0 6px 24px rgba(16, 24, 40, 0.12), 0 1px 3px rgba(16, 24, 40, 0.06);
        box-sizing: border-box;
        color: var(--kg-text);
        display: none;
        font: 13px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
        max-block-size: min(400px, calc(100vh - 32px));
        max-inline-size: 380px;
        min-inline-size: 300px;
        overflow: auto;
        overscroll-behavior: contain;
        pointer-events: auto;
        position: fixed;
        scrollbar-color: rgba(100, 116, 139, 0.35) transparent;
        scrollbar-width: thin;
        text-align: start;
        user-select: text;
        z-index: 1;
      }

      .active-node-label,
      .active-node-label * {
        box-sizing: border-box;
      }

      .glass-panel {
        display: flex;
        flex-direction: column;
        min-block-size: 88px;
      }

      .panel-header {
        padding: 14px 16px 12px;
      }

      .role-label {
        color: var(--kg-accent);
        display: inline-block;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        margin-bottom: 7px;
        text-transform: uppercase;
      }

      .element-title {
        color: var(--kg-text);
        font-size: 14px;
        font-weight: 700;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      .element-description {
        color: var(--kg-muted);
        font-size: 12px;
        line-height: 1.45;
        margin-top: 5px;
        overflow-wrap: anywhere;
      }

      .panel-body {
        border-top: 1px solid var(--kg-border-soft);
        display: flex;
        flex-direction: column;
        padding: 0 16px 12px;
      }

      .state-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 10px 0 8px;
        border-bottom: 1px solid var(--kg-border-soft);
      }

      .state-tags:last-child {
        border-bottom: none;
        padding-bottom: 0;
      }

      .state-tag {
        background: var(--kg-surface-muted);
        border: 1px solid var(--kg-border-soft);
        border-radius: 5px;
        color: var(--kg-muted);
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
      }

      .data-row {
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding: 10px 0;
        border-bottom: 1px solid var(--kg-border-soft);
      }

      .data-row:last-child {
        border-bottom: none;
        padding-bottom: 2px;
      }

      .data-label {
        color: var(--kg-muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .data-value {
        color: #1d2939;
        font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
        font-size: 12px;
        line-height: 1.45;
        max-block-size: 80px;
        overflow-wrap: break-word;
        overflow-y: auto;
        scrollbar-color: rgba(100, 116, 139, 0.3) transparent;
        scrollbar-width: thin;
        word-break: break-all;
      }

      .data-value a {
        color: var(--kg-accent);
        font-weight: 600;
        text-decoration: none;
      }

      .data-value a:hover {
        text-decoration: underline;
      }

      .active-node-label.reader-subtitle {
        border-radius: 14px;
        box-shadow: 0 12px 40px rgba(16, 24, 40, 0.16), 0 1px 4px rgba(16, 24, 40, 0.06);
        display: block;
        inset-block: auto 28px;
        inset-inline: 50% auto;
        max-block-size: min(50vh, 480px);
        max-inline-size: min(680px, calc(100vw - 32px));
        min-inline-size: min(480px, calc(100vw - 32px));
        transform: translateX(-50%);
      }

      .active-node-label.reader-subtitle .panel-header {
        padding: 18px 22px 16px;
      }

      .active-node-label.reader-subtitle .element-title {
        font-size: 18px;
        font-weight: 800;
      }

      .active-node-label.reader-subtitle .panel-body {
        padding: 0 22px 18px;
      }

      .active-node-label.inspect-popover {
        animation: kg-popover-in 140ms cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes kg-popover-in {
        from {
          opacity: 0;
          transform: translateY(6px) scale(0.975);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
    `;

    this.svg.setAttribute('aria-hidden', 'true');
    this.activeNodeLabel.className = 'active-node-label';
    this.activeNodeLabel.setAttribute('role', 'status');
    this.activeNodeLabel.setAttribute('aria-live', 'polite');
    this.activeNodeLabel.setAttribute('aria-label', 'Accessibility preview');
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchend'].forEach(eventName => {
      this.activeNodeLabel.addEventListener(eventName, event => event.stopPropagation(), true);
    });
    this.shadowRoot.append(style, this.svg, this.activeNodeLabel);
    document.documentElement.append(this.host);
  }

  private syncRuntimeSubscriptions(): void {
    this.toggleRenderListeners(this.needsRenderListeners());
    this.toggleFocusListener(this.needsFocusTracking());
    this.toggleClickSelectionListener(this.needsClickSelection());
    this.toggleInspectListener(this.needsInspectTracking());
    this.toggleMutationObserver(this.needsMutationObserver());
  }

  private toggleRenderListeners(shouldAttach: boolean): void {
    if (this.renderListenersAttached === shouldAttach) {
      return;
    }

    if (shouldAttach) {
      window.addEventListener('scroll', this.queueRender, {passive: true});
      window.addEventListener('resize', this.queueRender);
    } else {
      window.removeEventListener('scroll', this.queueRender);
      window.removeEventListener('resize', this.queueRender);
    }

    this.renderListenersAttached = shouldAttach;
  }

  private toggleFocusListener(shouldAttach: boolean): void {
    if (this.focusListenerAttached === shouldAttach) {
      return;
    }

    if (shouldAttach) {
      document.addEventListener('focusin', this.captureFocus, true);
    } else {
      document.removeEventListener('focusin', this.captureFocus, true);
    }

    this.focusListenerAttached = shouldAttach;
  }

  private toggleClickSelectionListener(shouldAttach: boolean): void {
    if (this.clickSelectionAttached === shouldAttach) {
      return;
    }

    if (shouldAttach) {
      document.addEventListener('click', this.selectViolationFromPointer, true);
    } else {
      document.removeEventListener('click', this.selectViolationFromPointer, true);
    }

    this.clickSelectionAttached = shouldAttach;
  }

  private toggleInspectListener(shouldAttach: boolean): void {
    if (this.inspectListenerAttached === shouldAttach) {
      return;
    }

    if (shouldAttach) {
      document.addEventListener('mousemove', this.showActiveNode, true);
    } else {
      document.removeEventListener('mousemove', this.showActiveNode, true);
      this.latestMouseElement = null;
      this.latestMouseSummary = null;
    }

    this.inspectListenerAttached = shouldAttach;
  }

  private toggleMutationObserver(shouldObserve: boolean): void {
    if (shouldObserve) {
      this.startMutationObserver();

      return;
    }

    this.stopMutationObserver();
  }

  private startMutationObserver(): void {
    if (this.observingMutations) {
      return;
    }

    if (!this.mutationObserver) {
      this.mutationObserver = new MutationObserver(this.queueRender);
    }

    this.mutationObserver.observe(document.documentElement, {attributes: true, childList: true, subtree: true});
    this.observingMutations = true;
  }

  private stopMutationObserver(): void {
    if (!this.observingMutations) {
      return;
    }

    this.mutationObserver?.disconnect();
    this.observingMutations = false;
  }

  private needsRenderListeners(): boolean {
    return this.shouldRenderFrame();
  }

  private needsMutationObserver(): boolean {
    return this.latestReport !== null && this.shouldRenderFrame();
  }

  private needsFocusTracking(): boolean {
    return this.readerMode.enabled || this.layerVisibility.focusPath;
  }

  private needsClickSelection(): boolean {
    return this.latestReport !== null && this.layerVisibility.pageOverlay && this.layerVisibility.errors;
  }

  private needsInspectTracking(): boolean {
    return this.readerMode.inspectWithMouse && !this.readerMode.enabled;
  }

  private shouldRenderFrame(): boolean {
    const hasOverlayLayers = this.latestReport !== null
      && this.layerVisibility.pageOverlay
      && (this.layerVisibility.errors || this.layerVisibility.landmarks || this.layerVisibility.focusPath);
    const hasReaderHighlight = this.readerMode.enabled && this.latestSummary?.bounds !== undefined;
    const hasInspectHighlight = this.readerMode.inspectWithMouse && !this.readerMode.enabled && this.latestMouseSummary?.bounds !== undefined;

    return hasOverlayLayers || hasReaderHighlight || hasInspectHighlight;
  }

  private readonly queueRender = (): void => {
    if (!this.shouldRenderFrame() && this.svg.childElementCount === 0) {
      return;
    }

    if (this.renderQueued) {
      return;
    }

    this.renderQueued = true;

    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  };

  private render(): void {
    this.svg.replaceChildren();

    if (this.latestReport && this.layerVisibility.pageOverlay && this.layerVisibility.landmarks) {
      this.latestReport.landmarks.forEach((landmark, index) => this.renderLandmark(landmark, index));
    }

    if (this.latestReport && this.layerVisibility.pageOverlay && this.layerVisibility.errors) {
      this.getVisibleViolations().forEach((violation, index) => this.renderViolation(violation, index));
    }

    if (this.latestReport && this.layerVisibility.pageOverlay && this.layerVisibility.focusPath) {
      this.renderFocusPath();
    }

    if (this.readerMode.enabled && this.latestSummary?.bounds) {
      this.renderFocusedElement(this.latestSummary);
    }

    if (this.readerMode.inspectWithMouse && !this.readerMode.enabled && this.latestMouseSummary?.bounds) {
      this.renderInspectedElement(this.latestMouseSummary);
    }
  }

  private renderViolation(violation: KodeGlassViolation, index: number): void {
    const bounds = this.getCurrentViolationBounds(violation);

    if (!bounds) {
      return;
    }

    this.renderBox({
      bounds,
      color: severityColors[violation.severity],
      fill: overlayFillColors[violation.severity],
      label: `#${index + 1}`,
      violation,
    });
  }

  private renderLandmark(landmark: LandmarkSummary, index: number): void {
    if (!landmark.bounds) {
      return;
    }

    const label = landmark.label ? `${landmark.role}: ${landmark.label}` : landmark.role;
    this.renderBox({
      bounds: landmark.bounds,
      color: '#008f7a',
      dashArray: '6 4',
      fill: 'rgba(0, 143, 122, 0.07)',
      label: `${index + 1}. ${truncateLabel(label)}`,
    });
  }

  private renderBox(options: OverlayBoxOptions): void {
    const {bounds, color, dashArray = '', fill, label, violation} = options;
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
    rect.setAttribute('stroke-width', '2');
    rect.setAttribute('rx', '4');

    if (dashArray) {
      rect.setAttribute('stroke-dasharray', dashArray);
    }

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.append(rect, this.createBadge(label, color, x, y, height));

    if (violation) {
      group.classList.add('interactive-box');
      group.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this.violationSelected({selector: violation.selector, violationId: violation.id});
      });
    }

    this.svg.append(group);
  }

  private createBadge(label: string, color: string, x: number, y: number, height: number): SVGGElement {
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

  private renderFocusPath(): void {
    const visiblePoints = this.focusPath.filter(point => point.bounds);

    visiblePoints.forEach((point, index) => {
      const bounds = point.bounds;

      if (!bounds) {
        return;
      }

      const centerX = bounds.x - window.scrollX + bounds.width / 2;
      const centerY = bounds.y - window.scrollY + bounds.height / 2;
      const previousBounds = visiblePoints[index - 1]?.bounds;

      if (previousBounds) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(previousBounds.x - window.scrollX + previousBounds.width / 2));
        line.setAttribute('y1', String(previousBounds.y - window.scrollY + previousBounds.height / 2));
        line.setAttribute('x2', String(centerX));
        line.setAttribute('y2', String(centerY));
        line.setAttribute('stroke', '#4f46e5');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-dasharray', '4 4');
        this.svg.append(line);
      }

      const label = String(point.order);
      const radius = Math.max(10, label.length * 4 + 7);
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(centerX));
      circle.setAttribute('cy', String(centerY));
      circle.setAttribute('r', String(radius));
      circle.setAttribute('fill', '#4f46e5');

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.textContent = label;
      text.setAttribute('x', String(centerX));
      text.setAttribute('y', String(centerY + 4));
      text.setAttribute('fill', '#ffffff');
      text.setAttribute('font-family', 'Arial, sans-serif');
      text.setAttribute('font-size', '11');
      text.setAttribute('font-weight', '700');
      text.setAttribute('text-anchor', 'middle');

      this.svg.append(circle, text);
    });
  }

  private renderFocusedElement(summary: AccessibleNodeSummary): void {
    const bounds = summary.bounds;

    if (!bounds) {
      return;
    }

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

    this.svg.append(halo, this.createBadge('Focus', '#526ed3', x, y, height));
  }

  private renderInspectedElement(summary: AccessibleNodeSummary): void {
    const bounds = summary.bounds;

    if (!bounds) {
      return;
    }

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

    this.svg.append(halo, this.createBadge('Inspect', '#526ed3', x, y, height));
  }

  private readonly captureFocus = (event: FocusEvent): void => {
    if (!(event.target instanceof Element)) {
      return;
    }

    this.latestFocusedElement = event.target;

    const summary = this.getActiveNodeSummary(event.target);
    this.latestSummary = summary;
    this.focusPathOrder += 1;
    this.focusPath = [...this.focusPath.filter(point => point.selector !== summary.selector), {
      bounds: summary.bounds,
      label: summary.name || summary.role,
      order: this.focusPathOrder,
      selector: summary.selector,
    }];
    this.showReaderSubtitle(summary);
    this.queueRender();
  };

  private readonly selectViolationFromPointer = (event: MouseEvent): void => {
    if (this.isOverlayEvent(event)) {
      return;
    }

    const violation = this.getViolationAtPoint(event.clientX + window.scrollX, event.clientY + window.scrollY);

    if (!violation) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.violationSelected({selector: violation.selector, violationId: violation.id});
  };

  private readonly showActiveNode = (event: MouseEvent): void => {
    if (!this.readerMode.inspectWithMouse || this.readerMode.enabled || !(event.target instanceof Element) || this.isOverlayEvent(event)) {
      return;
    }

    const now = performance.now();

    if (now - this.lastPointerSyncAt < 16) {
      return;
    }

    this.lastPointerSyncAt = now;

    if (event.target === this.latestMouseElement) {
      this.positionInspectPopover(event);

      return;
    }

    this.latestMouseElement = event.target;

    const summary = this.getActiveNodeSummary(event.target);
    this.latestMouseSummary = summary;
    this.renderPreview(summary, false);
    this.activeNodeLabel.classList.add('inspect-popover');
    this.activeNodeLabel.classList.remove('reader-subtitle');
    this.activeNodeLabel.style.display = 'block';
    this.positionInspectPopover(event);
    this.activeNodeChanged(summary);
    this.queueRender();
  };

  private readonly hideActiveNode = (): void => {
    this.activeNodeLabel.style.display = 'none';
    this.activeNodeLabel.classList.remove('inspect-popover');
    this.activeNodeLabel.classList.remove('reader-subtitle');
    this.activeNodeChanged(null);
  };

  private showReaderSubtitle(summary: AccessibleNodeSummary): void {
    if (!this.readerMode.enabled) {
      this.activeNodeChanged(summary);

      return;
    }

    const text = getSpokenSummary(summary);

    this.renderPreview(summary, true);
    this.activeNodeLabel.classList.remove('inspect-popover');
    this.activeNodeLabel.classList.add('reader-subtitle');
    this.activeNodeLabel.style.display = 'block';
    this.activeNodeLabel.style.left = '';
    this.activeNodeLabel.style.top = '';
    this.activeNodeChanged(summary);

    if (this.readerMode.speak) {
      requestReaderSpeak(text, this.readerMode);
    }
  }

  private showReaderIdleSubtitle(): void {
    this.renderIdlePreview();
    this.activeNodeLabel.classList.remove('inspect-popover');
    this.activeNodeLabel.classList.add('reader-subtitle');
    this.activeNodeLabel.style.display = 'block';
    this.activeNodeLabel.style.left = '';
    this.activeNodeLabel.style.top = '';
  }

  private renderPreview(summary: AccessibleNodeSummary, includeSelector: boolean): void {
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

    if (previewDetails.states.length || previewDetails.destination || includeSelector) {
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
        body.append(this.createPreviewRow('Destination', previewDetails.destination));
      }

      if (includeSelector) {
        body.append(this.createPreviewRow('Selector', summary.selector));
      }

      shell.append(body);
    }

    this.activeNodeLabel.replaceChildren(shell);
  }

  private renderIdlePreview(): void {
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

    this.activeNodeLabel.replaceChildren(shell);
  }

  private createPreviewRow(label: string, value: string): HTMLElement {
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

  private positionInspectPopover(event: MouseEvent): void {
    const padding = 12;
    const gap = 14;
    const rect = this.activeNodeLabel.getBoundingClientRect();
    const availableRight = window.innerWidth - event.clientX;
    const left = availableRight > rect.width + gap + padding
      ? event.clientX + gap
      : event.clientX - rect.width - gap;
    const top = event.clientY + rect.height + gap + padding < window.innerHeight
      ? event.clientY + gap
      : event.clientY - rect.height - gap;

    this.activeNodeLabel.style.left = `${Math.max(padding, Math.min(left, window.innerWidth - rect.width - padding))}px`;
    this.activeNodeLabel.style.top = `${Math.max(padding, Math.min(top, window.innerHeight - rect.height - padding))}px`;
  }

  private isOverlayEvent(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }

  private getViolationAtPoint(x: number, y: number): KodeGlassViolation | null {
    if (!this.latestReport || !this.layerVisibility.pageOverlay || !this.layerVisibility.errors) {
      return null;
    }

    return this.getVisibleViolations().find(violation => {
      const bounds = this.getCurrentViolationBounds(violation);

      return Boolean(bounds && x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height);
    }) ?? null;
  }

  private getCurrentViolationBounds(violation: KodeGlassViolation): ElementBounds | undefined {
    const element = getElementBySelector(violation.selector);

    return element ? getElementBounds(element) : violation.bounds;
  }

  private getVisibleViolations(): readonly KodeGlassViolation[] {
    return this.latestReport?.violations.filter(violation => matchesViolationFilters(violation, this.violationFilters)) ?? [];
  }

}

function getSpokenSummary(summary: AccessibleNodeSummary): string {
  const title = summary.name || 'Unnamed element';
  const description = summary.description ? `. ${summary.description}` : '';
  const previewDetails = getPreviewDetails(summary.state);
  const state = previewDetails.states.length ? `. ${previewDetails.states.join('. ')}` : '';
  const destination = previewDetails.destination ? `. Destination: ${previewDetails.destination}` : '';

  return `${title}. ${summary.role}${description}${state}${destination}`;
}

function getPreviewDetails(states: readonly string[]): {readonly destination?: string; readonly states: readonly string[]} {
  const destinationPrefix = 'destination: ';
  const destination = states.find(state => state.toLowerCase().startsWith(destinationPrefix))?.slice(destinationPrefix.length).trim();

  return {
    destination,
    states: states.filter(state => !state.toLowerCase().startsWith(destinationPrefix)),
  };
}

function requestReaderSpeak(text: string, readerMode: ReaderModeSettings): void {
  if (!chrome.runtime?.id) {
    return;
  }

  void chrome.runtime.sendMessage({
    payload: {readerMode, text},
    type: RuntimeMessageType.ReaderSpeakRequested,
  });
}

function truncateLabel(label: string): string {
  return label.length > 22 ? `${label.slice(0, 19).trim()}...` : label;
}

function getAccessibleName(element: Element): string {
  return computeAccessibleName(element).replace(/\s+/g, ' ').trim().slice(0, 120);
}

function getAccessibleDescription(element: Element): string {
  return computeAccessibleDescription(element).replace(/\s+/g, ' ').trim();
}

function getAccessibleRole(element: Element): string {
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

function getAccessibleState(element: Element): readonly string[] {
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

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const value = element instanceof HTMLSelectElement ? element.selectedOptions[0]?.textContent?.trim() : element.value;

    if (value) {
      states.push(`value: ${value}`);
    }
  }

  if (element instanceof HTMLAnchorElement && element.href) {
    states.push(`destination: ${element.href}`);
  }

  return states;
}

function getStructuralStates(element: Element): readonly string[] {
  const tagName = element.tagName.toLowerCase();
  const level = /^h[1-6]$/.test(tagName) ? tagName.slice(1) : element.getAttribute('aria-level');

  return level ? [`level: ${level}`] : [];
}

function isUrlLike(value: string): boolean {
  return /^https?:\/\//i.test(value);
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