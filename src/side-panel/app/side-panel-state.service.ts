import {computed, Injectable, signal} from '@angular/core';
import {getErrorMessage} from '../../shared/error-boundary';
import type {
  AccessibilityReport,
  AccessibleNodeSummary,
  AuditSettings,
  AuditStandard,
  CaptureBoundsSnapshot,
  ComponentScope,
  ComponentScopeOption,
  EvidenceCaptureMode,
  KodeGlassViolation,
  LayerName,
  LayerVisibility,
  NarratorCommandProfile,
  NarratorInterruptPolicy,
  NarratorKeyboardMode,
  NarratorVerbosity,
  ReaderModeSettings,
  ViolationEngineFilter,
  ViolationFilterSettings,
  ViolationSeverity,
  WcagCoverageItem,
  WcagCoverageStatus,
} from '../../shared/accessibility-report';
import {
  RuntimeMessageType,
  type EvidenceImageCaptureResponse,
  type RuntimeMessage,
  type ViolationSelectedPayload,
} from '../../shared/messages';
import {initialViolationFilterSettings, matchesViolationFilters} from '../../shared/violation-filters';
import {createWcagCoverage} from '../../shared/wcag-coverage';
import {
  type CoveragePrincipleSummary,
  type PreviewMode,
  type ViolationGroup,
  createViolationFix,
  formatAuditStandard,
  formatCoverageStatus,
  formatViolationEngines,
  getHighestSeverity,
  getReadableGuidance,
  getReadableSummary,
  getSeverityRank,
  wait,
} from './violation-grouping';
import {JiraService} from './jira.service';
import {VoiceService} from './voice.service';
import {PdfService} from './pdf.service';

export type {CoveragePrincipleSummary, PreviewMode, ViolationFix, ViolationFixSegment, ViolationGroup} from './violation-grouping';
export type {ReaderVoiceOption} from './voice.service';

export interface JiraIssueComposerOptions {
  readonly includeAppliedFilters: boolean;
  readonly includeEvidenceImage: boolean;
  readonly includeFilteredFindings: boolean;
  readonly includeFocusedViolation: boolean;
  readonly includePageMetadata: boolean;
  readonly includePdfReportGuidance: boolean;
  readonly includeReportMarkdown: boolean;
  readonly includeRollbackVideoGuidance: boolean;
  readonly includeStructureSnapshot: boolean;
  readonly maxFindings: number;
  readonly rollbackWindowMinutes: number;
}

export interface JiraIssueDraft {
  readonly canCreate: boolean;
  readonly description: string;
  readonly summary: string;
}

export interface JiraIssueRelationOptions {
  readonly linkIssueKey?: string;
  readonly linkTypeName?: string;
  readonly parentIssueKey?: string;
}

const initialLayerVisibility: LayerVisibility = {
  coverage: false,
  errors: true,
  focusPath: false,
  landmarks: false,
  pageOverlay: true,
};

