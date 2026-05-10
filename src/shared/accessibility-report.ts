export type ViolationSeverity = 'critical' | 'warning' | 'info';

export type LayerName = 'coverage' | 'errors' | 'focusPath' | 'landmarks' | 'pageOverlay';

export type AuditStandard = 'wcag2a' | 'wcag2aa' | 'wcag2aaa' | 'best-practice';

export type AccessibilityEngine = 'axe-core' | 'ibm-equal-access' | 'playwright' | 'manual';

export type AccessibilityEngineRunStatus = 'completed' | 'failed' | 'skipped';

export type WcagCriterionLevel = 'A' | 'AA' | 'AAA';

export type WcagCoverageStatus = 'failed' | 'passed-automated' | 'needs-manual-review' | 'not-tested';

export interface WcagCoverageItem {
  readonly criterionId: string;
  readonly level: WcagCriterionLevel;
  readonly principle: 'Perceivable' | 'Operable' | 'Understandable' | 'Robust';
  readonly relatedRuleIds: readonly string[];
  readonly status: WcagCoverageStatus;
  readonly title: string;
  readonly violationIds: readonly string[];
}

export interface AccessibilityEngineStatus {
  readonly durationMs: number;
  readonly engine: AccessibilityEngine;
  readonly error?: string;
  readonly label: string;
  readonly scopes?: number;
  readonly status: AccessibilityEngineRunStatus;
  readonly violations: number;
}

export type ViolationEngineFilter = 'axe' | 'both' | 'ibm';

export type SeverityVisibility = Record<ViolationSeverity, boolean>;

export interface ViolationFilterSettings {
  readonly engine: ViolationEngineFilter;
  readonly severity: SeverityVisibility;
}

export interface ComponentScope {
  readonly label: string;
  readonly selector: string;
  readonly tagName: string;
}

export interface ComponentScopeOption extends ComponentScope {
  readonly id: string;
}

export interface AuditSettings {
  readonly standard: AuditStandard;
}

export interface ReaderModeSettings {
  readonly commandProfile?: NarratorCommandProfile;
  readonly enabled: boolean;
  readonly interruptPolicy?: NarratorInterruptPolicy;
  readonly inspectWithMouse: boolean;
  readonly keyboardMode?: NarratorKeyboardMode;
  readonly lockInteractions: boolean;
  readonly narratorEngineEnabled?: boolean;
  readonly rate?: number;
  readonly speak: boolean;
  readonly verbosity?: NarratorVerbosity;
  readonly voiceName?: string;
  readonly voiceURI?: string;
}

export type NarratorKeyboardMode = 'safe-capture' | 'strict-capture';

export type NarratorCommandProfile = 'hybrid' | 'nvda-jaws' | 'voiceover' | 'windows-narrator';

export type NarratorVerbosity = 'high' | 'low' | 'medium';

export type NarratorInterruptPolicy = 'coalesce' | 'interrupt' | 'queue';

export type NarratorNavigationUnit =
  | 'button'
  | 'control'
  | 'element'
  | 'form-field'
  | 'heading'
  | 'landmark'
  | 'line'
  | 'link';

export type NarratorCommandType =
  | 'activate-current'
  | 'next-unit'
  | 'pause-speech'
  | 'previous-unit'
  | 'read-current'
  | 'resume-speech'
  | 'say-all'
  | 'stop-speech';

export interface NarratorCommand {
  readonly type: NarratorCommandType;
  readonly unit?: NarratorNavigationUnit;
  readonly value?: boolean;
}

export interface ElementBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export type EvidenceCaptureMode = 'element' | 'free-select' | 'full-screen';

export interface CaptureBoundsSnapshot {
  readonly bounds: ElementBounds;
  readonly devicePixelRatio: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly viewportHeight: number;
  readonly viewportWidth: number;
}

export interface JiraSiteOption {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

export interface JiraProjectOption {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface JiraIssueTypeOption {
  readonly id: string;
  readonly isSubtask?: boolean;
  readonly name: string;
}

export interface JiraAuthSession {
  readonly accountId?: string;
  readonly displayName?: string;
  readonly error?: string;
  readonly issueTypeId?: string;
  readonly issueTypeName?: string;
  readonly projectId?: string;
  readonly projectKey?: string;
  readonly site?: JiraSiteOption;
  readonly status: 'connected' | 'connecting' | 'disconnected';
}

export interface AccessibleNodeSummary {
  readonly bounds?: ElementBounds;
  readonly componentScope?: ComponentScope;
  readonly description: string;
  readonly name: string;
  readonly role: string;
  readonly selector: string;
  readonly state: readonly string[];
}

export interface KodeGlassViolation {
  readonly bounds?: ElementBounds;
  readonly componentScope?: ComponentScope;
  readonly description?: string;
  readonly engine: AccessibilityEngine;
  readonly guidance?: string;
  readonly helpUrl?: string;
  readonly id: string;
  readonly impact?: string;
  readonly ruleId: string;
  readonly selector: string;
  readonly severity: ViolationSeverity;
  readonly sourceEngines?: readonly AccessibilityEngine[];
  readonly summary: string;
  readonly title?: string;
  readonly wcagCriteria?: readonly string[];
}

export interface HeadingSummary {
  readonly level: number;
  readonly selector: string;
  readonly text: string;
}

export interface LandmarkSummary {
  readonly bounds?: ElementBounds;
  readonly label: string;
  readonly role: string;
  readonly selector: string;
}

export type ScanScopeKind = 'document' | 'overlay';

export interface ScanScopeSummary {
  readonly bounds?: ElementBounds;
  readonly elementCount: number;
  readonly id: string;
  readonly kind: ScanScopeKind;
  readonly label: string;
  readonly selector: string;
}

export interface AccessibilityReport {
  readonly auditSettings: AuditSettings;
  readonly coverage: readonly WcagCoverageItem[];
  readonly engineStatuses: readonly AccessibilityEngineStatus[];
  readonly generatedAt: number;
  readonly headings: readonly HeadingSummary[];
  readonly landmarks: readonly LandmarkSummary[];
  readonly pageTitle: string;
  readonly pageUrl: string;
  readonly scanScopes: readonly ScanScopeSummary[];
  readonly violations: readonly KodeGlassViolation[];
}

export type LayerVisibility = Record<LayerName, boolean>;
