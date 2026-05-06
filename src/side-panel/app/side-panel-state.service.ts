import {computed, Injectable, signal} from '@angular/core';
import type {
  AccessibilityReport,
  AccessibleNodeSummary,
  AuditSettings,
  AuditStandard,
  CaptureBoundsSnapshot,
  ComponentScope,
  ComponentScopeOption,
  EvidenceCaptureMode,
  JiraAuthSession,
  JiraIssueTypeOption,
  JiraProjectOption,
  KodeGlassViolation,
  LayerName,
  LayerVisibility,
  ReaderModeSettings,
  SeverityVisibility,
  ViolationEngineFilter,
  ViolationFilterSettings,
  ViolationSeverity,
} from '../../shared/accessibility-report';
import {
  RuntimeMessageType,
  type EvidenceImageCaptureResponse,
  type JiraAuthStatusResponse,
  type JiraConnectResponse,
  type JiraDisconnectResponse,
  type JiraIssueCreateResponse,
  type JiraIssueTypesResponse,
  type JiraProjectsResponse,
  type RuntimeMessage,
  type ViolationSelectedPayload,
} from '../../shared/messages';
import {pickDefaultReaderVoice} from '../../shared/reader-voice';
import {initialViolationFilterSettings, matchesViolationFilters} from '../../shared/violation-filters';
import {buildFilteredReportPdf, type PdfEvidenceImage} from './report-pdf';

declare const __ATLASSIAN_OAUTH_CLIENT_ID__: string;

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
  lockInteractions: false,
  rate: 0.92,
  speak: false,
};

