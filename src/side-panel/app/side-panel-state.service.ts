import {computed, Injectable, signal} from '@angular/core';
import type {
  AccessibilityReport,
  AccessibleNodeSummary,
  AuditSettings,
  AuditStandard,
  KodeGlassViolation,
  LayerName,
  LayerVisibility,
  ReaderModeSettings,
  SeverityVisibility,
  ViolationEngineFilter,
  ViolationFilterSettings,
  ViolationSeverity,
} from '../../shared/accessibility-report';
import {RuntimeMessageType, type RuntimeMessage, type ViolationSelectedPayload} from '../../shared/messages';
import {pickDefaultReaderVoice} from '../../shared/reader-voice';
import {initialViolationFilterSettings, matchesViolationFilters} from '../../shared/violation-filters';

export interface ViolationGroup {
  readonly count: number;
  readonly description?: string;
  readonly engineLabel: string;
  readonly fix?: ViolationFix;
  readonly guidance?: string;
  readonly helpUrl?: string;
  readonly id: string;
  readonly ruleId: string;
  readonly selectors: readonly string[];
  readonly severity: ViolationSeverity;
  readonly summary: string;
  readonly title: string;
  readonly violationIds: readonly string[];
}

export interface ViolationFix {
  readonly segments: readonly ViolationFixSegment[];
  readonly text: string;
}

export interface ViolationFixSegment {
  readonly kind: 'chip' | 'text';
  readonly text: string;
}

export interface ReaderVoiceOption {
  readonly label: string;
  readonly lang: string;
  readonly localService: boolean;
  readonly name: string;
  readonly voiceURI: string;
}

export type PreviewMode = 'off' | 'reader' | 'inspect';

const initialLayerVisibility: LayerVisibility = {
  errors: true,
  focusPath: false,
  landmarks: false,
  pageOverlay: true,
};

const initialAuditSettings: AuditSettings = {
  standard: 'wcag2aa',
};

const initialReaderMode: ReaderModeSettings = {
  enabled: false,
  inspectWithMouse: false,
  rate: 0.92,
  speak: false,
};

const sidePanelPortName = 'kode-glass-side-panel';

@Injectable({providedIn: 'root'})
export class SidePanelStateService {
  private connected = false;
  private panelClosing = false;
  private panelPort: chrome.runtime.Port | undefined;
  private sessionTabId: number | undefined;
  private analysisLoadingTimeout: ReturnType<typeof setTimeout> | undefined;
  private detachVoicesChangedListener: (() => void) | undefined;
  private readonly activeNodeSignal = signal<AccessibleNodeSummary | null>(null);
  private readonly analysisErrorSignal = signal<string | null>(null);
  private readonly analysisLoadingSignal = signal(false);
  private readonly auditSettingsSignal = signal<AuditSettings>(initialAuditSettings);
  private readonly layerVisibilitySignal = signal<LayerVisibility>(initialLayerVisibility);
  private readonly pageReportSignal = signal<AccessibilityReport | null>(null);
  private readonly pageTitleSignal = signal('Waiting for a page');
  private readonly pageUrlSignal = signal('');
  private readonly readerModeSignal = signal<ReaderModeSettings>(initialReaderMode);
  private readonly selectedViolationSignal = signal<ViolationSelectedPayload | null>(null);
  private readonly violationFilterSettingsSignal = signal<ViolationFilterSettings>(initialViolationFilterSettings);
  private readonly voiceOptionsSignal = signal<readonly ReaderVoiceOption[]>([]);
  private readonly violationsSignal = signal<readonly AccessibilityReport['violations'][number][]>([]);

