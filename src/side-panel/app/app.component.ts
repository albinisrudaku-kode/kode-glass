import {ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {TuiAppearance, TuiButton, TuiFilterByInputPipe, TuiIcon, TuiLoader, TuiRoot, TuiSlider} from '@taiga-ui/core';
import {TuiAccordion, TuiBadge, TuiButtonGroup, TuiChevron, TuiComboBox, TuiDataListWrapper, TuiFilter, TuiSwitch} from '@taiga-ui/kit';
import type {
  AuditStandard,
  EvidenceCaptureMode,
  LayerName,
  NarratorCommandProfile,
  NarratorInterruptPolicy,
  NarratorKeyboardMode,
  NarratorVerbosity,
  ViolationEngineFilter,
  ViolationSeverity,
} from '../../shared/accessibility-report';
import {matchesViolationFilters} from '../../shared/violation-filters';
import {
  type JiraIssueComposerOptions,
  type JiraIssueRelationOptions,
  type PreviewMode,
  type ViolationGroup,
} from './side-panel-state.service';
import {PanelFacadeService} from './state/panel-facade.service';
import {SettingsJiraAccountComponent} from './features/settings-jira-account/settings-jira-account.component';
import {JiraComposerComponent} from './features/jira-composer/jira-composer.component';
import {ViolationsPanelComponent} from './features/violations-panel/violations-panel.component';
import {
  type AuditStandardItem,
  type ComponentScopeSelectItem,
  type LayerFilterItem,
  type NarratorModeOption,
  type NarratorShortcutItem,
  type PanelTab,
  type PanelTabItem,
  type PanelView,
  type RollbackMinutes,
  type SeverityFilterItem,
  type Theme,
  type ViolationEngineFilterItem,
} from './shared/panel-ui.types';
import {getFormValue, getStoredTheme} from './shared/form.utils';
import {formatComponentScopeLabel, isExcludedComponentTag} from './shared/component-scope.utils';

@Component({
  selector: 'kode-glass-root',
  imports: [
    FormsModule,
    TuiAccordion,
    TuiAppearance,
    TuiBadge,
    TuiButton,
    TuiButtonGroup,
    TuiChevron,
    TuiComboBox,
    TuiDataListWrapper,
    TuiFilter,
    TuiFilterByInputPipe,
    TuiIcon,
    TuiLoader,
    TuiRoot,
    TuiSlider,
    TuiSwitch,
    SettingsJiraAccountComponent,
    JiraComposerComponent,
    ViolationsPanelComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly isMac = /mac/i.test(navigator.platform);
  private jiraPreviewVideoObjectUrl: string | null = null;
  private lastFocusedViolationId: string | null = null;
  private readonly dismissedAnalysisError = signal<string | null>(null);
  protected readonly state = inject(PanelFacadeService);
  protected readonly activeTab = signal<PanelTab>('violations');
  protected readonly expandedViolationGroups = signal<ReadonlySet<string>>(new Set());
  protected readonly evidenceCaptureMode = signal<EvidenceCaptureMode>('full-screen');
  protected readonly rollbackMinutes = signal<RollbackMinutes>(1);
  protected readonly jiraIncludeAppliedFilters = signal(true);
  protected readonly jiraIncludeEvidenceImage = signal(true);
  protected readonly jiraIncludeFilteredFindings = signal(true);
  protected readonly jiraIncludeFocusedViolation = signal(true);
  protected readonly jiraIncludePageMetadata = signal(true);
  protected readonly jiraIncludePdfReportGuidance = signal(true);
  protected readonly jiraIncludeReportMarkdown = signal(false);
  protected readonly jiraIncludeRollbackVideoGuidance = signal(false);
  protected readonly jiraIncludeStructureSnapshot = signal(true);
  protected readonly jiraLinkIssueKey = signal('');
  protected readonly jiraLinkTypeName = signal('Relates');
  protected readonly jiraMaxFindings = signal(20);
  protected readonly jiraParentIssueKey = signal('');
  protected readonly jiraPreviewImageUrl = signal<string | null>(null);
  protected readonly jiraPreviewVideoUrl = signal<string | null>(null);
  protected readonly jiraPreviewPending = signal(false);
  protected readonly theme = signal<Theme>(getStoredTheme());
  protected readonly panelView = signal<PanelView>('main');
  protected readonly themeIcon = computed(() => this.theme() === 'light' ? '@tui.sun' : '@tui.moon');
  protected readonly themeLabel = computed(() => this.theme() === 'light' ? 'Light' : 'Dark');
  protected readonly themeToggleLabel = computed(() => `Switch to ${this.theme() === 'light' ? 'dark' : 'light'} theme`);
  protected readonly settingsToggleLabel = computed(() => this.panelView() === 'settings' ? 'Close settings' : 'Open settings');
  protected readonly jiraToggleLabel = computed(() => this.panelView() === 'jira' ? 'Close Jira settings' : 'Open Jira settings');
  protected readonly jiraComposerOptions = computed<JiraIssueComposerOptions>(() => ({
    includeAppliedFilters: this.jiraIncludeAppliedFilters(),
    includeEvidenceImage: this.jiraIncludeEvidenceImage(),
    includeFilteredFindings: this.jiraIncludeFilteredFindings(),
    includeFocusedViolation: this.jiraIncludeFocusedViolation(),
    includePageMetadata: this.jiraIncludePageMetadata(),
    includePdfReportGuidance: this.jiraIncludePdfReportGuidance(),
    includeReportMarkdown: this.jiraIncludeReportMarkdown(),
    includeRollbackVideoGuidance: this.jiraIncludeRollbackVideoGuidance(),
    includeStructureSnapshot: this.jiraIncludeStructureSnapshot(),
    maxFindings: this.jiraMaxFindings(),
    rollbackWindowMinutes: this.rollbackMinutes(),
  }));
  protected readonly jiraRelationOptions = computed<JiraIssueRelationOptions>(() => ({
    linkIssueKey: this.jiraLinkIssueKey().trim() || undefined,
    linkTypeName: this.jiraLinkTypeName().trim() || undefined,
    parentIssueKey: this.jiraParentIssueKey().trim() || undefined,
  }));
  protected readonly jiraLinkTypes: readonly string[] = ['Relates', 'Blocks', 'Is blocked by', 'Duplicates', 'Is duplicated by'];
  protected readonly jiraIssueDraft = computed(() => this.state.buildJiraIssueDraft(this.jiraComposerOptions()));
  protected readonly visibleAnalysisError = computed(() => {
    const analysisError = this.state.analysisError();

    if (!analysisError) {
      return null;
    }

    return this.dismissedAnalysisError() === analysisError ? null : analysisError;
  });
  protected readonly previewMode = computed<PreviewMode>(() => {
    const readerMode = this.state.readerMode();

    if (readerMode.enabled) {
      return 'reader';
    }

    return readerMode.inspectWithMouse ? 'inspect' : 'off';
  });
  protected readonly layerFilterItems: readonly LayerFilterItem[] = ['Errors', 'Landmarks', 'Focus'];
  protected readonly selectedLayerFilters = computed(() => {
    const visibility = this.state.layerVisibility();
    const selectedFilters: LayerFilterItem[] = [];

    if (visibility.errors) {
      selectedFilters.push('Errors');
    }

    if (visibility.landmarks) {
      selectedFilters.push('Landmarks');
    }

    if (visibility.focusPath) {
      selectedFilters.push('Focus');
    }

    return selectedFilters;
  });
  protected readonly voiceComboItems = computed(() => ['System default', ...this.state.voiceOptions().map(voice => voice.label)]);
  protected readonly selectedVoiceLabel = computed(() => {
    const voiceURI = this.state.readerMode().voiceURI;

    return voiceURI ? this.state.voiceOptions().find(voice => voice.voiceURI === voiceURI)?.label ?? 'System default' : 'System default';
  });
  protected readonly componentScopeItems = computed<readonly ComponentScopeSelectItem[]>(() => {
    const selectedViolation = this.state.selectedViolation();
    const filteredViolations = this.state.violations().filter(violation => {
      const matchesFocusedViolation = !selectedViolation
        || violation.id === selectedViolation.violationId
        || violation.selector === selectedViolation.selector;

      return matchesFocusedViolation && matchesViolationFilters(violation, this.state.violationFilterSettings());
    });
    const violationCountByTagName = filteredViolations.reduce((counts, violation) => {
      const tagName = violation.componentScope?.tagName;

      if (!tagName) {
        return counts;
      }

      counts.set(tagName, (counts.get(tagName) ?? 0) + 1);

      return counts;
    }, new Map<string, number>());
    const selectedScopeTagName = this.state.selectedComponentScope()?.tagName;

    return this.state.componentInventory()
      .filter(scope => !isExcludedComponentTag(scope.tagName))
      .map(scope => ({
        count: violationCountByTagName.get(scope.tagName) ?? 0,
        displayLabel: formatComponentScopeLabel(scope.label),
        scope,
      }))
      .filter(item => item.count > 0 || item.scope.tagName === selectedScopeTagName)
      .sort((first, second) => second.count - first.count || first.displayLabel.localeCompare(second.displayLabel))
      .map(item => ({
        label: `${item.displayLabel} (${item.count})`,
        scope: item.scope,
      }));
  });
  protected readonly componentScopeOptions = computed(() => ['All components', ...this.componentScopeItems().map(item => item.label)]);
  protected readonly selectedComponentScopeLabel = computed(() => {
    const selectedScope = this.state.selectedComponentScope();

    if (!selectedScope) {
      return 'All components';
    }

    const matchedItem = this.componentScopeItems().find(item => item.scope.tagName === selectedScope.tagName);
    return matchedItem?.label ?? `${formatComponentScopeLabel(selectedScope.label)} (0)`;
  });
  protected readonly tabs: readonly PanelTabItem[] = [
    {id: 'violations', label: 'Violations'},
    {id: 'structure', label: 'Structure'},
    {id: 'report', label: 'Report'},
  ];
  protected readonly auditStandards: readonly AuditStandardItem[] = [
    {id: 'wcag2a', label: 'WCAG A'},
    {id: 'wcag2aa', label: 'WCAG AA'},
    {id: 'wcag2aaa', label: 'WCAG AAA'},
    {id: 'best-practice', label: 'Best'},
  ];
  protected readonly severityFilters: readonly SeverityFilterItem[] = [
    {id: 'critical', label: 'Critical'},
    {id: 'warning', label: 'Warning'},
    {id: 'info', label: 'Info'},
  ];
  protected readonly violationEngineFilters: readonly ViolationEngineFilterItem[] = [
    {id: 'both', label: 'Both'},
    {id: 'axe', label: 'axe'},
    {id: 'ibm', label: 'IBM'},
  ];
  protected readonly evidenceCaptureModes: readonly {readonly id: EvidenceCaptureMode; readonly label: string}[] = [
    {id: 'full-screen', label: 'Full screen'},
    {id: 'element', label: 'Element'},
    {id: 'free-select', label: 'Free select'},
  ];
  protected readonly rollbackMinuteOptions: readonly RollbackMinutes[] = [1, 3, 5];
  protected readonly narratorKeyboardModes: readonly NarratorModeOption<NarratorKeyboardMode>[] = [
    {id: 'strict-capture', label: 'Strict'},
    {id: 'safe-capture', label: 'Safe'},
  ];
  protected readonly narratorCommandProfiles: readonly NarratorModeOption<NarratorCommandProfile>[] = [
    {id: 'hybrid', label: 'Hybrid'},
    {id: 'voiceover', label: 'VoiceOver'},
    {id: 'windows-narrator', label: 'Narrator'},
    {id: 'nvda-jaws', label: 'NVDA/JAWS'},
  ];
  protected readonly narratorVerbosityProfiles: readonly NarratorModeOption<NarratorVerbosity>[] = [
    {id: 'low', label: 'Low'},
    {id: 'medium', label: 'Medium'},
    {id: 'high', label: 'High'},
  ];
  protected readonly narratorInterruptPolicies: readonly NarratorModeOption<NarratorInterruptPolicy>[] = [
    {id: 'coalesce', label: 'Coalesce'},
    {id: 'interrupt', label: 'Interrupt'},
    {id: 'queue', label: 'Queue'},
  ];
  protected readonly narratorShortcutCheatSheet = computed<readonly NarratorShortcutItem[]>(() => {
    const profile = this.state.readerMode().commandProfile ?? 'hybrid';
    const alt = this.isMac ? 'Option' : 'Alt';
    const mod = this.isMac ? 'Cmd' : 'Ctrl';
    const sharedShortcuts: NarratorShortcutItem[] = [
      {action: 'Next item', keys: ['Down']},
      {action: 'Previous item', keys: ['Up']},
      {action: 'Read current', keys: ['Ctrl', alt, 'Space']},
      {action: 'Activate', keys: ['Enter']},
      {action: 'Say all', keys: [mod, 'Shift', 'Space']},
      {action: 'Stop speech', keys: ['Esc']},
      {action: 'Pause speech', keys: [mod, 'Space']},
      {action: 'Resume speech', keys: [alt, 'Space']},
    ];

    if (profile === 'voiceover') {
      return [
        ...sharedShortcuts,
        {action: 'VO next item', keys: ['Ctrl', alt, 'Right']},
        {action: 'VO previous item', keys: ['Ctrl', alt, 'Left']},
      ];
    }

    if (profile === 'windows-narrator') {
      return [
        ...sharedShortcuts,
        {action: 'Next control', keys: ['Ctrl', 'Alt', 'Right']},
        {action: 'Previous control', keys: ['Ctrl', 'Alt', 'Left']},
      ];
    }

    if (profile === 'nvda-jaws') {
      return [
        ...sharedShortcuts,
        {action: 'Headings next/prev', keys: ['H', 'Shift+H']},
        {action: 'Links next/prev', keys: ['L', 'Shift+L']},
        {action: 'Buttons next/prev', keys: ['B', 'Shift+B']},
        {action: 'Fields next/prev', keys: ['F', 'Shift+F']},
        {action: 'Landmarks next/prev', keys: ['R', 'Shift+R']},
        {action: 'Elements next/prev', keys: ['E', 'Shift+E']},
      ];
    }

    return [
      ...sharedShortcuts,
        {action: 'VO next/prev', keys: [`Ctrl+${alt}+Right`, `Ctrl+${alt}+Left`]},
        {action: 'Narrator controls', keys: ['Ctrl+Alt+Right', 'Ctrl+Alt+Left']},
      {action: 'Headings next/prev', keys: ['H', 'Shift+H']},
      {action: 'Links next/prev', keys: ['L', 'Shift+L']},
      {action: 'Buttons next/prev', keys: ['B', 'Shift+B']},
      {action: 'Fields next/prev', keys: ['F', 'Shift+F']},
      {action: 'Landmarks next/prev', keys: ['R', 'Shift+R']},
    ];
  });
  protected readonly pageOrigin = computed(() => {
    const pageUrl = this.state.pageUrl();

    if (!pageUrl) {
      return 'No active page yet';
    }

    return new URL(pageUrl).origin;
  });

  constructor() {
    this.state.connectRuntime();
    window.addEventListener('pagehide', this.closePanelSession);
    window.addEventListener('beforeunload', this.closePanelSession);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('beforeunload', this.closePanelSession);
      window.removeEventListener('pagehide', this.closePanelSession);
      if (this.jiraPreviewVideoObjectUrl) {
        URL.revokeObjectURL(this.jiraPreviewVideoObjectUrl);
        this.jiraPreviewVideoObjectUrl = null;
      }
    });

    effect(() => {
      if (this.state.selectedComponentScope()) {
        this.activeTab.set('violations');
        this.scrollToViolations();

        return;
      }

      if (this.state.selectedViolation() && this.activeTab() !== 'violations') {
        this.activeTab.set('violations');
        this.scrollToViolations();
      }
    });

    effect(() => {
      const selectedViolation = this.state.selectedViolation();

      if (!selectedViolation) {
        if (this.lastFocusedViolationId) {
          const lastFocusedViolationId = this.lastFocusedViolationId;
          const lastFocusedGroup = this.state.violationGroups().find(group => group.violationIds.includes(lastFocusedViolationId));

          if (lastFocusedGroup) {
            this.expandedViolationGroups.update(expandedGroups => {
              const nextExpandedGroups = new Set(expandedGroups);
              nextExpandedGroups.delete(lastFocusedGroup.id);

              return nextExpandedGroups;
            });
          }
        }

        this.lastFocusedViolationId = null;

        return;
      }

      const matchingGroup = this.state.violationGroups().find(group => group.violationIds.includes(selectedViolation.violationId));

      this.lastFocusedViolationId = selectedViolation.violationId;

      if (!matchingGroup) {
        return;
      }

      this.expandedViolationGroups.update(expandedGroups => new Set([...expandedGroups, matchingGroup.id]));
    });

    effect(() => {
      if (!this.state.analysisError()) {
        this.dismissedAnalysisError.set(null);
      }
    });

    effect(() => {
      void this.refreshJiraPreviewAssets();
    });

    effect(() => {
      if (!this.state.jiraConnected() && this.panelView() === 'jira') {
        this.panelView.set('settings');
      }
    });
  }

  protected requestAnalysis(): void {
    this.expandedViolationGroups.set(new Set());
    this.state.requestAnalysis();
  }

  protected resetAnalysis(): void {
    this.expandedViolationGroups.set(new Set());
    this.state.resetAnalysis();
  }

  protected setAuditStandard(standard: AuditStandard): void {
    this.state.setAuditStandard(standard);
  }

  protected clearSelectedComponentScope(): void {
    this.state.clearSelectedComponentScope();
  }

  protected clearSelectedViolation(): void {
    this.state.clearSelectedViolation();
  }

  protected setComponentScopeLabel(label: string | null): void {
    if (!label || label === 'All components') {
      this.state.clearSelectedComponentScope();

      return;
    }

    const normalizedLabel = normalizeComponentScopeInput(label);
    const componentScope = this.componentScopeItems().find(item => (
      normalizeComponentScopeInput(item.label) === normalizedLabel
    ))?.scope;

    if (!componentScope) {
      this.state.clearSelectedComponentScope();

      return;
    }

    this.state.setSelectedComponentScope(componentScope);
  }

  protected toggleSeverityFilter(severity: ViolationSeverity): void {
    this.state.toggleSeverityFilter(severity);
  }

  protected setViolationEngineFilter(engineFilter: ViolationEngineFilter): void {
    this.state.setViolationEngineFilter(engineFilter);
  }

  protected isViolationGroupExpanded(groupId: string): boolean {
    return this.expandedViolationGroups().has(groupId);
  }

  protected toggleViolationGroup(groupId: string): void {
    this.expandedViolationGroups.update(expandedGroups => {
      const nextExpandedGroups = new Set(expandedGroups);

      if (nextExpandedGroups.has(groupId)) {
        nextExpandedGroups.delete(groupId);
      } else {
        nextExpandedGroups.add(groupId);
      }

      return nextExpandedGroups;
    });
  }

  protected onViolationGroupHeaderClick(group: ViolationGroup): void {
    const isExpanded = this.isViolationGroupExpanded(group.id);

    this.toggleViolationGroup(group.id);

    if (isExpanded) {
      const selectedViolation = this.state.selectedViolation();

      if (selectedViolation && group.violationIds.includes(selectedViolation.violationId)) {
        this.clearSelectedViolation();
      }

      return;
    }

    this.selectViolationGroup(group);
  }

  protected readonly jiraConnectionStatus = computed(() => (
    this.state.jiraConnected()
      ? 'Connected'
      : this.state.jiraSession().status === 'connecting'
        ? 'Connecting'
        : 'Disconnected'
  ));

  protected selectViolationGroup(group: ViolationGroup): void {
    const violationId = group.violationIds[0];
    const selector = group.selectors[0];

    if (!violationId || !selector) {
      return;
    }

    this.state.setSelectedViolation({selector, violationId});
  }

  protected toggleReaderMode(): void {
    this.state.toggleReaderMode();
  }

  protected toggleMouseInspection(): void {
    this.state.toggleMouseInspection();
  }

  protected toggleReaderSpeech(): void {
    this.state.toggleReaderSpeech();
  }

  protected setReaderVoice(event: Event): void {
    this.state.setReaderVoice(getFormValue(event));
  }

  protected setReaderVoiceLabel(label: string | null): void {
    if (!label || label === 'System default') {
      this.state.setReaderVoice('');

      return;
    }

    const voice = this.state.voiceOptions().find(option => option.label === label);

    if (voice) {
      this.state.setReaderVoice(voice.voiceURI);
    }
  }

  protected setLayerFilters(filters: readonly LayerFilterItem[] | null): void {
    const selectedFilters = new Set(filters ?? []);
    const nextVisibility = {
      coverage: false,
      errors: selectedFilters.has('Errors'),
      focusPath: selectedFilters.has('Focus'),
      landmarks: selectedFilters.has('Landmarks'),
      pageOverlay: this.state.layerVisibility().pageOverlay,
    };

    this.state.setLayerVisibility(nextVisibility);
    this.selectTabForFindingLayer(nextVisibility);
  }

  protected setPageOverlayEnabled(pageOverlay: boolean): void {
    const nextVisibility = {
      ...this.state.layerVisibility(),
      pageOverlay,
    };

    this.state.setLayerVisibility(nextVisibility);

    if (pageOverlay) {
      this.selectTabForFindingLayer(nextVisibility);
    }
  }

  protected setPreviewMode(mode: PreviewMode): void {
    this.state.setPreviewMode(mode);
  }

  protected setReaderModeEnabled(enabled: boolean): void {
    this.state.setReaderModeEnabled(enabled);
  }

  protected setMouseInspection(inspectWithMouse: boolean): void {
    this.state.setMouseInspection(inspectWithMouse);
  }

  protected setInspectInteractionLock(lockInteractions: boolean): void {
    this.state.setInspectInteractionLock(lockInteractions);
  }

  protected setEvidenceCaptureMode(mode: EvidenceCaptureMode): void {
    this.evidenceCaptureMode.set(mode);
  }

  protected async captureEvidenceImage(): Promise<void> {
    await this.state.captureEvidenceImage(this.evidenceCaptureMode());
  }

  protected setRollbackMinutes(minutes: RollbackMinutes): void {
    this.rollbackMinutes.set(minutes);
  }

  protected downloadRollbackVideo(): void {
    void this.state.downloadVideoRollback(this.rollbackMinutes());
  }

  protected setJiraProjectKey(projectKey: string | null): void {
    this.state.setJiraProjectKey(projectKey ?? '');
  }

  protected setJiraIssueTypeId(issueTypeId: string | null): void {
    this.state.setJiraIssueTypeId(issueTypeId ?? '');
  }

  protected connectJira(): void {
    void this.state.connectJira();
  }

  protected disconnectJira(): void {
    void this.state.disconnectJira();
  }

  protected createJiraTask(): void {
    const draft = this.jiraIssueDraft();

    if (!draft.canCreate) {
      return;
    }

    const shouldCreateTask = confirm('Are you sure you want to create this Jira task?');

    if (!shouldCreateTask) {
      return;
    }

    void this.state.createIssueFromDraft(this.jiraComposerOptions(), this.jiraRelationOptions());
  }

  protected setJiraMaxFindings(value: string | null): void {
    const parsedValue = Number(value ?? '');

    if (!Number.isFinite(parsedValue)) {
      return;
    }

    this.jiraMaxFindings.set(Math.max(1, Math.min(100, Math.round(parsedValue))));
  }

  protected async refreshJiraPreviewAssets(): Promise<void> {
    if (this.panelView() !== 'jira') {
      return;
    }

    this.jiraPreviewPending.set(true);

    try {
      const assets = await this.state.buildJiraPreviewAssets(this.jiraComposerOptions());

      if (this.jiraPreviewVideoObjectUrl) {
        URL.revokeObjectURL(this.jiraPreviewVideoObjectUrl);
      }

      this.jiraPreviewVideoObjectUrl = assets.videoPreviewUrl;
      this.jiraPreviewImageUrl.set(assets.imageDataUrl);
      this.jiraPreviewVideoUrl.set(assets.videoPreviewUrl);
    } finally {
      this.jiraPreviewPending.set(false);
    }
  }

  protected exportPdfReport(): void {
    void this.state.exportPdfReport();
  }

  protected setReaderSpeech(speak: boolean): void {
    this.state.setReaderSpeech(speak);
  }

  protected setReaderRate(event: Event): void {
    this.state.setReaderRate(Number(getFormValue(event)));
  }

  protected setNarratorKeyboardMode(mode: NarratorKeyboardMode): void {
    this.state.setNarratorKeyboardMode(mode);
  }

  protected setNarratorCommandProfile(profile: NarratorCommandProfile): void {
    this.state.setNarratorCommandProfile(profile);
  }

  protected setNarratorVerbosity(verbosity: NarratorVerbosity): void {
    this.state.setNarratorVerbosity(verbosity);
  }

  protected setNarratorInterruptPolicy(policy: NarratorInterruptPolicy): void {
    this.state.setNarratorInterruptPolicy(policy);
  }

  protected setNarratorEngineEnabled(enabled: boolean): void {
    this.state.setNarratorEngineEnabled(enabled);
  }

  protected toggleTheme(): void {
    this.theme.update(theme => {
      const nextTheme = theme === 'light' ? 'dark' : 'light';

      localStorage.setItem('kode-glass-theme', nextTheme);

      return nextTheme;
    });
  }

  protected toggleSettingsView(): void {
    this.panelView.update(view => view === 'settings' ? 'main' : 'settings');
  }

  protected toggleJiraView(): void {
    this.panelView.update(view => view === 'jira' ? 'main' : 'jira');
  }

  protected openSettingsView(): void {
    this.panelView.set('settings');
  }

  protected dismissAnalysisError(): void {
    const analysisError = this.state.analysisError();

    if (!analysisError) {
      return;
    }

    this.dismissedAnalysisError.set(analysisError);
  }

  protected selectTab(tab: PanelTab): void {
    this.activeTab.set(tab);
  }

  protected toggleLayer(layerName: LayerName): void {
    this.state.toggleLayer(layerName);
  }

  protected togglePageOverlay(): void {
    this.state.togglePageOverlay();
  }

  private selectTabForFindingLayer(visibility: {readonly errors: boolean; readonly pageOverlay: boolean}): void {
    if (!visibility.pageOverlay) {
      return;
    }

    if (visibility.errors) {
      this.activeTab.set('violations');

      return;
    }

  }

  protected copyReport(): void {
    const reportMarkdown = this.state.reportMarkdown();

    if (!reportMarkdown) {
      return;
    }

    void navigator.clipboard?.writeText(reportMarkdown);
  }

  private readonly closePanelSession = (): void => {
    this.state.closePanelSession();
  };

  private scrollToViolations(): void {
    requestAnimationFrame(() => {
      const violationsAnchor = document.querySelector<HTMLElement>('[data-violations-anchor]');
      violationsAnchor?.scrollIntoView({behavior: 'smooth', block: 'start'});
    });
  }
}

function normalizeComponentScopeInput(value: string): string {
  return value
    .replace(/\(\d+\)\s*$/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
