import type {
  AuditStandard,
  ComponentScopeOption,
  EvidenceCaptureMode,
  ViolationEngineFilter,
  ViolationSeverity,
} from '../../../shared/accessibility-report';

export type PanelTab = 'violations' | 'structure' | 'report';
export type PanelView = 'jira' | 'main' | 'settings';
export type Theme = 'light' | 'dark';
export type LayerFilterItem = 'Errors' | 'Landmarks' | 'Focus';
export type RollbackMinutes = 1 | 3 | 5;

export interface PanelTabItem {
  readonly id: PanelTab;
  readonly label: string;
}

export interface AuditStandardItem {
  readonly id: AuditStandard;
  readonly label: string;
}

export interface SeverityFilterItem {
  readonly id: ViolationSeverity;
  readonly label: string;
}

export interface ViolationEngineFilterItem {
  readonly id: ViolationEngineFilter;
  readonly label: string;
}

export interface ComponentScopeSelectItem {
  readonly label: string;
  readonly scope: ComponentScopeOption;
}

export interface NarratorModeOption<T extends string> {
  readonly id: T;
  readonly label: string;
}

export interface NarratorShortcutItem {
  readonly action: string;
  readonly keys: readonly string[];
}

export interface EvidenceCaptureModeOption {
  readonly id: EvidenceCaptureMode;
  readonly label: string;
}