  readonly activeNode = this.activeNodeSignal.asReadonly();
  readonly analysisError = this.analysisErrorSignal.asReadonly();
  readonly analysisLoading = this.analysisLoadingSignal.asReadonly();
  readonly auditSettings = this.auditSettingsSignal.asReadonly();
  readonly layerVisibility = this.layerVisibilitySignal.asReadonly();
  readonly pageReport = this.pageReportSignal.asReadonly();
  readonly pageTitle = this.pageTitleSignal.asReadonly();
  readonly pageUrl = this.pageUrlSignal.asReadonly();
  readonly readerMode = this.readerModeSignal.asReadonly();
  readonly selectedViolation = this.selectedViolationSignal.asReadonly();
  readonly severityVisibility = computed(() => this.violationFilterSettings().severity);
  readonly violationEngineFilter = computed(() => this.violationFilterSettings().engine);
  readonly violationFilterSettings = this.violationFilterSettingsSignal.asReadonly();
  readonly voiceOptions = this.voiceOptionsSignal.asReadonly();
  readonly violations = this.violationsSignal.asReadonly();
  readonly availableSeverityCounts = computed(() => this.createSeverityCounts(this.createVisibleViolations({includeSeverityFilter: false})));
  readonly engineStatuses = computed(() => this.pageReport()?.engineStatuses ?? []);
  readonly hasEngineWarnings = computed(() => this.engineStatuses().some(status => status.status !== 'completed'));
  readonly headings = computed(() => this.pageReport()?.headings ?? []);
  readonly landmarks = computed(() => this.pageReport()?.landmarks ?? []);
  readonly visibleViolations = computed(() => this.createVisibleViolations());
  readonly hasViolations = computed(() => this.violations().length > 0);
  readonly hasVisibleViolations = computed(() => this.visibleViolations().length > 0);
  readonly hasStructure = computed(() => this.headings().length > 0 || this.landmarks().length > 0);
  readonly reportSeverityCounts = computed(() => this.createSeverityCounts(this.violations()));
  readonly severityCounts = computed(() => this.createSeverityCounts());
  readonly totalHeadings = computed(() => this.headings().length);
  readonly totalLandmarks = computed(() => this.landmarks().length);
  readonly totalViolations = computed(() => this.violations().length);
  readonly violationGroups = computed(() => this.createViolationGroups(this.violations()));
  readonly topViolationGroups = computed(() => this.violationGroups().slice(0, 6));
  readonly visibleViolationGroups = computed(() => this.createViolationGroups());
  readonly reportMarkdown = computed(() => this.createReportMarkdown());

  connectRuntime(): void {
    if (this.connected || !chrome.runtime?.id) {
      return;
    }

    this.sessionTabId = getSessionTabIdFromLocation();
    chrome.runtime.onMessage.addListener(this.handleRuntimeMessage);
    this.connectPanelPort();
    void this.captureSessionTab().then(() => {
      this.updatePanelPortTab(this.sessionTabId);
      this.announcePanelOpened();
    });
    this.loadVoiceOptions();
    this.connected = true;
  }

  requestAnalysis(): void {
    this.clearSelectedViolation();
    this.analysisErrorSignal.set(null);
    this.startAnalysisLoading();
    this.sendRuntimeMessage({payload: this.auditSettings(), type: RuntimeMessageType.AnalysisRequested});
  }

  resetAnalysis(): void {
    this.finishAnalysisLoading();
    this.commitReaderMode(initialReaderMode);
    window.speechSynthesis?.cancel();
    this.activeNodeSignal.set(null);
    this.analysisErrorSignal.set(null);
    this.pageReportSignal.set(null);
    this.selectedViolationSignal.set(null);
    this.violationsSignal.set([]);
    this.violationFilterSettingsSignal.set(initialViolationFilterSettings);
    this.layerVisibilitySignal.set(initialLayerVisibility);
    this.sendRuntimeMessage({payload: {}, type: RuntimeMessageType.ResetRequested});
  }

  closePanelSession(): void {
    this.panelClosing = true;
    this.resetAnalysis();
    this.teardownVoiceOptionsListener();
    this.disconnectPanelPort();
  }

  setAuditStandard(standard: AuditStandard): void {
    if (this.auditSettings().standard === standard) {
      return;
    }

    this.auditSettingsSignal.set({standard});

    if (this.pageUrl()) {
      this.requestAnalysis();
    }
  }

  clearSelectedViolation(): void {
    this.selectedViolationSignal.set(null);
  }

  toggleSeverityFilter(severity: ViolationSeverity): void {
    this.violationFilterSettingsSignal.update(filterSettings => ({
      ...filterSettings,
      severity: {
        ...filterSettings.severity,
        [severity]: !filterSettings.severity[severity],
      },
    }));
    this.sendViolationFiltersChanged();
  }