const initialAuditSettings: AuditSettings = {
  standard: 'wcag2aa',
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

const sidePanelPortName = 'kode-glass-side-panel';
const rollbackChunkTimesliceMs = 1000;
const rollbackMaxWindowMs = 5 * 60 * 1000;
const sidePanelCaptureCooldownMs = 650;

interface VideoRollbackChunk {
  readonly blob: Blob;
  readonly recordedAt: number;
}

@Injectable({providedIn: 'root'})
export class SidePanelStateService {
  private connected = false;
  private panelClosing = false;
  private panelPort: chrome.runtime.Port | undefined;
  private sessionTabId: number | undefined;
  private analysisLoadingTimeout: ReturnType<typeof setTimeout> | undefined;
  private lastEvidenceCaptureAt = 0;
  private navigationAnalysisTimeout: ReturnType<typeof setTimeout> | undefined;
  private videoRollbackChunks: VideoRollbackChunk[] = [];
  private videoRollbackRecorder: MediaRecorder | undefined;
  private videoRollbackStream: MediaStream | undefined;
  private suspendedLayerVisibility: LayerVisibility | null = null;
  private readonly activeNodeSignal = signal<AccessibleNodeSummary | null>(null);
  private readonly analysisErrorSignal = signal<string | null>(null);
  private readonly analysisLoadingSignal = signal(false);
  private readonly evidenceCapturePendingSignal = signal(false);
  private readonly auditSettingsSignal = signal<AuditSettings>(initialAuditSettings);
  private readonly layerVisibilitySignal = signal<LayerVisibility>(initialLayerVisibility);
  private readonly pageReportSignal = signal<AccessibilityReport | null>(null);
  private readonly pageTitleSignal = signal('Waiting for a page');
  private readonly pageUrlSignal = signal('');
  private readonly readerModeSignal = signal<ReaderModeSettings>(initialReaderMode);
  private readonly componentInventorySignal = signal<readonly ComponentScopeOption[]>([]);
  private readonly selectedComponentScopeSignal = signal<ComponentScope | null>(null);
  private readonly selectedViolationSignal = signal<ViolationSelectedPayload | null>(null);
  private readonly violationFilterSettingsSignal = signal<ViolationFilterSettings>(initialViolationFilterSettings);
  private readonly violationsSignal = signal<readonly AccessibilityReport['violations'][number][]>([]);
  private readonly videoBufferEnabledSignal = signal(false);
  private readonly jiraService = new JiraService({
    getSessionTabId: () => this.getSessionTabId(),
    setError: error => this.analysisErrorSignal.set(error),
  });
  private readonly pdfService = new PdfService({
    getPageReport: () => this.pageReport(),
    getVisibleViolations: () => this.visibleViolations(),
    getSelectedViolation: () => this.selectedViolation(),
    getSelectedComponentScope: () => this.selectedComponentScope(),
    getViolationFilterSettings: () => this.violationFilterSettings(),
    captureEvidenceImageData: (mode, options) => this.captureEvidenceImageData(mode, options),
    sendRuntimeMessage: message => this.sendRuntimeMessage(message),
    setError: error => this.analysisErrorSignal.set(error),
  });
  private readonly voiceService = new VoiceService({
    getReaderMode: () => this.readerMode(),
    commitReaderMode: readerMode => this.commitReaderMode(readerMode),
  });

  readonly activeNode = this.activeNodeSignal.asReadonly();
  readonly analysisError = this.analysisErrorSignal.asReadonly();
  readonly analysisLoading = this.analysisLoadingSignal.asReadonly();
  readonly evidenceCapturePending = this.evidenceCapturePendingSignal.asReadonly();
  readonly auditSettings = this.auditSettingsSignal.asReadonly();
  readonly layerVisibility = this.layerVisibilitySignal.asReadonly();
  readonly pageReport = this.pageReportSignal.asReadonly();
  readonly pageTitle = this.pageTitleSignal.asReadonly();
  readonly pageUrl = this.pageUrlSignal.asReadonly();
  readonly readerMode = this.readerModeSignal.asReadonly();
  readonly componentInventory = this.componentInventorySignal.asReadonly();
  readonly selectedComponentScope = this.selectedComponentScopeSignal.asReadonly();
  readonly selectedViolation = this.selectedViolationSignal.asReadonly();
  readonly severityVisibility = computed(() => this.violationFilterSettings().severity);
  readonly violationEngineFilter = computed(() => this.violationFilterSettings().engine);
  readonly violationFilterSettings = this.violationFilterSettingsSignal.asReadonly();
  readonly voiceOptions = this.voiceService.voiceOptions;
  readonly violations = this.violationsSignal.asReadonly();
  readonly videoBufferEnabled = this.videoBufferEnabledSignal.asReadonly();
  readonly jiraSession = this.jiraService.session;
  readonly jiraClientId = this.jiraService.clientId;
  readonly jiraProjects = this.jiraService.projects;
  readonly jiraIssueTypes = this.jiraService.issueTypes;
  readonly jiraProjectKey = this.jiraService.projectKey;
  readonly jiraIssueTypeId = this.jiraService.issueTypeId;
  readonly jiraPending = this.jiraService.pending;
  readonly pdfExportPending = this.pdfService.pdfExportPending;
  readonly jiraConnected = this.jiraService.connected;
  readonly jiraOauthConfigured = this.jiraService.oauthConfigured;
  readonly availableSeverityCounts = computed(() => this.createSeverityCounts(this.createVisibleViolations({includeSeverityFilter: false})));
  readonly engineStatuses = computed(() => this.pageReport()?.engineStatuses ?? []);
  readonly coverage = computed(() => this.createSourceFilteredCoverage());
  readonly coverageStatusCounts = computed(() => this.createCoverageStatusCounts());
  readonly coverageCompletionPercent = computed(() => this.createCoverageCompletionPercent());
  readonly coveragePrinciples = computed(() => this.createCoveragePrincipleSummaries());
  readonly failedCoverage = computed(() => this.coverage().filter(item => item.status === 'failed'));
  readonly manualReviewCoverage = computed(() => this.coverage().filter(item => item.status === 'needs-manual-review'));
  readonly notTestedCoverage = computed(() => this.coverage().filter(item => item.status === 'not-tested'));
  readonly passedAutomatedCoverage = computed(() => this.coverage().filter(item => item.status === 'passed-automated'));
  readonly hasEngineWarnings = computed(() => this.engineStatuses().some(status => status.status !== 'completed'));
  readonly headings = computed(() => this.pageReport()?.headings ?? []);
  readonly landmarks = computed(() => this.pageReport()?.landmarks ?? []);
  readonly scanScopes = computed(() => this.pageReport()?.scanScopes ?? []);
  readonly overlayScanScopes = computed(() => this.scanScopes().filter(scope => scope.kind === 'overlay'));
  readonly visibleViolations = computed(() => this.createVisibleViolations());
  readonly hasViolations = computed(() => this.violations().length > 0);
  readonly hasVisibleViolations = computed(() => this.visibleViolations().length > 0);
  readonly hasStructure = computed(() => this.headings().length > 0 || this.landmarks().length > 0);
  readonly reportSeverityCounts = computed(() => this.createSeverityCounts(this.visibleViolations()));
  readonly severityCounts = computed(() => this.createSeverityCounts());
  readonly totalHeadings = computed(() => this.headings().length);
  readonly totalLandmarks = computed(() => this.landmarks().length);
  readonly totalOverlayScopes = computed(() => this.overlayScanScopes().length);
  readonly totalViolations = computed(() => this.createVisibleViolations({includeSeverityFilter: false}).length);
  readonly violationGroups = computed(() => this.createViolationGroups(this.visibleViolations()));
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
      this.ensureVideoBufferEnabled(true);
    });
    void this.jiraService.initializeState();
    this.voiceService.loadVoiceOptions();
    this.connected = true;
  }

  requestAnalysis(): void {
    this.clearNavigationAnalysisTimeout();
    this.clearSelectedComponentScope();
    this.clearSelectedViolation();
    this.analysisErrorSignal.set(null);
    this.startAnalysisLoading();
    this.sendRuntimeMessage({payload: this.auditSettings(), type: RuntimeMessageType.AnalysisRequested});
  }

  resetAnalysis(): void {
    this.clearNavigationAnalysisTimeout();
    this.finishAnalysisLoading();
    this.commitReaderMode(initialReaderMode);
    this.voiceService.cancelSpeech();
    this.activeNodeSignal.set(null);
    this.analysisErrorSignal.set(null);
    this.pageReportSignal.set(null);
    this.componentInventorySignal.set([]);
    this.selectedComponentScopeSignal.set(null);
    this.selectedViolationSignal.set(null);
    this.violationsSignal.set([]);
    this.violationFilterSettingsSignal.set(initialViolationFilterSettings);
    this.layerVisibilitySignal.set(initialLayerVisibility);
    this.sendRuntimeMessage({payload: {}, type: RuntimeMessageType.ResetRequested});
  }

  closePanelSession(): void {
    this.panelClosing = true;
    this.resetAnalysis();
    this.stopLocalVideoBuffer();
    this.videoBufferEnabledSignal.set(false);
    this.voiceService.teardownListener();
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

  setSelectedComponentScope(componentScope: ComponentScope | null): void {
    this.selectedComponentScopeSignal.set(componentScope);
    this.selectedViolationSignal.set(null);
    this.sendRuntimeMessage({payload: null, type: RuntimeMessageType.ViolationFocusChanged});
    this.sendRuntimeMessage({payload: componentScope, type: RuntimeMessageType.ComponentScopeChanged});
  }

  clearSelectedComponentScope(): void {
    this.setSelectedComponentScope(null);
  }

  setSelectedViolation(selectedViolation: ViolationSelectedPayload | null): void {
    this.selectedViolationSignal.set(selectedViolation);
    this.sendRuntimeMessage({payload: selectedViolation, type: RuntimeMessageType.ViolationFocusChanged});
  }

  clearSelectedViolation(): void {
    this.setSelectedViolation(null);
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
    this.clearSelectedViolationIfFilteredOut();
    this.sendViolationFiltersChanged();
  }

  isFocusedGroup(group: ViolationGroup): boolean {
    const selectedViolation = this.selectedViolation();

    if (selectedViolation) {
      return group.violationIds.includes(selectedViolation.violationId);
    }

    const selectedComponentScope = this.selectedComponentScope();

    if (!selectedComponentScope) {
      return false;
    }

    return this.violations().some(
      violation =>
        group.violationIds.includes(violation.id)
        && violation.componentScope?.tagName === selectedComponentScope.tagName,
    );
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
      lockInteractions: enabled ? false : readerMode.lockInteractions,
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
      lockInteractions: mode === 'inspect' ? readerMode.lockInteractions : false,
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
      lockInteractions: inspectWithMouse ? readerMode.lockInteractions : false,
      rate: readerMode.rate ?? initialReaderMode.rate,
      speak: inspectWithMouse ? false : readerMode.speak,
    });
  }

  setInspectInteractionLock(lockInteractions: boolean): void {
    const readerMode = this.readerMode();

    this.commitReaderMode({
      ...readerMode,
      lockInteractions: readerMode.inspectWithMouse ? lockInteractions : false,
      rate: readerMode.rate ?? initialReaderMode.rate,
      speak: readerMode.speak,
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
      inspectWithMouse: speak ? false : readerMode.inspectWithMouse,
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
      interruptPolicy: readerMode.interruptPolicy ?? initialReaderMode.interruptPolicy,
      keyboardMode: readerMode.keyboardMode ?? initialReaderMode.keyboardMode,
      rate,
      speak: readerMode.speak,
      verbosity: readerMode.verbosity ?? initialReaderMode.verbosity,
    });
  }

  setNarratorKeyboardMode(keyboardMode: NarratorKeyboardMode): void {
    const readerMode = this.readerMode();

    this.commitReaderMode({
      ...readerMode,
      interruptPolicy: readerMode.interruptPolicy ?? initialReaderMode.interruptPolicy,
      keyboardMode,
      narratorEngineEnabled: readerMode.narratorEngineEnabled ?? initialReaderMode.narratorEngineEnabled,
      rate: readerMode.rate ?? initialReaderMode.rate,
      speak: readerMode.speak,
      verbosity: readerMode.verbosity ?? initialReaderMode.verbosity,
    });
  }

  setNarratorCommandProfile(commandProfile: NarratorCommandProfile): void {
    const readerMode = this.readerMode();

    this.commitReaderMode({
      ...readerMode,
      commandProfile,
      interruptPolicy: readerMode.interruptPolicy ?? initialReaderMode.interruptPolicy,
      keyboardMode: readerMode.keyboardMode ?? initialReaderMode.keyboardMode,
      narratorEngineEnabled: readerMode.narratorEngineEnabled ?? initialReaderMode.narratorEngineEnabled,
      rate: readerMode.rate ?? initialReaderMode.rate,
      speak: readerMode.speak,
      verbosity: readerMode.verbosity ?? initialReaderMode.verbosity,
    });
  }

  setNarratorVerbosity(verbosity: NarratorVerbosity): void {
    const readerMode = this.readerMode();

    this.commitReaderMode({
      ...readerMode,
      interruptPolicy: readerMode.interruptPolicy ?? initialReaderMode.interruptPolicy,
      keyboardMode: readerMode.keyboardMode ?? initialReaderMode.keyboardMode,
      narratorEngineEnabled: readerMode.narratorEngineEnabled ?? initialReaderMode.narratorEngineEnabled,
      rate: readerMode.rate ?? initialReaderMode.rate,
      speak: readerMode.speak,
      verbosity,
    });
  }

  setNarratorInterruptPolicy(interruptPolicy: NarratorInterruptPolicy): void {
    const readerMode = this.readerMode();

    this.commitReaderMode({
      ...readerMode,
      interruptPolicy,
      keyboardMode: readerMode.keyboardMode ?? initialReaderMode.keyboardMode,
      narratorEngineEnabled: readerMode.narratorEngineEnabled ?? initialReaderMode.narratorEngineEnabled,
      rate: readerMode.rate ?? initialReaderMode.rate,
      speak: readerMode.speak,
      verbosity: readerMode.verbosity ?? initialReaderMode.verbosity,
    });
  }

  setNarratorEngineEnabled(narratorEngineEnabled: boolean): void {
    const readerMode = this.readerMode();

    this.commitReaderMode({
      ...readerMode,
      interruptPolicy: readerMode.interruptPolicy ?? initialReaderMode.interruptPolicy,
      keyboardMode: readerMode.keyboardMode ?? initialReaderMode.keyboardMode,
      narratorEngineEnabled,
      rate: readerMode.rate ?? initialReaderMode.rate,
      speak: readerMode.speak,
      verbosity: readerMode.verbosity ?? initialReaderMode.verbosity,
    });
  }

  async captureEvidenceImage(mode: EvidenceCaptureMode): Promise<void> {
    if (this.evidenceCapturePending()) {
      return;
    }

    this.evidenceCapturePendingSignal.set(true);
    this.analysisErrorSignal.set(null);

    try {
      const dataUrl = await this.captureEvidenceImageData(mode);

      if (!dataUrl) {
        return;
      }

      await chrome.downloads.download({
        filename: `kode-glass-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
        saveAs: true,
        url: dataUrl,
      });
    } catch (error) {
      this.analysisErrorSignal.set(`Unable to capture image evidence: ${getErrorMessage(error)}`);
    } finally {
      this.evidenceCapturePendingSignal.set(false);
    }
  }

  async setVideoBufferEnabled(enabled: boolean, options: {readonly silent?: boolean} = {}): Promise<void> {
    if (!options.silent) {
      this.analysisErrorSignal.set(null);
    }

    try {
      if (!enabled) {
        this.stopLocalVideoBuffer();
        this.videoBufferEnabledSignal.set(false);

        return;
      }

      const tabId = await this.getSessionTabId();

      if (tabId === undefined) {
        if (!options.silent) {
          this.analysisErrorSignal.set('No active tab available for video buffering.');
        }

        return;
      }

      await this.startLocalVideoBuffer(tabId);
      this.videoBufferEnabledSignal.set(true);
    } catch (error) {
      if (!options.silent) {
        this.analysisErrorSignal.set(`Unable to update video buffer: ${getErrorMessage(error)}`);
      }
      this.stopLocalVideoBuffer();
      this.videoBufferEnabledSignal.set(false);
    }
  }

  async downloadVideoRollback(minutes: number): Promise<void> {
    this.analysisErrorSignal.set(null);

    try {
      if (!this.videoBufferEnabled()) {
        this.analysisErrorSignal.set('Enable video buffering before exporting rollback clips.');

        return;
      }

      const cutoff = Date.now() - minutes * 60_000;
      const chunks = this.videoRollbackChunks.filter(chunk => chunk.recordedAt >= cutoff).map(chunk => chunk.blob);

      if (!chunks.length) {
        this.analysisErrorSignal.set('No buffered footage available for the selected rollback window.');

        return;
      }

      const mimeType = this.videoRollbackRecorder?.mimeType || 'video/webm';
      const blob = new Blob(chunks, {type: mimeType});
      const objectUrl = URL.createObjectURL(blob);

      try {
        await chrome.downloads.download({
          filename: `kode-glass-rollback-${minutes}m-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`,
          saveAs: true,
          url: objectUrl,
        });
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      }
    } catch (error) {
      this.analysisErrorSignal.set(`Unable to export rollback video: ${getErrorMessage(error)}`);
    }
  }

  setJiraProjectKey(projectKey: string): void {
    this.jiraService.setProjectKey(projectKey);
  }

  setJiraIssueTypeId(issueTypeId: string): void {
    this.jiraService.setIssueTypeId(issueTypeId);
  }

  async connectJira(): Promise<void> {
    const lockedSessionTabId = this.sessionTabId;

    await this.jiraService.connect();

    if (lockedSessionTabId !== undefined && this.sessionTabId !== lockedSessionTabId) {
      this.sessionTabId = lockedSessionTabId;
      this.updatePanelPortTab(lockedSessionTabId);
      this.announcePanelOpened();
    }
  }

  async disconnectJira(): Promise<void> {
    await this.jiraService.disconnect();
  }

  async createIssueFromCurrentContext(): Promise<void> {
    if (!this.jiraConnected()) {
      this.analysisErrorSignal.set('Connect Jira before creating a task.');

      return;
    }

    const draft = this.buildJiraIssueDraft({
      includeAppliedFilters: true,
      includeEvidenceImage: true,
      includeFilteredFindings: true,
      includeFocusedViolation: true,
      includePageMetadata: true,
      includePdfReportGuidance: false,
      includeReportMarkdown: false,
      includeRollbackVideoGuidance: false,
      includeStructureSnapshot: false,
      maxFindings: 20,
      rollbackWindowMinutes: 1,
    });
    const evidenceImageData = await this.captureEvidenceImageData('full-screen');

    await this.jiraService.createIssue({
      description: draft.description,
      evidenceImageDataUrls: evidenceImageData ? [evidenceImageData] : [],
      issueTypeId: this.jiraIssueTypeId(),
      projectKey: this.jiraProjectKey(),
      summary: draft.summary,
    });
  }

  async createIssueFromDraft(options: JiraIssueComposerOptions, relations: JiraIssueRelationOptions = {}): Promise<void> {
    if (!this.jiraConnected()) {
      this.analysisErrorSignal.set('Connect Jira before creating a task.');

      return;
    }

    const draft = this.buildJiraIssueDraft(options);

    if (!draft.canCreate) {
      this.analysisErrorSignal.set('Select a Jira project and issue type before creating a task.');

      return;
    }

    const evidenceImageData = options.includeEvidenceImage ? await this.captureEvidenceImageData('full-screen') : null;

    await this.jiraService.createIssue({
      description: draft.description,
      evidenceImageDataUrls: evidenceImageData ? [evidenceImageData] : [],
      issueTypeId: this.jiraIssueTypeId(),
      linkIssueKey: normalizeJiraIssueKey(relations.linkIssueKey),
      linkTypeName: relations.linkTypeName?.trim() || undefined,
      parentIssueKey: normalizeJiraIssueKey(relations.parentIssueKey),
      projectKey: this.jiraProjectKey(),
      summary: draft.summary,
    });
  }

  async buildJiraPreviewAssets(options: JiraIssueComposerOptions): Promise<{
    readonly imageDataUrl: string | null;
    readonly videoPreviewUrl: string | null;
  }> {
    const imageDataUrl = options.includeEvidenceImage
      ? await this.captureEvidenceImageData('full-screen', {silent: true, throttled: true})
      : null;
    const rollbackVideoBlob = options.includeRollbackVideoGuidance ? this.createRollbackVideoBlob(options.rollbackWindowMinutes) : null;

    return {
      imageDataUrl,
      videoPreviewUrl: rollbackVideoBlob ? URL.createObjectURL(rollbackVideoBlob) : null,
    };
  }

  buildJiraIssueDraft(options: JiraIssueComposerOptions): JiraIssueDraft {
    return {
      canCreate: Boolean(this.jiraConnected() && this.jiraProjectKey() && this.jiraIssueTypeId()),
      description: this.buildJiraIssueDescription(options),
      summary: this.buildJiraIssueSummary(options),
    };
  }

  async exportPdfReport(): Promise<void> {
    return this.pdfService.exportReport();
  }

  toggleLayer(layerName: LayerName): void {
    const nextLayerVisibility = {
      ...this.layerVisibility(),
      [layerName]: !this.layerVisibility()[layerName],
    };

    if (layerName === 'coverage' && nextLayerVisibility.coverage) {
      nextLayerVisibility.errors = false;
    }

    if (layerName === 'errors' && nextLayerVisibility.errors) {
      nextLayerVisibility.coverage = false;
    }

    this.setLayerVisibility(nextLayerVisibility);
  }

  setLayerVisibility(layerVisibility: LayerVisibility): void {
    const nextLayerVisibility = {
      ...layerVisibility,
    };
    const readerMode = this.readerMode();
    const shouldDisablePreview = this.hasAnalysisOverlayVisible(nextLayerVisibility)
      && (readerMode.enabled || readerMode.inspectWithMouse);

    if (shouldDisablePreview) {
      this.suspendedLayerVisibility = null;
      this.commitReaderMode({
        ...readerMode,
        enabled: false,
        inspectWithMouse: false,
        lockInteractions: false,
        rate: readerMode.rate ?? initialReaderMode.rate,
        speak: false,
      });
    }

    this.applyLayerVisibility(nextLayerVisibility);
  }

  togglePageOverlay(): void {
    this.toggleLayer('pageOverlay');
  }

  private readonly handleRuntimeMessage = (message: RuntimeMessage): false => {
    if (message.type === RuntimeMessageType.ActiveTabChanged) {
      if (this.jiraPending()) {
        return false;
      }

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
      case RuntimeMessageType.ComponentInventoryChanged:
        this.componentInventorySignal.set(message.payload);
        break;
      case RuntimeMessageType.ComponentScopeChanged:
        this.selectedComponentScopeSignal.set(message.payload);
        this.selectedViolationSignal.set(null);
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
        const shouldReanalyze = this.pageReport() !== null || this.analysisLoading() || this.navigationAnalysisTimeout !== undefined;
        this.resetLocalState();
        this.ensureVideoBufferEnabled(true);

        if (shouldReanalyze) {
          this.scheduleNavigationAnalysis();
        }
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
    if (readerMode.enabled || readerMode.inspectWithMouse) {
      const layerVisibility = this.layerVisibility();

      if (layerVisibility.pageOverlay) {
        if (!this.suspendedLayerVisibility) {
          this.suspendedLayerVisibility = {
            ...layerVisibility,
          };
        }

        this.applyLayerVisibility({
          ...layerVisibility,
          pageOverlay: false,
        });
      }
    } else if (this.suspendedLayerVisibility) {
      this.applyLayerVisibility(this.suspendedLayerVisibility);
      this.suspendedLayerVisibility = null;
    }

    this.readerModeSignal.set(readerMode);
    this.sendRuntimeMessage({payload: readerMode, type: RuntimeMessageType.ReaderModeChanged});
  }

  private applyLayerVisibility(layerVisibility: LayerVisibility): void {
    this.layerVisibilitySignal.set({
      ...layerVisibility,
    });

    this.sendRuntimeMessage({
      payload: this.layerVisibility(),
      type: RuntimeMessageType.LayerVisibilityChanged,
    });
  }

  private hasAnalysisOverlayVisible(layerVisibility: LayerVisibility): boolean {
    return layerVisibility.pageOverlay && (
      layerVisibility.coverage
      || layerVisibility.errors
      || layerVisibility.focusPath
      || layerVisibility.landmarks
    );
  }

  private sendViolationFiltersChanged(): void {
    this.sendRuntimeMessage({payload: this.violationFilterSettings(), type: RuntimeMessageType.ViolationFiltersChanged});
  }

  private changeSessionTab(tabId: number): void {
    if (this.sessionTabId === tabId) {
      this.announcePanelOpened();
      this.ensureVideoBufferEnabled(true);

      return;
    }

    this.sessionTabId = tabId;
    this.resetLocalState();
    this.updatePanelPortTab(tabId);
    this.announcePanelOpened();
    this.ensureVideoBufferEnabled(true);
  }

  private resetLocalState(): void {
    this.clearNavigationAnalysisTimeout();
    this.finishAnalysisLoading();
    this.activeNodeSignal.set(null);
    this.analysisErrorSignal.set(null);
    this.pageReportSignal.set(null);
    this.pageTitleSignal.set('Waiting for a page');
    this.pageUrlSignal.set('');
    this.readerModeSignal.set(initialReaderMode);
    this.componentInventorySignal.set([]);
    this.selectedComponentScopeSignal.set(null);
    this.selectedViolationSignal.set(null);
    this.violationsSignal.set([]);
    this.stopLocalVideoBuffer();
    this.videoBufferEnabledSignal.set(false);
    this.violationFilterSettingsSignal.set(initialViolationFilterSettings);
    this.layerVisibilitySignal.set(initialLayerVisibility);
    this.suspendedLayerVisibility = null;
  }

  private scheduleNavigationAnalysis(): void {
    this.clearNavigationAnalysisTimeout();
    this.navigationAnalysisTimeout = setTimeout(() => {
      this.navigationAnalysisTimeout = undefined;
      this.requestAnalysis();
    }, 350);
  }

  private clearNavigationAnalysisTimeout(): void {
    clearTimeout(this.navigationAnalysisTimeout);
    this.navigationAnalysisTimeout = undefined;
  }

  private ensureVideoBufferEnabled(silent: boolean): void {
    if (this.panelClosing || this.videoBufferEnabled()) {
      return;
    }

    void this.setVideoBufferEnabled(true, {silent});
  }

  private async captureEvidenceImageData(
    mode: EvidenceCaptureMode,
    options: {readonly silent?: boolean; readonly throttled?: boolean} = {},
  ): Promise<string | null> {
    const tabId = await this.getSessionTabId();

    if (options.throttled) {
      await this.waitForEvidenceCaptureSlot();
    }

    let response: EvidenceImageCaptureResponse;

    try {
      response = await chrome.runtime.sendMessage({
        payload: {mode},
        tabId,
        type: RuntimeMessageType.EvidenceImageCaptureRequested,
      }) as EvidenceImageCaptureResponse;
    } catch (error) {
      if (!options.silent) {
        this.analysisErrorSignal.set(`Unable to capture image evidence: ${getErrorMessage(error)}`);
      }

      return null;
    }

    if (!response.ok || !response.screenshotDataUrl) {
      if (!options.silent) {
        this.analysisErrorSignal.set(response.error ?? 'Unable to capture image evidence.');
      }

      return null;
    }

    if (!response.snapshot) {
      return response.screenshotDataUrl;
    }

    return cropScreenshotToBounds(response.screenshotDataUrl, response.snapshot);
  }

  private async waitForEvidenceCaptureSlot(): Promise<void> {
    const elapsedMs = Date.now() - this.lastEvidenceCaptureAt;
    const delayMs = Math.max(0, sidePanelCaptureCooldownMs - elapsedMs);

    if (delayMs > 0) {
      await wait(delayMs);
    }

    this.lastEvidenceCaptureAt = Date.now();
  }

  private buildJiraIssueSummary(options: JiraIssueComposerOptions): string {
    const selectedViolation = this.selectedViolation();
    const visibleViolationCount = this.visibleViolations().length;

    if (options.includeFocusedViolation && selectedViolation) {
      const violation = this.violations().find(item => item.id === selectedViolation.violationId);

      if (violation) {
        return `[Kode Glass] ${getReadableSummary(violation)} (${violation.severity})`;
      }
    }

    return `[Kode Glass] ${visibleViolationCount} filtered findings on ${this.pageTitle() || 'page'}`;
  }

  private buildJiraIssueDescription(options: JiraIssueComposerOptions): string {
    const report = this.pageReport();
    const filters = this.violationFilterSettings();
    const selectedComponent = this.selectedComponentScope()?.label ?? 'All components';
    const selectedViolation = this.selectedViolation();
    const visibleViolations = this.visibleViolations();

    if (!report) {
      return 'No analysis report is currently available.';
    }

    const maxFindings = Math.max(1, Math.min(100, Math.trunc(options.maxFindings || 1)));
    const findings = visibleViolations
      .slice(0, maxFindings)
      .map((violation, index) => `${index + 1}. ${getReadableSummary(violation)}
- Severity: ${violation.severity}
- Rule: ${violation.ruleId}
 - Selector: ${violation.selector}`)
      .join('\n\n');

    const selectedSeverityLabels = Object.entries(filters.severity)
      .filter(([, enabled]) => enabled)
      .map(([severity]) => severity)
      .join(', ') || 'none';
    const structureSnapshot = options.includeStructureSnapshot
      ? [
        '',
        `Structure snapshot: ${report.headings.length} headings, ${report.landmarks.length} landmarks`,
      ].join('\n')
      : '';
    const rollbackVideoNote = options.includeRollbackVideoGuidance
      ? [
        '',
        `Rollback video guidance: include a ${options.rollbackWindowMinutes} minute rollback clip from the extension if needed.`,
      ].join('\n')
      : '';
    const pdfNote = options.includePdfReportGuidance
      ? [
        '',
        'PDF report guidance: generate and attach the PDF report from Capture & export before sharing the Jira task.',
      ].join('\n')
      : '';
    const reportMarkdownSection = options.includeReportMarkdown
      ? [
        '',
        'Report markdown snapshot:',
        truncateForJira(this.createReportMarkdown(), 10_000),
      ].join('\n')
      : '';

    return `${options.includePageMetadata ? `Page: ${report.pageTitle}
URL: ${report.pageUrl}
Generated: ${new Date(report.generatedAt).toISOString()}
` : ''}

${options.includeAppliedFilters ? `Applied filters:
- Engine: ${filters.engine}
- Severity: ${selectedSeverityLabels}
- Component: ${selectedComponent}
- Focused violation: ${options.includeFocusedViolation ? selectedViolation?.violationId ?? 'none' : 'excluded'}
` : ''}

${options.includeFilteredFindings ? `Findings (${visibleViolations.length} of ${report.violations.length}, max ${maxFindings}):
${findings || 'No findings in current filter scope.'}` : 'Findings list excluded by reporter settings.'}${structureSnapshot}${rollbackVideoNote}${pdfNote}${reportMarkdownSection}`;
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

  private async startLocalVideoBuffer(_tabId: number): Promise<void> {
    if (!chrome.tabCapture?.capture) {
      throw new Error('Tab capture is not available in this browser context.');
    }

    this.stopLocalVideoBuffer();
    const stream = await new Promise<MediaStream>((resolve, reject) => {
      chrome.tabCapture.capture({
        audio: false,
        video: true,
      }, capturedStream => {
        if (chrome.runtime.lastError || !capturedStream) {
          reject(new Error(chrome.runtime.lastError?.message ?? 'Failed to start tab capture.'));

          return;
        }

        resolve(capturedStream);
      });
    });
    const mimeType = getPreferredVideoMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, {mimeType}) : new MediaRecorder(stream);

    this.videoRollbackChunks = [];
    this.videoRollbackStream = stream;
    this.videoRollbackRecorder = recorder;
    recorder.addEventListener('dataavailable', event => {
      if (!event.data || event.data.size === 0) {
        return;
      }

      this.videoRollbackChunks.push({blob: event.data, recordedAt: Date.now()});
      this.pruneVideoRollbackChunks();
    });
    recorder.addEventListener('stop', () => {
      stream.getTracks().forEach(track => track.stop());
    });
    recorder.start(rollbackChunkTimesliceMs);
  }

  private stopLocalVideoBuffer(): void {
    if (this.videoRollbackRecorder && this.videoRollbackRecorder.state !== 'inactive') {
      this.videoRollbackRecorder.stop();
    }

    this.videoRollbackStream?.getTracks().forEach(track => track.stop());
    this.videoRollbackRecorder = undefined;
    this.videoRollbackStream = undefined;
    this.videoRollbackChunks = [];
  }

  private pruneVideoRollbackChunks(): void {
    const cutoff = Date.now() - rollbackMaxWindowMs;
    const firstIndexInWindow = this.videoRollbackChunks.findIndex(chunk => chunk.recordedAt >= cutoff);

    if (firstIndexInWindow <= 0) {
      return;
    }

    this.videoRollbackChunks.splice(0, firstIndexInWindow);
  }

  private createRollbackVideoBlob(minutes: number): Blob | null {
    if (!this.videoBufferEnabled()) {
      return null;
    }

    const cutoff = Date.now() - minutes * 60_000;
    const chunks = this.videoRollbackChunks.filter(chunk => chunk.recordedAt >= cutoff).map(chunk => chunk.blob);

    if (!chunks.length) {
      return null;
    }

    const mimeType = this.videoRollbackRecorder?.mimeType || 'video/webm';
    return new Blob(chunks, {type: mimeType});
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

    const filteredViolations = this.createVisibleViolations();
    const selectedSeverities = Object.entries(this.violationFilterSettings().severity)
      .filter(([, enabled]) => enabled)
      .map(([severity]) => severity)
      .join(', ') || 'none';
    const selectedComponentScope = this.selectedComponentScope()?.label ?? 'All components';
    const selectedViolation = this.selectedViolation();
    const violations = filteredViolations.map((violation, index) => [
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
    const scanScopes = report.scanScopes.map(scope => `- ${scope.label}: ${scope.elementCount} elements (${scope.selector})`);
    const filteredCoverage = this.coverage();
    const coverage = filteredCoverage.map(item => [
      `- ${item.criterionId} ${item.title} (${item.level}): ${formatCoverageStatus(item.status)}`,
      item.relatedRuleIds.length ? `  - Rules: ${item.relatedRuleIds.join(', ')}` : '',
      item.violationIds.length ? `  - Findings: ${item.violationIds.length}` : '',
    ].filter(Boolean).join('\n'));
    const engineStatuses = report.engineStatuses.map(status => [
      `- ${status.label}: ${status.status}`,
      `  - Violations: ${status.violations}`,
      status.scopes ? `  - Scan scopes: ${status.scopes}` : '',
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
      `## Scan Coverage (${report.scanScopes.length})`,
      '',
      scanScopes.join('\n') || 'No scan scope data available.',
      '',
      `## WCAG Coverage (${filteredCoverage.length})`,
      '',
      coverage.join('\n') || 'No WCAG coverage data available.',
      '',
      '## Applied Filters',
      '',
      `- Engine: ${this.violationFilterSettings().engine}`,
      `- Severity: ${selectedSeverities}`,
      `- Component: ${selectedComponentScope}`,
      `- Focused violation: ${selectedViolation?.violationId ?? 'none'}`,
      '',
      `## Violations (${filteredViolations.length} of ${report.violations.length})`,
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

  private createCoverageStatusCounts(): Record<WcagCoverageStatus, number> {
    return this.coverage().reduce<Record<WcagCoverageStatus, number>>((counts, item) => ({
      ...counts,
      [item.status]: counts[item.status] + 1,
    }), {'failed': 0, 'needs-manual-review': 0, 'not-tested': 0, 'passed-automated': 0});
  }

  private createCoverageCompletionPercent(): number {
    const coverage = this.coverage();

    if (!coverage.length) {
      return 0;
    }

    const resolvedCount = coverage.filter(item => item.status === 'failed' || item.status === 'passed-automated').length;

    return Math.round((resolvedCount / coverage.length) * 100);
  }

  private createCoveragePrincipleSummaries(): readonly CoveragePrincipleSummary[] {
    const principles: readonly WcagCoverageItem['principle'][] = ['Perceivable', 'Operable', 'Understandable', 'Robust'];

    return principles.map(principle => {
      const items = this.coverage().filter(item => item.principle === principle);

      return {
        failed: items.filter(item => item.status === 'failed').length,
        manual: items.filter(item => item.status === 'needs-manual-review').length,
        passed: items.filter(item => item.status === 'passed-automated').length,
        principle,
        total: items.length,
      };
    }).filter(summary => summary.total > 0);
  }

  private createSourceFilteredCoverage(): readonly WcagCoverageItem[] {
    const report = this.pageReport();

    if (!report) {
      return [];
    }

    return createWcagCoverage(
      report.auditSettings,
      this.createEngineFilteredViolations(),
      this.createEngineFilteredStatuses(),
    );
  }

  private createEngineFilteredViolations(): readonly KodeGlassViolation[] {
    const filterSettings = this.violationFilterSettings();

    return this.violations().filter(violation => matchesViolationFilters(violation, filterSettings, {includeSeverityFilter: false}));
  }

  private createEngineFilteredStatuses(): AccessibilityReport['engineStatuses'] {
    const engineFilter = this.violationFilterSettings().engine;

    if (engineFilter === 'both') {
      return this.engineStatuses();
    }

    const engine = engineFilter === 'axe' ? 'axe-core' : 'ibm-equal-access';

    return this.engineStatuses().filter(status => status.engine === engine);
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
    const selectedComponentScope = this.selectedComponentScope();
    const filterSettings = this.violationFilterSettings();

    return this.violations().filter(violation => {
      const matchesSelectedViolation = !selectedViolation
        || violation.id === selectedViolation.violationId
        || violation.selector === selectedViolation.selector;
      const matchesSelectedComponent = !selectedComponentScope
        || violation.componentScope?.tagName === selectedComponentScope.tagName;
      const matchesFilters = matchesViolationFilters(violation, filterSettings, options);

      return matchesSelectedViolation && matchesSelectedComponent && matchesFilters;
    });
  }

  private clearSelectedViolationIfFilteredOut(): void {
    const selectedViolation = this.selectedViolation();

    if (!selectedViolation) {
      return;
    }

    const violation = this.violations().find(item => item.id === selectedViolation.violationId || item.selector === selectedViolation.selector);

    if (!violation || matchesViolationFilters(violation, this.violationFilterSettings(), {includeSeverityFilter: false})) {
      return;
    }

    this.setSelectedViolation(null);
  }
}

function getSessionTabIdFromLocation(): number | undefined {
  const tabId = Number(new URLSearchParams(location.search).get('tabId'));

  return Number.isInteger(tabId) && tabId >= 0 ? tabId : undefined;
}

async function cropScreenshotToBounds(dataUrl: string, snapshot: CaptureBoundsSnapshot): Promise<string> {
  const image = await loadImage(dataUrl);
  const scaleX = image.naturalWidth / snapshot.viewportWidth;
  const scaleY = image.naturalHeight / snapshot.viewportHeight;
  const sourceX = Math.max(0, Math.min(image.naturalWidth - 1, Math.round((snapshot.bounds.x - snapshot.scrollX) * scaleX)));
  const sourceY = Math.max(0, Math.min(image.naturalHeight - 1, Math.round((snapshot.bounds.y - snapshot.scrollY) * scaleY)));
  const sourceWidth = Math.max(1, Math.min(image.naturalWidth - sourceX, Math.round(snapshot.bounds.width * scaleX)));
  const sourceHeight = Math.max(1, Math.min(image.naturalHeight - sourceY, Math.round(snapshot.bounds.height * scaleY)));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    return dataUrl;
  }

  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);

  return canvas.toDataURL('image/png');
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load screenshot image for cropping.'));
    image.src = dataUrl;
  });
}

function getPreferredVideoMimeType(): string | undefined {
  const preferredMimeTypes = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  return preferredMimeTypes.find(mimeType => MediaRecorder.isTypeSupported(mimeType));
}

function truncateForJira(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) {
    return value;
  }

  return `${value.slice(0, maxCharacters).trimEnd()}\n\n... [truncated ${value.length - maxCharacters} characters]`;
}

function normalizeJiraIssueKey(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim().toUpperCase();
  return trimmedValue ? trimmedValue : undefined;
}

