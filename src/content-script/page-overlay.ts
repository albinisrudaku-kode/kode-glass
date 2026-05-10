import type {
  AccessibilityReport,
  AccessibleNodeSummary,
  CaptureBoundsSnapshot,
  ComponentScope,
  ElementBounds,
  EvidenceCaptureMode,
  KodeGlassViolation,
  LandmarkSummary,
  LayerVisibility,
  NarratorCommand,
  ReaderModeSettings,
  ViolationFilterSettings,
} from '../shared/accessibility-report';
import {RuntimeMessageType} from '../shared/messages';
import {getElementBounds, getElementSelector} from '../shared/engines/dom-summary';
import {initialViolationFilterSettings, matchesViolationFilters} from '../shared/violation-filters';
import {createWcagCoverage} from '../shared/wcag-coverage';
import type {ViolationSelectedPayload} from '../shared/messages';
import {resolveComponentScopeForElement} from './component-scope';
import type {FocusPathPoint} from './focus-path-tracker';
import {renderFocusPath} from './focus-path-tracker';
import {
  severityColors,
  overlayFillColors,
  type ViolationRenderTarget,
  renderBox,
  renderFocusedViolationHalo,
  renderSelectionBackdrop,
  renderFocusedElementHalo,
  renderInspectedElementHalo,
  truncateLabel,
  formatCoverageCriteriaLabel,
  getViolationSummary,
  getAccessibleName,
  getAccessibleDescription,
  getAccessibleRole,
  getAccessibleState,
  createPreviewRow,
  buildPreviewShell,
  buildIdlePreviewShell,
  formatViolationEngines,
  normalizeOverlayText,
  getViolationFixText,
} from './violation-renderer';
import {
  getElementBySelector,
  isElementVisibleForOverlay,
  isOverlayEvent,
  positionInspectPopover,
  positionViolationDetail,
} from './overlay-geometry';
import {getSpokenSummary, requestReaderSpeak} from './reader-mode';
import {createBadge} from './violation-renderer';
import {mapKeyboardEventToNarratorCommand} from './narrator-keymap';
import {getNarratorTarget, type NarratorTarget} from './narrator-navigation';

const initialLayerVisibility: LayerVisibility = {
  coverage: false,
  errors: true,
  focusPath: false,
  landmarks: false,
  pageOverlay: true,
};