  setViolationEngineFilter(engineFilter: ViolationEngineFilter): void {
    this.violationFilterSettingsSignal.update(filterSettings => ({
      ...filterSettings,
      engine: engineFilter,
    }));
    this.sendViolationFiltersChanged();
  }

  isFocusedGroup(group: ViolationGroup): boolean {
    const selectedViolation = this.selectedViolation();

    if (!selectedViolation) {
      return false;
    }

    return group.violationIds.includes(selectedViolation.violationId) || group.selectors.includes(selectedViolation.selector);
  }

  toggleReaderMode(): void {
    this.setReaderModeEnabled(!this.readerMode().enabled);
  }

  setReaderModeEnabled(enabled: boolean): void {
    const readerMode = this.readerMode();

    this.commitReaderMode({
      ...readerMode,
      enabled,
      inspectWithMouse: enabled ? false : readerMode.inspectWithMouse,
      rate: readerMode.rate ?? initialReaderMode.rate,
      speak: enabled ? readerMode.speak : false,
    });
  }

  toggleMouseInspection(): void {
    this.setMouseInspection(!this.readerMode().inspectWithMouse);
  }

  setPreviewMode(mode: PreviewMode): void {
    const readerMode = this.readerMode();

    this.commitReaderMode({
      ...readerMode,
      enabled: mode === 'reader',
      inspectWithMouse: mode === 'inspect',
      rate: readerMode.rate ?? initialReaderMode.rate,
      speak: mode === 'reader' ? readerMode.speak : false,
    });
  }

  setMouseInspection(inspectWithMouse: boolean): void {
    const readerMode = this.readerMode();

    this.commitReaderMode({
      ...readerMode,
      enabled: inspectWithMouse ? false : readerMode.enabled,
      inspectWithMouse,
      rate: readerMode.rate ?? initialReaderMode.rate,
      speak: inspectWithMouse ? false : readerMode.speak,
    });
  }

  toggleReaderSpeech(): void {
    this.setReaderSpeech(!this.readerMode().speak);
  }

  setReaderSpeech(speak: boolean): void {
    const readerMode = this.readerMode();

    this.commitReaderMode({
      ...readerMode,
      enabled: readerMode.enabled || speak,
      inspectWithMouse: readerMode.inspectWithMouse,
      rate: readerMode.rate ?? initialReaderMode.rate,
      speak,
    });
  }

  setReaderVoice(voiceURI: string): void {
    const readerMode = this.readerMode();
    const match = voiceURI ? this.voiceOptions().find(voice => voice.voiceURI === voiceURI) : undefined;

    this.commitReaderMode({
      ...readerMode,
      rate: readerMode.rate ?? initialReaderMode.rate,
      speak: readerMode.speak,
      voiceName: match?.name,
      voiceURI: voiceURI || undefined,
    });
  }

  setReaderRate(rate: number): void {
    const readerMode = this.readerMode();

    this.commitReaderMode({
      ...readerMode,
      rate,
      speak: readerMode.speak,
    });
  }

  toggleLayer(layerName: LayerName): void {
    const nextLayerVisibility = {
      ...this.layerVisibility(),
      [layerName]: !this.layerVisibility()[layerName],
    };

    this.setLayerVisibility(nextLayerVisibility);
  }

  setLayerVisibility(layerVisibility: LayerVisibility): void {
    this.layerVisibilitySignal.set({
      ...layerVisibility,
    });

    this.sendRuntimeMessage({
      payload: this.layerVisibility(),
      type: RuntimeMessageType.LayerVisibilityChanged,
    });
  }

  togglePageOverlay(): void {
    this.toggleLayer('pageOverlay');
  }