const sidePanelPortName = 'kode-glass-side-panel';
const rollbackChunkTimesliceMs = 1000;
const rollbackMaxWindowMs = 5 * 60 * 1000;
const pdfFindingEvidenceLimit = 36;
const sidePanelCaptureCooldownMs = 650;
const jiraDefaultClientId = (__ATLASSIAN_OAUTH_CLIENT_ID__ || '').trim();

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
  private detachVoicesChangedListener: (() => void) | undefined;
  private lastEvidenceCaptureAt = 0;
  private navigationAnalysisTimeout: ReturnType<typeof setTimeout> | undefined;
  private videoRollbackChunks: VideoRollbackChunk[] = [];
  private videoRollbackRecorder: MediaRecorder | undefined;
  private videoRollbackStream: MediaStream | undefined;
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
  private readonly voiceOptionsSignal = signal<readonly ReaderVoiceOption[]>([]);
  private readonly violationsSignal = signal<readonly AccessibilityReport['violations'][number][]>([]);
  private readonly videoBufferEnabledSignal = signal(false);
  private readonly jiraSessionSignal = signal<JiraAuthSession>({status: 'disconnected'});
  private readonly jiraClientIdSignal = signal('');
  private readonly jiraProjectsSignal = signal<readonly JiraProjectOption[]>([]);
  private readonly jiraIssueTypesSignal = signal<readonly JiraIssueTypeOption[]>([]);
  private readonly jiraProjectKeySignal = signal('');
  private readonly jiraIssueTypeIdSignal = signal('');
  private readonly jiraPendingSignal = signal(false);
  private readonly pdfExportPendingSignal = signal(false);

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
  readonly voiceOptions = this.voiceOptionsSignal.asReadonly();
  readonly violations = this.violationsSignal.asReadonly();
  readonly videoBufferEnabled = this.videoBufferEnabledSignal.asReadonly();
  readonly jiraSession = this.jiraSessionSignal.asReadonly();
  readonly jiraClientId = this.jiraClientIdSignal.asReadonly();
  readonly jiraProjects = this.jiraProjectsSignal.asReadonly();
  readonly jiraIssueTypes = this.jiraIssueTypesSignal.asReadonly();
  readonly jiraProjectKey = this.jiraProjectKeySignal.asReadonly();
  readonly jiraIssueTypeId = this.jiraIssueTypeIdSignal.asReadonly();
  readonly jiraPending = this.jiraPendingSignal.asReadonly();
  readonly pdfExportPending = this.pdfExportPendingSignal.asReadonly();
  readonly jiraConnected = computed(() => this.jiraSession().status === 'connected');
  readonly jiraOauthConfigured = computed(() => Boolean(this.resolveConfiguredJiraClientId()));
  readonly availableSeverityCounts = computed(() => this.createSeverityCounts(this.createVisibleViolations({includeSeverityFilter: false})));
  readonly engineStatuses = computed(() => this.pageReport()?.engineStatuses ?? []);
  readonly hasEngineWarnings = computed(() => this.engineStatuses().some(status => status.status !== 'completed'));
  readonly headings = computed(() => this.pageReport()?.headings ?? []);
  readonly landmarks = computed(() => this.pageReport()?.landmarks ?? []);
  readonly visibleViolations = computed(() => this.createVisibleViolations());
  readonly hasViolations = computed(() => this.violations().length > 0);
  readonly hasVisibleViolations = computed(() => this.visibleViolations().length > 0);
  readonly hasStructure = computed(() => this.headings().length > 0 || this.landmarks().length > 0);
  readonly reportSeverityCounts = computed(() => this.createSeverityCounts(this.visibleViolations()));
  readonly severityCounts = computed(() => this.createSeverityCounts());
  readonly totalHeadings = computed(() => this.headings().length);
  readonly totalLandmarks = computed(() => this.landmarks().length);
  readonly totalViolations = computed(() => this.violations().length);
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
    void this.initializeJiraState();
    this.loadVoiceOptions();
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
    window.speechSynthesis?.cancel();
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
    this.jiraProjectKeySignal.set(projectKey);
    this.jiraIssueTypeIdSignal.set('');
    this.jiraIssueTypesSignal.set([]);
    void this.refreshJiraIssueTypes(projectKey);
  }

  setJiraIssueTypeId(issueTypeId: string): void {
    this.jiraIssueTypeIdSignal.set(issueTypeId);
  }

  async connectJira(): Promise<void> {
    const clientId = this.resolveConfiguredJiraClientId();
    const lockedSessionTabId = this.sessionTabId;

    if (!clientId) {
      this.analysisErrorSignal.set('Jira OAuth client ID is missing. Set ATLASSIAN_OAUTH_CLIENT_ID and rebuild the extension.');

      return;
    }

    this.jiraPendingSignal.set(true);
    this.analysisErrorSignal.set(null);
    this.jiraSessionSignal.set({status: 'connecting'});

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {clientId},
        tabId: await this.getSessionTabId(),
        type: RuntimeMessageType.JiraConnectRequested,
      }) as JiraConnectResponse;

      if (!response.ok || !response.session) {
        this.jiraSessionSignal.set({error: response.error, status: 'disconnected'});
        this.analysisErrorSignal.set(response.error ?? 'Failed to connect Jira.');

        return;
      }

      this.jiraSessionSignal.set(response.session);
      await this.refreshJiraProjects();
    } catch (error) {
      this.jiraSessionSignal.set({error: getErrorMessage(error), status: 'disconnected'});
      this.analysisErrorSignal.set(`Failed to connect Jira: ${getErrorMessage(error)}`);
    } finally {
      if (lockedSessionTabId !== undefined && this.sessionTabId !== lockedSessionTabId) {
        this.sessionTabId = lockedSessionTabId;
        this.updatePanelPortTab(lockedSessionTabId);
        this.announcePanelOpened();
      }
      this.jiraPendingSignal.set(false);
    }
  }

  async disconnectJira(): Promise<void> {
    this.jiraPendingSignal.set(true);
    this.analysisErrorSignal.set(null);

    try {
      const response = await chrome.runtime.sendMessage({
        payload: {},
        tabId: await this.getSessionTabId(),
        type: RuntimeMessageType.JiraDisconnectRequested,
      }) as JiraDisconnectResponse;

      if (!response.ok) {
        this.analysisErrorSignal.set(response.error ?? 'Failed to disconnect Jira.');

        return;
      }

      this.jiraSessionSignal.set({status: 'disconnected'});
      this.jiraProjectsSignal.set([]);
      this.jiraIssueTypesSignal.set([]);
      this.jiraProjectKeySignal.set('');
      this.jiraIssueTypeIdSignal.set('');
    } catch (error) {
      this.analysisErrorSignal.set(`Failed to disconnect Jira: ${getErrorMessage(error)}`);
    } finally {
      this.jiraPendingSignal.set(false);
    }
  }

  async createIssueFromCurrentContext(): Promise<void> {
    if (!this.jiraConnected()) {
      this.analysisErrorSignal.set('Connect Jira before creating a task.');

      return;
    }

    const projectKey = this.jiraProjectKey();
    const issueTypeId = this.jiraIssueTypeId();

    if (!projectKey || !issueTypeId) {
      this.analysisErrorSignal.set('Select a Jira project and issue type first.');

      return;
    }

    this.jiraPendingSignal.set(true);
    this.analysisErrorSignal.set(null);

    try {
      const evidenceImageData = await this.captureEvidenceImageData('full-screen');
      const summary = this.buildJiraIssueSummary();
      const description = this.buildJiraIssueDescription();
      const response = await chrome.runtime.sendMessage({
        payload: {
          description,
          evidenceImageDataUrls: evidenceImageData ? [evidenceImageData] : [],
          issueTypeId,
          projectKey,
          summary,
        },
        tabId: await this.getSessionTabId(),
        type: RuntimeMessageType.JiraIssueCreateRequested,
      }) as JiraIssueCreateResponse;

      if (!response.ok || !response.issueKey) {
        this.analysisErrorSignal.set(response.error ?? 'Unable to create Jira task.');

        return;
      }

      this.analysisErrorSignal.set(`Created Jira task ${response.issueKey}.`);
    } catch (error) {
      this.analysisErrorSignal.set(`Unable to create Jira task: ${getErrorMessage(error)}`);
    } finally {
      this.jiraPendingSignal.set(false);
    }
  }

  async exportPdfReport(): Promise<void> {
    const report = this.pageReport();

    if (!report || this.pdfExportPending()) {
      return;
    }

    this.analysisErrorSignal.set(null);
    this.pdfExportPendingSignal.set(true);

    try {
      const visibleViolations = this.visibleViolations();
      const evidenceImages: PdfEvidenceImage[] = [];
      const fullScreenImage = await this.captureEvidenceImageData('full-screen', {silent: true, throttled: true});

      if (fullScreenImage) {
        evidenceImages.push({caption: 'Full page snapshot', dataUrl: fullScreenImage});
      }

      const findingEvidence = await this.captureFindingEvidenceImages(visibleViolations, pdfFindingEvidenceLimit);
      evidenceImages.push(...findingEvidence);

      const pdfBlob = await buildFilteredReportPdf({
        createdAt: Date.now(),
        evidenceImages,
        focusedViolationId: this.selectedViolation()?.violationId,
        report,
        selectedComponentLabel: this.selectedComponentScope()?.label,
        violationFilters: this.violationFilterSettings(),
        visibleViolations,
      });
      const objectUrl = URL.createObjectURL(pdfBlob);

      try {
        await chrome.downloads.download({
          filename: `kode-glass-report-${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`,
          saveAs: true,
          url: objectUrl,
        });
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      }
    } catch (error) {
      this.analysisErrorSignal.set(`Unable to export PDF report: ${getErrorMessage(error)}`);
    } finally {
      this.pdfExportPendingSignal.set(false);
    }
  }

  private async captureFindingEvidenceImages(
    violations: readonly KodeGlassViolation[],
    maxImages: number,
  ): Promise<readonly PdfEvidenceImage[]> {
    if (!violations.length || maxImages <= 0) {
      return [];
    }

    const previousFocus = this.selectedViolation();
    const evidenceImages: PdfEvidenceImage[] = [];
    const rankedViolations = selectEvidenceViolations(violations, maxImages);

    try {
      for (const [index, violation] of rankedViolations.entries()) {
        this.sendRuntimeMessage({
          payload: {selector: violation.selector, violationId: violation.id},
          type: RuntimeMessageType.ViolationFocusChanged,
        });
        await wait(250);
        const elementSnapshot = await this.captureEvidenceImageData('element', {silent: true, throttled: true});

        if (!elementSnapshot) {
          continue;
        }

        evidenceImages.push({
          caption: `${index + 1}. ${getReadableSummary(violation)} (${violation.severity})`,
          dataUrl: elementSnapshot,
          violationId: violation.id,
        });
      }
    } finally {
      this.sendRuntimeMessage({payload: previousFocus, type: RuntimeMessageType.ViolationFocusChanged});
    }

    return evidenceImages;
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
    this.readerModeSignal.set(readerMode);
    this.sendRuntimeMessage({payload: readerMode, type: RuntimeMessageType.ReaderModeChanged});
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

  private async initializeJiraState(): Promise<void> {
    this.jiraClientIdSignal.set(jiraDefaultClientId);
    const status = await chrome.runtime.sendMessage({
      payload: {},
      tabId: await this.getSessionTabId(),
      type: RuntimeMessageType.JiraAuthStatusRequested,
    }) as JiraAuthStatusResponse;
    this.jiraSessionSignal.set(status.session);

    if (status.session.status === 'connected') {
      await this.refreshJiraProjects();
    }
  }

  private resolveConfiguredJiraClientId(): string {
    return this.jiraClientId().trim() || jiraDefaultClientId.trim();
  }

  private async refreshJiraProjects(): Promise<void> {
    const response = await chrome.runtime.sendMessage({
      payload: {},
      tabId: await this.getSessionTabId(),
      type: RuntimeMessageType.JiraProjectsRequested,
    }) as JiraProjectsResponse;

    if (!response.ok) {
      this.analysisErrorSignal.set(response.error ?? 'Unable to load Jira projects.');

      return;
    }

    this.jiraProjectsSignal.set(response.projects);

    if (!this.jiraProjectKey() && response.projects.length) {
      const firstProject = response.projects[0];
      this.jiraProjectKeySignal.set(firstProject!.key);
      await this.refreshJiraIssueTypes(firstProject!.key);
    }
  }

  private async refreshJiraIssueTypes(projectKey: string): Promise<void> {
    if (!projectKey) {
      return;
    }

    const response = await chrome.runtime.sendMessage({
      payload: {projectKey},
      tabId: await this.getSessionTabId(),
      type: RuntimeMessageType.JiraIssueTypesRequested,
    }) as JiraIssueTypesResponse;

    if (!response.ok) {
      this.analysisErrorSignal.set(response.error ?? 'Unable to load Jira issue types.');

      return;
    }

    this.jiraIssueTypesSignal.set(response.issueTypes);

    if (!this.jiraIssueTypeId() && response.issueTypes.length) {
      const firstIssueType = response.issueTypes[0];
      this.jiraIssueTypeIdSignal.set(firstIssueType!.id);
    }
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

  private buildJiraIssueSummary(): string {
    const selectedViolation = this.selectedViolation();
    const visibleViolationCount = this.visibleViolations().length;

    if (selectedViolation) {
      const violation = this.violations().find(item => item.id === selectedViolation.violationId);

      if (violation) {
        return `[A11y] ${getReadableSummary(violation)} (${violation.severity})`;
      }
    }

    return `[A11y] ${visibleViolationCount} filtered findings on ${this.pageTitle() || 'page'}`;
  }

  private buildJiraIssueDescription(): string {
    const report = this.pageReport();
    const filters = this.violationFilterSettings();
    const selectedComponent = this.selectedComponentScope()?.label ?? 'All components';
    const selectedViolation = this.selectedViolation();
    const visibleViolations = this.visibleViolations();

    if (!report) {
      return 'No analysis report is currently available.';
    }

    const findings = visibleViolations
      .slice(0, 20)
      .map((violation, index) => {
        return `${index + 1}. ${getReadableSummary(violation)}
- Severity: ${violation.severity}
- Rule: ${violation.ruleId}
- Selector: ${violation.selector}`;
      })
      .join('\n\n');

    return `Page: ${report.pageTitle}
URL: ${report.pageUrl}
Generated: ${new Date(report.generatedAt).toISOString()}

Applied filters:
- Engine: ${filters.engine}
- Severity: ${Object.entries(filters.severity).filter(([, enabled]) => enabled).map(([severity]) => severity).join(', ') || 'none'}
- Component: ${selectedComponent}
- Focused violation: ${selectedViolation?.violationId ?? 'none'}

Findings (${visibleViolations.length} of ${report.violations.length}):
${findings || 'No findings in current filter scope.'}`;
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
}

function getSessionTabIdFromLocation(): number | undefined {
  const tabId = Number(new URLSearchParams(location.search).get('tabId'));

  return Number.isInteger(tabId) && tabId >= 0 ? tabId : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function selectEvidenceViolations(violations: readonly KodeGlassViolation[], maxImages: number): readonly KodeGlassViolation[] {
  const rankedViolations = [...violations].sort((first, second) => {
    const severityDelta = getSeverityRank(second.severity) - getSeverityRank(first.severity);

    return severityDelta || first.ruleId.localeCompare(second.ruleId) || first.selector.localeCompare(second.selector);
  });
  const selected: KodeGlassViolation[] = [];
  const selectedIds = new Set<string>();
  const componentKeys = new Set<string>();
  const ruleKeys = new Set<string>();

  for (const violation of rankedViolations) {
    const componentKey = getEvidenceComponentKey(violation);

    if (!componentKey || componentKeys.has(componentKey)) {
      continue;
    }

    selected.push(violation);
    selectedIds.add(violation.id);
    componentKeys.add(componentKey);

    if (selected.length >= maxImages) {
      return selected;
    }
  }

  for (const violation of rankedViolations) {
    const ruleKey = `${formatViolationEngines(violation.sourceEngines ?? [violation.engine])}:${violation.ruleId}`;

    if (selectedIds.has(violation.id) || ruleKeys.has(ruleKey)) {
      continue;
    }

    selected.push(violation);
    selectedIds.add(violation.id);
    ruleKeys.add(ruleKey);

    if (selected.length >= maxImages) {
      return selected;
    }
  }

  for (const violation of rankedViolations) {
    if (selectedIds.has(violation.id)) {
      continue;
    }

    selected.push(violation);

    if (selected.length >= maxImages) {
      return selected;
    }
  }

  return selected;
}

function getEvidenceComponentKey(violation: KodeGlassViolation): string | undefined {
  const fallbackSelector = violation.selector.split('>').slice(0, 4).join('>').trim();
  const key = violation.componentScope?.tagName
    ?? violation.componentScope?.selector
    ?? fallbackSelector;

  return key || undefined;
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

async function wait(durationMs: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, durationMs));
}

