import {ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {TuiAppearance, TuiButton, TuiFilterByInputPipe, TuiIcon, TuiLoader, TuiRoot, TuiSlider} from '@taiga-ui/core';
import {TuiLink} from '@taiga-ui/core/components/link';
import {TuiAccordion, TuiBadge, TuiButtonGroup, TuiChevron, TuiChip, TuiComboBox, TuiDataListWrapper, TuiFilter, TuiSwitch} from '@taiga-ui/kit';
import type {AuditStandard, ComponentScopeOption, LayerName, ViolationEngineFilter, ViolationSeverity} from '../../shared/accessibility-report';
import {SidePanelStateService, type PreviewMode, type ViolationGroup} from './side-panel-state.service';

type PanelTab = 'violations' | 'structure' | 'report';
type Theme = 'light' | 'dark';
type LayerFilterItem = 'Errors' | 'Landmarks' | 'Focus';

interface PanelTabItem {
  readonly id: PanelTab;
  readonly label: string;
}

interface AuditStandardItem {
  readonly id: AuditStandard;
  readonly label: string;
}

interface SeverityFilterItem {
  readonly id: ViolationSeverity;
  readonly label: string;
}

interface ViolationEngineFilterItem {
  readonly id: ViolationEngineFilter;
  readonly label: string;
}

interface ComponentScopeSelectItem {
  readonly label: string;
  readonly scope: ComponentScopeOption;
}

const layerFilterSelections: Record<string, readonly LayerFilterItem[]> = {
  '000': [],
  '001': ['Errors'],
  '010': ['Landmarks'],
  '011': ['Errors', 'Landmarks'],
  '100': ['Focus'],
  '101': ['Errors', 'Focus'],
  '110': ['Landmarks', 'Focus'],
  '111': ['Errors', 'Landmarks', 'Focus'],
};

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
    TuiChip,
    TuiComboBox,
    TuiDataListWrapper,
    TuiFilter,
    TuiFilterByInputPipe,
    TuiIcon,
    TuiLink,
    TuiLoader,
    TuiRoot,
    TuiSlider,
    TuiSwitch,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  private readonly destroyRef = inject(DestroyRef);
  private lastFocusedViolationId: string | null = null;
  protected readonly state = inject(SidePanelStateService);
  protected readonly activeTab = signal<PanelTab>('violations');
  protected readonly expandedViolationGroups = signal<ReadonlySet<string>>(new Set());
  protected readonly theme = signal<Theme>(getStoredTheme());
  protected readonly themeIcon = computed(() => this.theme() === 'light' ? '@tui.sun' : '@tui.moon');
  protected readonly themeLabel = computed(() => this.theme() === 'light' ? 'Light' : 'Dark');
  protected readonly themeToggleLabel = computed(() => `Switch to ${this.theme() === 'light' ? 'dark' : 'light'} theme`);
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
    const selectionKey = `${Number(visibility.focusPath)}${Number(visibility.landmarks)}${Number(visibility.errors)}`;

    return layerFilterSelections[selectionKey] ?? layerFilterSelections['000'];
  });
  protected readonly voiceComboItems = computed(() => ['System default', ...this.state.voiceOptions().map(voice => voice.label)]);
  protected readonly selectedVoiceLabel = computed(() => {
    const voiceURI = this.state.readerMode().voiceURI;

    return voiceURI ? this.state.voiceOptions().find(voice => voice.voiceURI === voiceURI)?.label ?? 'System default' : 'System default';
  });
  protected readonly componentScopeItems = computed<readonly ComponentScopeSelectItem[]>(() => {
    const violationCountByTagName = this.state.violations().reduce((counts, violation) => {
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
        scope,
      }))
      .filter(item => item.count > 0 || item.scope.tagName === selectedScopeTagName)
      .sort((first, second) => second.count - first.count || first.scope.label.localeCompare(second.scope.label))
      .map(item => ({
        label: `${item.scope.label} (${item.count})`,
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

    return matchedItem?.label ?? `${selectedScope.label} (0)`;
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
    });

    effect(() => {
      if (this.state.selectedComponentScope() || this.state.selectedViolation()) {
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

    const componentScope = this.componentScopeItems().find(item => item.label === label)?.scope;

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

    this.state.setLayerVisibility({
      errors: selectedFilters.has('Errors'),
      focusPath: selectedFilters.has('Focus'),
      landmarks: selectedFilters.has('Landmarks'),
      pageOverlay: this.state.layerVisibility().pageOverlay,
    });
  }

  protected setPageOverlayEnabled(pageOverlay: boolean): void {
    this.state.setLayerVisibility({
      ...this.state.layerVisibility(),
      pageOverlay,
    });
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

  protected setReaderSpeech(speak: boolean): void {
    this.state.setReaderSpeech(speak);
  }

  protected setReaderRate(event: Event): void {
    this.state.setReaderRate(Number(getFormValue(event)));
  }

  protected toggleTheme(): void {
    this.theme.update(theme => {
      const nextTheme = theme === 'light' ? 'dark' : 'light';

      localStorage.setItem('kode-glass-theme', nextTheme);

      return nextTheme;
    });
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

function isExcludedComponentTag(tagName: string): boolean {
  const normalizedTagName = tagName.toLowerCase();

  return normalizedTagName === 'router-outlet'
    || normalizedTagName.startsWith('kode-glass-')
    || normalizedTagName.startsWith('tui-')
    || normalizedTagName.startsWith('cdk-')
    || normalizedTagName.startsWith('ng-');
}

function getFormValue(event: Event): string {
  return event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target.value : '';
}

function getStoredTheme(): Theme {
  return localStorage.getItem('kode-glass-theme') === 'dark' ? 'dark' : 'light';
}