  private readonly handleRuntimeMessage = (message: RuntimeMessage): false => {
    if (message.type === RuntimeMessageType.ActiveTabChanged) {
      this.changeSessionTab(message.payload.tabId);

      return false;
    }

    if (message.tabId !== undefined && this.sessionTabId !== undefined && message.tabId !== this.sessionTabId) {
      return false;
    }

    switch (message.type) {
      case RuntimeMessageType.ActiveNodeChanged:
        this.activeNodeSignal.set(message.payload);
        break;
      case RuntimeMessageType.AnalysisFailed:
        this.finishAnalysisLoading();
        this.analysisErrorSignal.set(message.payload.message || 'Analysis failed.');
        break;
      case RuntimeMessageType.ContentReady:
        this.pageTitleSignal.set(message.payload.title || 'Untitled page');
        this.pageUrlSignal.set(message.payload.url);
        break;
      case RuntimeMessageType.ReportGenerated:
        if (message.payload.auditSettings.standard !== this.auditSettings().standard) {
          break;
        }

        this.finishAnalysisLoading();
        this.analysisErrorSignal.set(null);
        this.pageReportSignal.set(message.payload);
        this.violationsSignal.set(message.payload.violations);
        break;
      case RuntimeMessageType.ResetCompleted:
        this.finishAnalysisLoading();
        this.activeNodeSignal.set(null);
        break;
      case RuntimeMessageType.TabReloaded:
        this.resetLocalState();
        break;
      case RuntimeMessageType.ViolationSelected:
        this.selectedViolationSignal.set(message.payload);
        break;
    }

    return false;
  };

  private sendRuntimeMessage(message: RuntimeMessage): void {
    if (!chrome.runtime?.id) {
      return;
    }

    void this.sendScopedRuntimeMessage(message).catch(error => this.handleRuntimeDeliveryFailure(message, error));
  }

  private commitReaderMode(readerMode: ReaderModeSettings): void {
    this.readerModeSignal.set(readerMode);
    this.sendRuntimeMessage({payload: readerMode, type: RuntimeMessageType.ReaderModeChanged});
  }

  private sendViolationFiltersChanged(): void {
    this.sendRuntimeMessage({payload: this.violationFilterSettings(), type: RuntimeMessageType.ViolationFiltersChanged});
  }

  private changeSessionTab(tabId: number): void {
    if (this.sessionTabId === tabId) {
      this.announcePanelOpened();

      return;
    }

    this.sessionTabId = tabId;
    this.resetLocalState();
    this.updatePanelPortTab(tabId);
    this.announcePanelOpened();
  }

  private resetLocalState(): void {
    this.finishAnalysisLoading();
    this.activeNodeSignal.set(null);
    this.analysisErrorSignal.set(null);
    this.pageReportSignal.set(null);
    this.pageTitleSignal.set('Waiting for a page');
    this.pageUrlSignal.set('');
    this.readerModeSignal.set(initialReaderMode);
    this.selectedViolationSignal.set(null);
    this.violationsSignal.set([]);
    this.violationFilterSettingsSignal.set(initialViolationFilterSettings);
    this.layerVisibilitySignal.set(initialLayerVisibility);
  }

  private startAnalysisLoading(): void {
    clearTimeout(this.analysisLoadingTimeout);
    this.analysisLoadingSignal.set(true);
    this.analysisLoadingTimeout = setTimeout(() => {
      this.analysisLoadingSignal.set(false);
      this.analysisErrorSignal.set('Analysis timed out after 30 seconds. The page may be blocking extension scripts or the scan may be too expensive.');
    }, 30_000);
  }

  private finishAnalysisLoading(): void {
    clearTimeout(this.analysisLoadingTimeout);
    this.analysisLoadingTimeout = undefined;
    this.analysisLoadingSignal.set(false);
  }

  private async sendScopedRuntimeMessage(message: RuntimeMessage): Promise<void> {
    const tabId = await this.getSessionTabId();

    await chrome.runtime.sendMessage({...message, tabId});
  }

  private async getSessionTabId(): Promise<number | undefined> {
    if (this.sessionTabId !== undefined) {
      return this.sessionTabId;
    }

    await this.captureSessionTab();

    return this.sessionTabId;
  }