const initialReaderMode: ReaderModeSettings = {
  commandProfile: /mac/i.test(navigator.platform) ? 'voiceover' : 'hybrid',
  enabled: false,
  interruptPolicy: 'coalesce',
  inspectWithMouse: false,
  keyboardMode: 'strict-capture',
  lockInteractions: false,
  narratorEngineEnabled: true,
  rate: 0.92,
  speak: false,
  verbosity: 'medium',
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
  private componentScope: ComponentScope | null = null;
  private selectedViolationFocus: ViolationSelectedPayload | null = null;
  private renderQueued = false;
  private renderListenersAttached = false;
  private focusListenerAttached = false;
  private clickSelectionAttached = false;
  private inspectListenerAttached = false;
  private narratorKeyCaptureAttached = false;
  private readerStateListenersAttached = false;
  private lastPointerSyncAt = 0;
  private activeNodeChanged: (activeNode: AccessibleNodeSummary | null) => void = () => undefined;
  private componentScopeChanged: (payload: ComponentScope | null) => void = () => undefined;
  private violationSelected: (payload: ViolationSelectedPayload | null) => void = () => undefined;
  private disposed = false;
  private activeNodeLabelAbortController: AbortController | undefined;
  private renderRafId: number | undefined;
  private freeSelectionCleanup: ((bounds: ElementBounds | null) => void) | undefined;
  private narratorCursorElement: Element | null = null;
  private sayAllTaskId: number | undefined;
  private focusedStateSyncRafId: number | undefined;

  constructor() {
    this.mount();
    this.syncRuntimeSubscriptions();
  }

  setLayerVisibility(layerVisibility: LayerVisibility): void {
    if (this.disposed) {
      return;
    }

    this.layerVisibility = layerVisibility;
    this.syncRuntimeSubscriptions();
    this.queueRender();
  }

  setReport(report: AccessibilityReport): void {
    if (this.disposed) {
      return;
    }

    this.latestReport = report;
    this.syncRuntimeSubscriptions();
    this.queueRender();
  }

  setViolationFilters(violationFilters: ViolationFilterSettings): void {
    if (this.disposed) {
      return;
    }

    this.violationFilters = violationFilters;
    this.syncRuntimeSubscriptions();
    this.queueRender();
  }

  setComponentScope(componentScope: ComponentScope | null): void {
    if (this.disposed) {
      return;
    }

    this.componentScope = componentScope;
    this.syncRuntimeSubscriptions();
    this.queueRender();
  }

  setSelectedViolationFocus(payload: ViolationSelectedPayload | null): void {
    if (this.disposed) {
      return;
    }

    this.selectedViolationFocus = payload;
    this.queueRender();
  }

  async requestCaptureSnapshot(mode: Extract<EvidenceCaptureMode, 'element' | 'free-select'>): Promise<CaptureBoundsSnapshot | null> {
    if (this.disposed) {
      return null;
    }

    const bounds = mode === 'element'
      ? this.getCurrentCaptureTargetBounds()
      : await this.requestFreeSelectionBounds();

    if (!bounds) {
      return null;
    }

    return {
      bounds,
      devicePixelRatio: window.devicePixelRatio || 1,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  }

  reset(): void {
    if (this.disposed) {
      return;
    }

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
    this.componentScope = null;
    this.selectedViolationFocus = null;
    this.narratorCursorElement = null;
    this.stopSayAll();
    this.stopMutationObserver();
    this.syncRuntimeSubscriptions();
    this.svg.replaceChildren();
    this.hideActiveNode();
    window.speechSynthesis?.cancel();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    if (this.renderRafId !== undefined) {
      cancelAnimationFrame(this.renderRafId);
      this.renderRafId = undefined;
    }

    this.freeSelectionCleanup?.(null);

    this.toggleRenderListeners(false);
    this.toggleFocusListener(false);
    this.toggleClickSelectionListener(false);
    this.toggleInspectListener(false);
    this.toggleNarratorKeyCapture(false);
    this.toggleReaderStateListeners(false);
    this.toggleMutationObserver(false);

    if (this.focusedStateSyncRafId !== undefined) {
      cancelAnimationFrame(this.focusedStateSyncRafId);
      this.focusedStateSyncRafId = undefined;
    }

    this.activeNodeLabelAbortController?.abort();
    this.activeNodeLabelAbortController = undefined;

    this.host.remove();
  }

  setReaderMode(readerMode: ReaderModeSettings): void {
    if (this.disposed) {
      return;
    }

    this.readerMode = {
      ...readerMode,
      commandProfile: readerMode.commandProfile ?? initialReaderMode.commandProfile,
      interruptPolicy: readerMode.interruptPolicy ?? initialReaderMode.interruptPolicy,
      keyboardMode: readerMode.keyboardMode ?? initialReaderMode.keyboardMode,
      narratorEngineEnabled: readerMode.narratorEngineEnabled ?? initialReaderMode.narratorEngineEnabled,
      verbosity: readerMode.verbosity ?? initialReaderMode.verbosity,
    };

    if (!readerMode.inspectWithMouse || readerMode.enabled) {
      this.latestMouseElement = null;
      this.latestMouseSummary = null;
    }

    if (!readerMode.enabled) {
      window.speechSynthesis?.cancel();
      this.stopSayAll();
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
    if (this.disposed) {
      return;
    }

    this.activeNodeChanged = listener;
  }

  onComponentScopeChanged(listener: (payload: ComponentScope | null) => void): void {
    if (this.disposed) {
      return;
    }

    this.componentScopeChanged = listener;
  }

  onViolationSelected(listener: (payload: ViolationSelectedPayload | null) => void): void {
    if (this.disposed) {
      return;
    }

    this.violationSelected = listener;
  }

  getActiveNodeSummary(element: Element): AccessibleNodeSummary {
    if (this.disposed) {
      throw new Error('PageOverlay has been disposed');
    }

    const role = getAccessibleRole(element);
    const accessibleName = getAccessibleName(element);
    const fallbackName = this.getFallbackNarrationName(element, role);

    return {
      bounds: getElementBounds(element),
      componentScope: resolveComponentScopeForElement(element) ?? undefined,
      description: getAccessibleDescription(element),
      name: accessibleName || fallbackName,
      role,
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
    this.host.setAttribute('popover', 'manual');

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

      .active-node-label.violation-detail {
        animation: kg-popover-in 140ms cubic-bezier(0.16, 1, 0.3, 1);
        border-color: rgba(15, 23, 42, 0.16);
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.2), 0 2px 8px rgba(15, 23, 42, 0.08);
        max-block-size: min(520px, calc(100vh - 32px));
        max-inline-size: min(440px, calc(100vw - 24px));
        min-inline-size: min(360px, calc(100vw - 24px));
      }

      .violation-panel__header {
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        border-radius: 12px 12px 0 0;
      }

      .severity-label {
        border-radius: 5px;
        color: #ffffff;
        margin-bottom: 8px;
        max-inline-size: 100%;
        overflow-wrap: anywhere;
        padding: 4px 7px;
      }

      .severity-label--critical {
        background: #d9214f;
      }

      .severity-label--warning {
        background: #d88400;
      }

      .severity-label--info {
        background: #207ff0;
      }

      .wcag-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 10px;
      }

      .wcag-tag {
        background: #eef2ff;
        border-color: #c7d2fe;
        color: #3730a3;
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
    this.activeNodeLabelAbortController = new AbortController();
    const {signal} = this.activeNodeLabelAbortController;
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchend'].forEach(eventName => {
      this.activeNodeLabel.addEventListener(eventName, event => event.stopPropagation(), {capture: true, signal});
    });
    this.shadowRoot.append(style, this.svg, this.activeNodeLabel);
    document.documentElement.append(this.host);
    this.bringOverlayToTopLayerFront();
  }

  private syncRuntimeSubscriptions(): void {
    this.toggleRenderListeners(this.needsRenderListeners());
    this.toggleFocusListener(this.needsFocusTracking());
    this.toggleClickSelectionListener(this.needsClickSelection());
    this.toggleInspectListener(this.needsInspectTracking());
    this.toggleNarratorKeyCapture(this.needsNarratorKeyCapture());
    this.toggleReaderStateListeners(this.needsReaderStateTracking());
    this.toggleMutationObserver(this.needsMutationObserver());
  }

  private toggleRenderListeners(shouldAttach: boolean): void {
    if (this.renderListenersAttached === shouldAttach) {
      return;
    }

    if (shouldAttach) {
      window.addEventListener('scroll', this.queueRender, {passive: true});
      window.addEventListener('resize', this.queueRender);
      document.addEventListener('scroll', this.queueRender, {capture: true, passive: true});
      window.visualViewport?.addEventListener('resize', this.queueRender, {passive: true});
      window.visualViewport?.addEventListener('scroll', this.queueRender, {passive: true});
    } else {
      window.removeEventListener('scroll', this.queueRender);
      window.removeEventListener('resize', this.queueRender);
      document.removeEventListener('scroll', this.queueRender, true);
      window.visualViewport?.removeEventListener('resize', this.queueRender);
      window.visualViewport?.removeEventListener('scroll', this.queueRender);
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
      document.addEventListener('mouseleave', this.hideInspectPreviewOnLeave, true);
      window.addEventListener('blur', this.clearInspectPreview, true);
    } else {
      document.removeEventListener('mousemove', this.showActiveNode, true);
      document.removeEventListener('mouseleave', this.hideInspectPreviewOnLeave, true);
      window.removeEventListener('blur', this.clearInspectPreview, true);
      this.latestMouseElement = null;
      this.latestMouseSummary = null;
      this.hideActiveNode();
      this.queueRender();
    }

    this.inspectListenerAttached = shouldAttach;
  }

  private toggleNarratorKeyCapture(shouldAttach: boolean): void {
    if (this.narratorKeyCaptureAttached === shouldAttach) {
      return;
    }

    if (shouldAttach) {
      window.addEventListener('keydown', this.handleNarratorKeydown, true);
      document.addEventListener('keydown', this.handleNarratorKeydown, true);
      window.addEventListener('keyup', this.suppressNarratorMappedKeyup, true);
      document.addEventListener('keyup', this.suppressNarratorMappedKeyup, true);
    } else {
      window.removeEventListener('keydown', this.handleNarratorKeydown, true);
      document.removeEventListener('keydown', this.handleNarratorKeydown, true);
      window.removeEventListener('keyup', this.suppressNarratorMappedKeyup, true);
      document.removeEventListener('keyup', this.suppressNarratorMappedKeyup, true);
    }

    this.narratorKeyCaptureAttached = shouldAttach;
  }

  private toggleReaderStateListeners(shouldAttach: boolean): void {
    if (this.readerStateListenersAttached === shouldAttach) {
      return;
    }

    if (shouldAttach) {
      document.addEventListener('input', this.scheduleFocusedStateSync, true);
      document.addEventListener('change', this.scheduleFocusedStateSync, true);
      document.addEventListener('click', this.scheduleFocusedStateSync, true);
      document.addEventListener('keyup', this.scheduleFocusedStateSync, true);
    } else {
      document.removeEventListener('input', this.scheduleFocusedStateSync, true);
      document.removeEventListener('change', this.scheduleFocusedStateSync, true);
      document.removeEventListener('click', this.scheduleFocusedStateSync, true);
      document.removeEventListener('keyup', this.scheduleFocusedStateSync, true);

      if (this.focusedStateSyncRafId !== undefined) {
        cancelAnimationFrame(this.focusedStateSyncRafId);
        this.focusedStateSyncRafId = undefined;
      }
    }

    this.readerStateListenersAttached = shouldAttach;
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
      this.mutationObserver = new MutationObserver(() => {
        this.queueRender();
        this.scheduleFocusedStateSync();
      });
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
    return this.latestReport !== null
      && this.layerVisibility.pageOverlay
      && (this.layerVisibility.errors || this.layerVisibility.coverage)
      && !this.readerMode.enabled;
  }

  private needsInspectTracking(): boolean {
    return this.readerMode.inspectWithMouse && !this.readerMode.enabled;
  }

  private needsNarratorKeyCapture(): boolean {
    return this.readerMode.enabled
      && this.readerMode.narratorEngineEnabled !== false
      && this.readerMode.keyboardMode === 'strict-capture';
  }

  private needsReaderStateTracking(): boolean {
    return this.readerMode.enabled;
  }

  private shouldRenderFrame(): boolean {
    const hasOverlayLayers = this.latestReport !== null
      && this.layerVisibility.pageOverlay
      && (this.layerVisibility.coverage || this.layerVisibility.errors || this.layerVisibility.landmarks || this.layerVisibility.focusPath);
    const hasReaderHighlight = this.readerMode.enabled && this.latestSummary?.bounds !== undefined;
    const hasInspectHighlight = this.readerMode.inspectWithMouse && !this.readerMode.enabled && this.latestMouseSummary?.bounds !== undefined;

    return hasOverlayLayers || hasReaderHighlight || hasInspectHighlight;
  }

  private readonly queueRender = (): void => {
    if (this.disposed) {
      return;
    }

    if (!this.shouldRenderFrame() && this.svg.childElementCount === 0) {
      return;
    }

    if (this.renderQueued) {
      return;
    }

    this.renderQueued = true;

    this.renderRafId = requestAnimationFrame(() => {
      this.renderRafId = undefined;
      this.renderQueued = false;
      this.render();
    });
  };

  private readonly scheduleFocusedStateSync = (): void => {
    if (!this.readerMode.enabled || !this.latestFocusedElement || this.disposed) {
      return;
    }

    if (this.focusedStateSyncRafId !== undefined) {
      return;
    }

    this.focusedStateSyncRafId = requestAnimationFrame(() => {
      this.focusedStateSyncRafId = undefined;
      this.syncFocusedSummaryIfChanged();
    });
  };

  private render(): void {
    this.bringOverlayToTopLayerFront();
    this.svg.replaceChildren();

    if (this.latestReport && this.layerVisibility.pageOverlay && this.layerVisibility.landmarks) {
      this.latestReport.landmarks.forEach((landmark, index) => this.renderLandmark(landmark, index));
    }

    if (this.latestReport && this.layerVisibility.pageOverlay && this.layerVisibility.coverage) {
      this.renderCoverageOverlay();
    }

    const shouldRenderViolationLayer = this.latestReport
      && this.layerVisibility.pageOverlay
      && (this.layerVisibility.errors || this.layerVisibility.coverage);

    if (shouldRenderViolationLayer) {
      const visibleViolations = this.layerVisibility.errors ? this.getRenderableViolations() : this.getCoverageRenderableViolations();
      const hasFocusedViolation = this.selectedViolationFocus
        && visibleViolations.some(violation => this.isSelectedViolation(violation));

      if (hasFocusedViolation) {
        renderSelectionBackdrop(this.svg);
      }

      if (this.layerVisibility.errors) {
        visibleViolations.forEach((violation, index) => this.renderViolation(violation, index));
      }

      if (!this.readerMode.enabled && !this.readerMode.inspectWithMouse) {
        this.hideActiveNode();
      }
    }

    if (this.latestReport && this.layerVisibility.pageOverlay && this.layerVisibility.focusPath) {
      renderFocusPath(this.svg, this.focusPath);
    }

    if (this.readerMode.enabled && this.latestSummary?.bounds) {
      this.renderFocusedElement(this.latestSummary);
    }

    if (this.readerMode.inspectWithMouse && !this.readerMode.enabled && this.latestMouseSummary?.bounds) {
      this.renderInspectedElement(this.latestMouseSummary);
    }
  }

  private bringOverlayToTopLayerFront(): void {
    if (!this.canUsePopoverTopLayer(this.host)) {
      return;
    }

    try {
      if (this.host.matches(':popover-open')) {
        this.host.hidePopover();
      }

      this.host.showPopover();
    } catch {
      // The overlay still works as a fixed element in browsers without popover top-layer support.
    }
  }

  private canUsePopoverTopLayer(element: HTMLElement): element is HTMLElement & {showPopover: () => void} {
    return typeof (element as {readonly showPopover?: unknown}).showPopover === 'function';
  }

  private renderViolation(violation: KodeGlassViolation, index: number): void {
    const target = this.getViolationRenderTarget(violation);

    if (!target) {
      return;
    }

    const bounds = target.bounds;
    const selected = this.isSelectedViolation(violation);

    if (selected) {
      renderFocusedViolationHalo(this.svg, bounds);
    }

    renderBox(this.svg, {
      bounds,
      color: severityColors[violation.severity],
      fill: overlayFillColors[violation.severity],
      label: selected ? `* #${index + 1}` : `#${index + 1}`,
      dashArray: selected ? '4 3' : undefined,
      selected,
    });
  }

  private renderCoverageOverlay(): void {
    const coverage = this.getSourceFilteredCoverage();

    if (!coverage.length) {
      return;
    }

    this.getCoverageRenderableViolations().forEach(violation => this.renderCoverageViolationMarker(violation));
  }

  private renderCoverageViolationMarker(violation: KodeGlassViolation): void {
    const target = this.getViolationRenderTarget(violation);
    const criteria = violation.wcagCriteria ?? [];

    if (!target || !criteria.length) {
      return;
    }

    renderBox(this.svg, {
      bounds: target.bounds,
      color: '#d9214f',
      dashArray: '3 3',
      fill: 'rgba(217, 33, 79, 0.05)',
      label: formatCoverageCriteriaLabel(criteria),
      selected: this.isSelectedViolation(violation),
    });
  }

  private renderViolationDetail(violation: KodeGlassViolation): void {
    const target = this.getViolationRenderTarget(violation);

    if (!target) {
      this.hideActiveNode();

      return;
    }

    const summary = this.getActiveNodeSummary(target.element);
    const shell = document.createElement('div');
    shell.className = 'glass-panel violation-panel';

    const header = document.createElement('div');
    header.className = 'panel-header violation-panel__header';

    const roleLabel = document.createElement('div');
    roleLabel.className = `role-label severity-label severity-label--${violation.severity}`;
    roleLabel.textContent = `${violation.severity} - ${violation.ruleId}`;

    const title = document.createElement('div');
    title.className = 'element-title';
    title.textContent = getViolationSummary(violation);

    header.append(roleLabel, title);

    if (violation.wcagCriteria?.length) {
      const criteria = document.createElement('div');
      criteria.className = 'wcag-tags';
      violation.wcagCriteria.forEach(criterion => {
        const tag = document.createElement('span');
        tag.className = 'state-tag wcag-tag';
        tag.textContent = criterion;
        criteria.append(tag);
      });
      header.append(criteria);
    }

    shell.append(header);

    const body = document.createElement('div');
    body.className = 'panel-body';
    body.append(
      createPreviewRow('Element', `${summary.role}${summary.name ? ` - ${summary.name}` : ' - unnamed'}`),
      createPreviewRow('Selector', violation.selector),
      createPreviewRow('Source', formatViolationEngines(violation.sourceEngines ?? [violation.engine])),
    );

    if (violation.description) {
      body.append(createPreviewRow('What failed', normalizeOverlayText(violation.description)));
    }

    body.append(createPreviewRow('Fix', getViolationFixText(violation)));

    if (summary.componentScope) {
      body.append(createPreviewRow('Component', summary.componentScope.label));
    }

    if (violation.helpUrl) {
      body.append(createPreviewRow('Rule guide', violation.helpUrl));
    }

    shell.append(body);

    this.activeNodeLabel.replaceChildren(shell);
    this.activeNodeLabel.classList.remove('reader-subtitle', 'inspect-popover');
    this.activeNodeLabel.classList.add('violation-detail');
    this.activeNodeLabel.style.display = 'block';
    positionViolationDetail(this.activeNodeLabel, target.bounds);
  }

  private renderLandmark(landmark: LandmarkSummary, index: number): void {
    if (!landmark.bounds) {
      return;
    }

    const label = landmark.label ? `${landmark.role}: ${landmark.label}` : landmark.role;
    renderBox(this.svg, {
      bounds: landmark.bounds,
      color: '#008f7a',
      dashArray: '6 4',
      fill: 'rgba(0, 143, 122, 0.07)',
      label: `${index + 1}. ${truncateLabel(label)}`,
    });
  }

  private renderFocusedElement(summary: AccessibleNodeSummary): void {
    const bounds = summary.bounds;

    if (!bounds) {
      return;
    }

    const x = bounds.x - window.scrollX;
    const y = bounds.y - window.scrollY;
    const height = bounds.height;

    renderFocusedElementHalo(this.svg, bounds);
    this.svg.append(createBadge('Focus', '#526ed3', x, y, height));
  }

  private renderInspectedElement(summary: AccessibleNodeSummary): void {
    const bounds = summary.bounds;

    if (!bounds) {
      return;
    }

    const x = bounds.x - window.scrollX;
    const y = bounds.y - window.scrollY;
    const height = bounds.height;

    renderInspectedElementHalo(this.svg, bounds);
    this.svg.append(createBadge('Inspect', '#526ed3', x, y, height));
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

    if (this.readerMode.enabled) {
      this.narratorCursorElement = event.target;
      this.showReaderSubtitle(summary);
    } else {
      this.activeNodeChanged(summary);
    }

    this.queueRender();
  };

  private syncFocusedSummaryIfChanged(): void {
    const focusedElement = this.latestFocusedElement;

    if (!focusedElement || !focusedElement.isConnected || !this.readerMode.enabled) {
      return;
    }

    const nextSummary = this.getActiveNodeSummary(focusedElement);

    if (this.latestSummary && this.summariesMatch(this.latestSummary, nextSummary)) {
      return;
    }

    this.latestSummary = nextSummary;
    this.showReaderSubtitle(nextSummary);
    this.queueRender();
  }

  private readonly handleNarratorKeydown = (event: KeyboardEvent): void => {
    if (!this.readerMode.enabled || this.readerMode.keyboardMode !== 'strict-capture') {
      return;
    }

    const command = mapKeyboardEventToNarratorCommand(event, this.readerMode.commandProfile ?? 'hybrid');

    if (!command) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.applyNarratorCommand(command);
  };

  private readonly suppressNarratorMappedKeyup = (event: KeyboardEvent): void => {
    if (!this.readerMode.enabled || this.readerMode.keyboardMode !== 'strict-capture') {
      return;
    }

    const command = mapKeyboardEventToNarratorCommand(event, this.readerMode.commandProfile ?? 'hybrid');

    if (!command) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  private readonly selectViolationFromPointer = (event: MouseEvent): void => {
    if (!this.latestReport || this.readerMode.enabled) {
      return;
    }

    if (isOverlayEvent(this.host, event)) {
      return;
    }

    if (this.readerMode.inspectWithMouse) {
      this.latestMouseElement = null;
      this.latestMouseSummary = null;
      this.componentScopeChanged(null);

      return;
    }

    const violationAtPointer = this.getViolationAtPoint(event.pageX, event.pageY);

    if (violationAtPointer) {
      event.preventDefault();
      event.stopPropagation();
      this.selectViolation(violationAtPointer);
      this.componentScopeChanged(null);

      return;
    }

    if (!(event.target instanceof Element)) {
      return;
    }

    const directScope = resolveComponentScopeForElement(event.target);

    if (directScope) {
      if (this.readerMode.lockInteractions) {
        event.preventDefault();
        event.stopPropagation();
      }
      this.componentScopeChanged(directScope);

      return;
    }

    if (this.readerMode.lockInteractions) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private readonly showActiveNode = (event: MouseEvent): void => {
    if (!this.readerMode.inspectWithMouse || this.readerMode.enabled || !(event.target instanceof Element) || isOverlayEvent(this.host, event)) {
      return;
    }

    const now = performance.now();

    if (now - this.lastPointerSyncAt < 16) {
      return;
    }

    this.lastPointerSyncAt = now;

    if (event.target === this.latestMouseElement) {
      positionInspectPopover(this.activeNodeLabel, event);

      return;
    }

    this.latestMouseElement = event.target;

    const summary = this.getActiveNodeSummary(event.target);
    this.latestMouseSummary = summary;
    this.activeNodeLabel.replaceChildren(buildPreviewShell(summary, false));
    this.activeNodeLabel.classList.add('inspect-popover');
    this.activeNodeLabel.classList.remove('reader-subtitle', 'violation-detail');
    this.activeNodeLabel.style.display = 'block';
    positionInspectPopover(this.activeNodeLabel, event);
    this.activeNodeChanged(summary);
    this.queueRender();
  };

  private readonly hideActiveNode = (): void => {
    this.activeNodeLabel.style.display = 'none';
    this.activeNodeLabel.classList.remove('inspect-popover');
    this.activeNodeLabel.classList.remove('reader-subtitle');
    this.activeNodeLabel.classList.remove('violation-detail');
    this.activeNodeChanged(null);
  };

  private readonly clearInspectPreview = (): void => {
    if (!this.readerMode.inspectWithMouse || this.readerMode.enabled) {
      return;
    }

    this.latestMouseElement = null;
    this.latestMouseSummary = null;
    this.hideActiveNode();
    this.queueRender();
  };

  private readonly hideInspectPreviewOnLeave = (event: MouseEvent): void => {
    if (event.relatedTarget === null) {
      this.clearInspectPreview();
    }
  };

  private showReaderSubtitle(
    summary: AccessibleNodeSummary,
    context?: {readonly index?: number; readonly total?: number; readonly unit?: NarratorTarget['unit']},
  ): void {
    if (!this.readerMode.enabled) {
      this.activeNodeChanged(summary);

      return;
    }

    const text = getSpokenSummary(summary, this.readerMode, context);

    this.activeNodeLabel.replaceChildren(buildPreviewShell(summary, true));
    this.activeNodeLabel.classList.remove('inspect-popover', 'violation-detail');
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
    this.activeNodeLabel.replaceChildren(buildIdlePreviewShell());
    this.activeNodeLabel.classList.remove('inspect-popover', 'violation-detail');
    this.activeNodeLabel.classList.add('reader-subtitle');
    this.activeNodeLabel.style.display = 'block';
    this.activeNodeLabel.style.left = '';
    this.activeNodeLabel.style.top = '';
  }

  applyNarratorCommand(command: NarratorCommand): void {
    if (!this.readerMode.enabled || this.readerMode.narratorEngineEnabled === false) {
      return;
    }

    if (command.type === 'read-current') {
      if (this.latestSummary) {
        this.showReaderSubtitle(this.latestSummary);
      }

      return;
    }

    if (command.type === 'stop-speech') {
      this.stopSayAll();
      this.sendSpeechControl('stop');
      return;
    }

    if (command.type === 'pause-speech') {
      this.sendSpeechControl('pause');
      return;
    }

    if (command.type === 'resume-speech') {
      this.sendSpeechControl('resume');
      return;
    }

    if (command.type === 'activate-current') {
      const target = this.narratorCursorElement;

      if (target instanceof HTMLElement) {
        target.click();
      }

      return;
    }

    if (command.type === 'say-all') {
      if (command.value) {
        this.startSayAll();
      } else {
        this.stopSayAll();
      }

      return;
    }

    if ((command.type === 'next-unit' || command.type === 'previous-unit') && command.unit) {
      const direction = command.type === 'next-unit' ? 'next' : 'previous';
      const target = getNarratorTarget(command.unit, this.narratorCursorElement, direction);

      if (target) {
        this.moveNarratorCursorToTarget(target);
      }
    }
  }

  private moveNarratorCursorToTarget(target: NarratorTarget): void {
    const element = target.element;
    this.narratorCursorElement = element;

    if (element instanceof HTMLElement) {
      element.focus({preventScroll: false});
      element.scrollIntoView({block: 'nearest', inline: 'nearest'});
    }

    const summary = this.getActiveNodeSummary(element);
    this.latestSummary = summary;
    this.latestFocusedElement = element;
    this.showReaderSubtitle(summary, {
      index: target.index,
      total: target.total,
      unit: target.unit,
    });
    this.queueRender();
  }

  private startSayAll(): void {
    this.stopSayAll();

    const sayAllTaskId = window.setInterval(() => {
      this.applyNarratorCommand({type: 'next-unit', unit: 'line'});
    }, 1100);

    this.sayAllTaskId = sayAllTaskId;
  }

  private stopSayAll(): void {
    clearInterval(this.sayAllTaskId);
    this.sayAllTaskId = undefined;
  }

  private sendSpeechControl(action: 'pause' | 'resume' | 'stop'): void {
    if (!chrome.runtime?.id) {
      return;
    }

    void chrome.runtime.sendMessage({
      payload: {action},
      type: RuntimeMessageType.ReaderSpeechControlRequested,
    });
  }

  private getViolationAtPoint(x: number, y: number): KodeGlassViolation | null {
    if (!this.latestReport || !this.layerVisibility.pageOverlay || (!this.layerVisibility.errors && !this.layerVisibility.coverage)) {
      return null;
    }

    const violations = this.layerVisibility.errors ? this.getRenderableViolations() : this.getCoverageRenderableViolations();

    return violations.find(violation => {
      const bounds = this.getCurrentViolationBounds(violation);

      return Boolean(bounds && x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height);
    }) ?? null;
  }

  private getCurrentViolationBounds(violation: KodeGlassViolation): ElementBounds | undefined {
    return this.getViolationRenderTarget(violation)?.bounds;
  }

  private getViolationRenderTarget(violation: KodeGlassViolation): ViolationRenderTarget | null {
    const element = getElementBySelector(violation.selector);

    if (!element || !this.shouldRenderViolationElement(element)) {
      return null;
    }

    const bounds = getElementBounds(element);

    return bounds ? {bounds, element} : null;
  }

  private shouldRenderViolationElement(element: Element): boolean {
    return isElementVisibleForOverlay(element);
  }

  private summariesMatch(previous: AccessibleNodeSummary, next: AccessibleNodeSummary): boolean {
    if (previous.name !== next.name || previous.role !== next.role || previous.description !== next.description || previous.selector !== next.selector) {
      return false;
    }

    if (previous.state.length !== next.state.length) {
      return false;
    }

    return previous.state.every((state, index) => state === next.state[index]);
  }

  private getFallbackNarrationName(element: Element, role: string): string {
    if (this.isInteractiveNarrationRole(role)) {
      return '';
    }

    const readableText = (element instanceof HTMLElement ? element.innerText : element.textContent)
      ?.replace(/\s+/g, ' ')
      .trim();

    if (!readableText) {
      return '';
    }

    return readableText.slice(0, 140);
  }

  private isInteractiveNarrationRole(role: string): boolean {
    return new Set([
      'button',
      'checkbox',
      'combobox',
      'link',
      'listbox',
      'menuitem',
      'option',
      'radio',
      'searchbox',
      'slider',
      'spinbutton',
      'switch',
      'tab',
      'textbox',
      'treeitem',
    ]).has(role.trim().toLowerCase());
  }

  private getRenderableViolations(): readonly KodeGlassViolation[] {
    return this.getVisibleViolations().filter(violation => this.getViolationRenderTarget(violation));
  }

  private getCoverageRenderableViolations(): readonly KodeGlassViolation[] {
    return this.getSourceFilteredViolations().filter(violation => violation.wcagCriteria?.length && this.getViolationRenderTarget(violation));
  }

  private getSourceFilteredCoverage(): AccessibilityReport['coverage'] {
    if (!this.latestReport) {
      return [];
    }

    return createWcagCoverage(
      this.latestReport.auditSettings,
      this.getSourceFilteredViolations(),
      this.getSourceFilteredEngineStatuses(),
    );
  }

  private getSourceFilteredViolations(): readonly KodeGlassViolation[] {
    return this.latestReport?.violations.filter(violation => matchesViolationFilters(violation, this.violationFilters, {includeSeverityFilter: false})) ?? [];
  }

  private getSourceFilteredEngineStatuses(): AccessibilityReport['engineStatuses'] {
    if (!this.latestReport || this.violationFilters.engine === 'both') {
      return this.latestReport?.engineStatuses ?? [];
    }

    const engine = this.violationFilters.engine === 'axe' ? 'axe-core' : 'ibm-equal-access';

    return this.latestReport.engineStatuses.filter(status => status.engine === engine);
  }

  private getVisibleViolations(): readonly KodeGlassViolation[] {
    return this.latestReport?.violations.filter(violation => {
      const matchesFilters = matchesViolationFilters(violation, this.violationFilters);
      const matchesComponentScope = !this.componentScope || violation.componentScope?.tagName === this.componentScope.tagName;
      const matchesSelectedViolation = !this.selectedViolationFocus
        || violation.id === this.selectedViolationFocus.violationId
        || violation.selector === this.selectedViolationFocus.selector;

      return matchesFilters && matchesComponentScope && matchesSelectedViolation;
    }) ?? [];
  }

  private isSelectedViolation(violation: KodeGlassViolation): boolean {
    if (!this.selectedViolationFocus) {
      return false;
    }

    return violation.id === this.selectedViolationFocus.violationId
      || violation.selector === this.selectedViolationFocus.selector;
  }

  private selectViolation(violation: KodeGlassViolation): void {
    if (this.isSelectedViolation(violation)) {
      this.selectedViolationFocus = null;
      this.violationSelected(null);
      this.queueRender();

      return;
    }

    const payload = {selector: violation.selector, violationId: violation.id};
    this.selectedViolationFocus = payload;
    this.violationSelected(payload);
    this.queueRender();
  }

  private getCurrentCaptureTargetBounds(): ElementBounds | null {
    if (this.selectedViolationFocus && this.latestReport) {
      const selectedViolation = this.latestReport.violations.find(
        violation =>
          violation.id === this.selectedViolationFocus?.violationId
          || violation.selector === this.selectedViolationFocus?.selector,
      );
      const selectedBounds = selectedViolation ? this.getCurrentViolationBounds(selectedViolation) : undefined;

      if (selectedBounds) {
        return selectedBounds;
      }
    }

    return this.latestMouseSummary?.bounds ?? this.latestSummary?.bounds ?? null;
  }

  private async requestFreeSelectionBounds(): Promise<ElementBounds | null> {
    return new Promise(resolve => {
      const layer = document.createElement('div');
      const box = document.createElement('div');
      let startX = 0;
      let startY = 0;
      let latestX = 0;
      let latestY = 0;
      let drawing = false;
      const previousUserSelect = document.body.style.userSelect;
      const previousCursor = document.body.style.cursor;

      layer.style.position = 'fixed';
      layer.style.inset = '0';
      layer.style.zIndex = '2147483646';
      layer.style.background = 'rgba(2, 6, 23, 0.06)';
      layer.style.cursor = 'crosshair';
      layer.style.pointerEvents = 'auto';
      layer.style.userSelect = 'none';
      layer.style.touchAction = 'none';

      box.style.position = 'fixed';
      box.style.border = '2px dashed #526ed3';
      box.style.background = 'rgba(82, 110, 211, 0.12)';
      box.style.display = 'none';
      box.style.pointerEvents = 'none';

      layer.append(box);
      document.documentElement.append(layer);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'crosshair';

      const cleanup = (result: ElementBounds | null): void => {
        this.freeSelectionCleanup = undefined;
        layer.removeEventListener('pointerdown', onPointerDown, true);
        layer.removeEventListener('pointermove', onPointerMove, true);
        layer.removeEventListener('pointerup', onPointerUp, true);
        document.removeEventListener('keydown', onKeyDown, true);
        layer.remove();
        document.body.style.userSelect = previousUserSelect;
        document.body.style.cursor = previousCursor;
        resolve(result);
      };

      this.freeSelectionCleanup = cleanup;

      const updateBox = (): void => {
        const left = Math.min(startX, latestX);
        const top = Math.min(startY, latestY);
        const width = Math.abs(latestX - startX);
        const height = Math.abs(latestY - startY);

        box.style.display = 'block';
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
      };

      const onPointerDown = (event: PointerEvent): void => {
        event.preventDefault();
        drawing = true;
        startX = event.clientX;
        startY = event.clientY;
        latestX = event.clientX;
        latestY = event.clientY;
        updateBox();
      };

      const onPointerMove = (event: PointerEvent): void => {
        if (!drawing) {
          return;
        }

        event.preventDefault();
        latestX = event.clientX;
        latestY = event.clientY;
        updateBox();
      };

      const onPointerUp = (event: PointerEvent): void => {
        if (!drawing) {
          cleanup(null);

          return;
        }

        event.preventDefault();
        drawing = false;
        latestX = event.clientX;
        latestY = event.clientY;
        const left = Math.min(startX, latestX);
        const top = Math.min(startY, latestY);
        const width = Math.abs(latestX - startX);
        const height = Math.abs(latestY - startY);

        if (width < 8 || height < 8) {
          cleanup(null);

          return;
        }

        cleanup({
          height: Math.round(height),
          width: Math.round(width),
          x: Math.round(left + window.scrollX),
          y: Math.round(top + window.scrollY),
        });
      };

      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cleanup(null);
        }
      };

      layer.addEventListener('pointerdown', onPointerDown, true);
      layer.addEventListener('pointermove', onPointerMove, true);
      layer.addEventListener('pointerup', onPointerUp, true);
      document.addEventListener('keydown', onKeyDown, true);
    });
  }

}