  private async captureSessionTab(): Promise<void> {
    if (this.sessionTabId !== undefined) {
      return;
    }

    const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true}).catch(() => []);

    if (activeTab?.id !== undefined) {
      this.sessionTabId = activeTab.id;
    }
  }

  private announcePanelOpened(): void {
    this.sendRuntimeMessage({payload: {}, type: RuntimeMessageType.PanelOpened});
  }

  private connectPanelPort(): chrome.runtime.Port | undefined {
    if (this.panelClosing || !chrome.runtime?.id) {
      return undefined;
    }

    this.panelPort = chrome.runtime.connect({name: sidePanelPortName});
    this.panelPort.onDisconnect.addListener(() => {
      this.panelPort = undefined;
    });

    return this.panelPort;
  }

  private disconnectPanelPort(): void {
    try {
      this.panelPort?.disconnect();
    } catch {
      // Chrome can disconnect the side-panel port before pagehide/beforeunload handlers finish.
    }

    this.panelPort = undefined;
  }

  private updatePanelPortTab(tabId: number | undefined): void {
    if (tabId === undefined || this.panelClosing) {
      return;
    }

    if (!this.panelPort) {
      this.connectPanelPort();
    }

    try {
      this.panelPort?.postMessage({tabId});
    } catch {
      this.panelPort = undefined;
      const reconnectedPort = this.connectPanelPort();

      if (!reconnectedPort) {
        return;
      }

      try {
        reconnectedPort.postMessage({tabId});
      } catch {
        this.panelPort = undefined;
      }
    }
  }

  private loadVoiceOptions(): void {
    const speechSynthesisApi = window.speechSynthesis;

    if (!speechSynthesisApi) {
      return;
    }

    const updateVoices = (): void => {
      const voices = speechSynthesisApi.getVoices()
        .map(voice => ({
          label: `${voice.name} (${voice.lang})`,
          lang: voice.lang,
          localService: voice.localService,
          name: voice.name,
          voiceURI: voice.voiceURI,
        }))
        .sort((first, second) => Number(second.localService) - Number(first.localService) || first.label.localeCompare(second.label));

      this.voiceOptionsSignal.set(voices);

      if (!this.readerMode().voiceURI) {
        const picked = pickDefaultReaderVoice(voices);

        if (picked) {
          const readerMode = this.readerMode();

          this.commitReaderMode({
            ...readerMode,
            voiceName: picked.voiceName,
            voiceURI: picked.voiceURI,
          });
        }
      }
    };

    updateVoices();
    this.teardownVoiceOptionsListener();
    speechSynthesisApi.addEventListener('voiceschanged', updateVoices);
    this.detachVoicesChangedListener = (): void => {
      speechSynthesisApi.removeEventListener('voiceschanged', updateVoices);
    };
  }

  private teardownVoiceOptionsListener(): void {
    this.detachVoicesChangedListener?.();
    this.detachVoicesChangedListener = undefined;
  }

  private handleRuntimeDeliveryFailure(message: RuntimeMessage, error: unknown): void {
    if (message.type !== RuntimeMessageType.AnalysisRequested) {
      return;
    }

    this.finishAnalysisLoading();
    this.analysisErrorSignal.set(`Unable to start analysis: ${getErrorMessage(error)}`);
  }

  private createReportMarkdown(): string {
    const report = this.pageReport();

    if (!report) {
      return '';
    }

    const violations = report.violations.map((violation, index) => [
      `${index + 1}. ${getReadableSummary(violation)}`,
      `   - Engine: ${formatViolationEngines(violation.sourceEngines ?? [violation.engine])}`,
      `   - Rule: ${violation.ruleId}`,
      `   - Severity: ${violation.severity}`,
      `   - Selector: ${violation.selector}`,
      violation.description ? `   - Detail: ${violation.description}` : '',
      violation.guidance ? `   - Guidance: ${getReadableGuidance(violation.guidance)}` : '',
      violation.helpUrl ? `   - Help: ${violation.helpUrl}` : '',
    ].filter(Boolean).join('\n'));

    const headings = report.headings.map(heading => `- H${heading.level}: ${heading.text || heading.selector}`);
    const landmarks = report.landmarks.map(landmark => `- ${landmark.role}${landmark.label ? `: ${landmark.label}` : ''}`);
    const engineStatuses = report.engineStatuses.map(status => [
      `- ${status.label}: ${status.status}`,
      `  - Violations: ${status.violations}`,
      `  - Duration: ${status.durationMs}ms`,
      status.error ? `  - Note: ${status.error}` : '',
    ].filter(Boolean).join('\n'));

    return [
      `# Accessibility Report: ${report.pageTitle}`,
      '',
      `URL: ${report.pageUrl}`,
      `Audit: ${formatAuditStandard(report.auditSettings.standard)}`,
      `Generated: ${new Date(report.generatedAt).toISOString()}`,
      '',
      '## Engine Status',
      '',
      engineStatuses.join('\n') || 'No engine status available.',
      '',
      `## Violations (${report.violations.length})`,
      '',
      violations.join('\n\n') || 'No violations found.',
      '',
      `## Headings (${report.headings.length})`,
      '',
      headings.join('\n') || 'No headings found.',
      '',
      `## Landmarks (${report.landmarks.length})`,
      '',
      landmarks.join('\n') || 'No landmarks found.',
    ].join('\n');
  }

  private createSeverityCounts(violations: readonly KodeGlassViolation[] = this.visibleViolations()): Record<ViolationSeverity, number> {
    return violations.reduce<Record<ViolationSeverity, number>>((counts, violation) => ({
      ...counts,
      [violation.severity]: counts[violation.severity] + 1,
    }), {critical: 0, info: 0, warning: 0});
  }

  private createViolationGroups(violations: readonly KodeGlassViolation[] = this.visibleViolations()): readonly ViolationGroup[] {
    const groups = violations.reduce((groupMap, violation) => {
      const title = getReadableSummary(violation);
      const id = `${violation.engine}:${violation.ruleId}`;
      const group = groupMap.get(id);

      groupMap.set(id, {
        count: (group?.count ?? 0) + 1,
        description: group?.description ?? violation.description,
        engineLabel: group?.engineLabel ?? formatViolationEngines(violation.sourceEngines ?? [violation.engine]),
        fix: group?.fix ?? createViolationFix(violation),
        guidance: group?.guidance ?? (violation.guidance ? getReadableGuidance(violation.guidance) : undefined),
        helpUrl: group?.helpUrl ?? violation.helpUrl,
        id,
        ruleId: violation.ruleId,
        selectors: [...new Set([...(group?.selectors ?? []), violation.selector])].slice(0, 5),
        severity: getHighestSeverity(group?.severity, violation.severity),
        summary: title,
        title,
        violationIds: [...new Set([...(group?.violationIds ?? []), violation.id])],
      });

      return groupMap;
    }, new Map<string, ViolationGroup>());

    return [...groups.values()].sort((first, second) => {
      const severityDelta = getSeverityRank(second.severity) - getSeverityRank(first.severity);

      return severityDelta || second.count - first.count || first.ruleId.localeCompare(second.ruleId);
    });
  }

  private createVisibleViolations(options: {readonly includeSeverityFilter: boolean} = {includeSeverityFilter: true}): readonly KodeGlassViolation[] {
    const selectedViolation = this.selectedViolation();
    const filterSettings = this.violationFilterSettings();

    return this.violations().filter(violation => {
      const matchesSelectedViolation = !selectedViolation
        || violation.id === selectedViolation.violationId
        || violation.selector === selectedViolation.selector;
      const matchesFilters = matchesViolationFilters(violation, filterSettings, options);

      return matchesSelectedViolation && matchesFilters;
    });
  }
}

function getSessionTabIdFromLocation(): number | undefined {
  const tabId = Number(new URLSearchParams(location.search).get('tabId'));

  return Number.isInteger(tabId) && tabId >= 0 ? tabId : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatAuditStandard(standard: AuditStandard): string {
  return ({
    'best-practice': 'Best practices',
    wcag2a: 'WCAG A',
    wcag2aa: 'WCAG AA',
    wcag2aaa: 'WCAG AAA',
  } as Record<AuditStandard, string>)[standard];
}

function formatViolationEngines(engines: readonly KodeGlassViolation['engine'][]): string {
  return engines.map(formatViolationEngine).join(' + ');
}

function formatViolationEngine(engine: KodeGlassViolation['engine']): string {
  return ({
    'axe-core': 'axe',
    'ibm-equal-access': 'IBM',
    manual: 'Manual',
    playwright: 'Playwright',
  } as Record<KodeGlassViolation['engine'], string>)[engine];
}

function getReadableSummary(violation: KodeGlassViolation): string {
  const summary = (violation.title ?? violation.summary).replace(/\s+/g, ' ').replace(/^Fix any of the following:\s*/i, '').trim();

  if (violation.ruleId === 'color-contrast') {
    return 'Text contrast is too low';
  }

  if (violation.ruleId === 'image-alt') {
    return 'Image is missing alternate text';
  }

  if (violation.ruleId === 'link-name') {
    return 'Link has no accessible name';
  }

  if (violation.ruleId === 'target-size') {
    return 'Tap target is too small';
  }

  return summary;
}

function getReadableGuidance(guidance: string): string {
  return guidance
    .replace(/\s+/g, ' ')
    .replace(/^Fix (?:any|all) of the following:\s*/i, '')
    .replace(/(?:Fix (?:any|all) of the following:)/gi, '')
    .trim();
}

function createViolationFix(violation: KodeGlassViolation): ViolationFix | undefined {
  if (!violation.guidance) {
    return undefined;
  }

  const guidance = getReadableGuidance(violation.guidance);

  if (!guidance) {
    return undefined;
  }

  return {
    segments: createInlineFixSegments(guidance),
    text: guidance,
  };
}

interface InlineChipRange {
  readonly end: number;
  readonly start: number;
  readonly text: string;
}

function createInlineFixSegments(guidance: string): readonly ViolationFixSegment[] {
  const ranges = [
    ...findCaptureRanges(guidance, /contrast of ([\d.]+)/gi),
    ...findWholeMatchRanges(guidance, /foreground color: [^,]+/gi),
    ...findWholeMatchRanges(guidance, /background color: [^,]+/gi),
    ...findWholeMatchRanges(guidance, /font size: [^,]+/gi),
    ...findWholeMatchRanges(guidance, /font weight: [^)]+/gi),
    ...findCaptureRanges(guidance, /Expected contrast ratio of ([\d.:]+)/gi),
    ...findWholeMatchRanges(guidance, /\d+(?:\.\d+)?\s*px(?:\s+by\s+\d+(?:\.\d+)?\s*px)?/gi),
    ...findWholeMatchRanges(guidance, /\b(?:aria-[\w-]+|alt|title|href|tabindex)\b/g),
    ...findWholeMatchRanges(guidance, /role="[^"]+"/g),
  ]
    .sort((first, second) => first.start - second.start)
    .filter((range, index, sortedRanges) => {
      const previousRange = sortedRanges[index - 1];

      return !previousRange || range.start >= previousRange.end;
    });

  if (!ranges.length) {
    return [{kind: 'text', text: guidance}];
  }

  const segments: ViolationFixSegment[] = [];
  let cursor = 0;

  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({kind: 'text', text: guidance.slice(cursor, range.start)});
    }

    segments.push({kind: 'chip', text: range.text});
    cursor = range.end;
  }

  if (cursor < guidance.length) {
    segments.push({kind: 'text', text: guidance.slice(cursor)});
  }

  return segments;
}

function findCaptureRanges(text: string, pattern: RegExp): readonly InlineChipRange[] {
  return [...text.matchAll(pattern)].flatMap(match => {
    const capture = match[1];

    if (!capture || match.index === undefined) {
      return [];
    }

    const matchStart = match.index;
    const captureStartInMatch = match[0].indexOf(capture);

    if (captureStartInMatch < 0) {
      return [];
    }

    const trimmedCapture = capture.trim();
    const leadingSpace = capture.length - capture.trimStart().length;
    const start = matchStart + captureStartInMatch + leadingSpace;

    return [{start, end: start + trimmedCapture.length, text: trimmedCapture}];
  });
}

function findWholeMatchRanges(text: string, pattern: RegExp): readonly InlineChipRange[] {
  return [...text.matchAll(pattern)].flatMap(match => {
    if (!match[0] || match.index === undefined) {
      return [];
    }

    return [{start: match.index, end: match.index + match[0].length, text: match[0]}];
  });
}

function getHighestSeverity(current: ViolationSeverity | undefined, next: ViolationSeverity): ViolationSeverity {
  if (!current) {
    return next;
  }

  return getSeverityRank(next) > getSeverityRank(current) ? next : current;
}

function getSeverityRank(severity: ViolationSeverity): number {
  return ({critical: 3, warning: 2, info: 1} as Record<ViolationSeverity, number>)[severity];
}
