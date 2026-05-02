export type ViolationSeverity = 'critical' | 'warning' | 'info';

export type LayerName = 'errors' | 'focusPath' | 'landmarks' | 'pageOverlay';

export type AuditStandard = 'wcag2a' | 'wcag2aa' | 'wcag2aaa' | 'best-practice';

export interface AuditSettings {
  readonly standard: AuditStandard;
}

export interface ReaderModeSettings {
  readonly enabled: boolean;
  readonly inspectWithMouse: boolean;
  readonly rate?: number;
  readonly speak: boolean;
  readonly voiceURI?: string;
}

export interface ElementBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface AccessibleNodeSummary {
  readonly bounds?: ElementBounds;
  readonly description: string;
  readonly name: string;
  readonly role: string;
  readonly selector: string;
  readonly state: readonly string[];
}

export interface KodeGlassViolation {
  readonly bounds?: ElementBounds;
  readonly description?: string;
  readonly engine: 'axe-core' | 'playwright' | 'manual';
  readonly guidance?: string;
  readonly helpUrl?: string;
  readonly id: string;
  readonly impact?: string;
  readonly ruleId: string;
  readonly selector: string;
  readonly severity: ViolationSeverity;
  readonly summary: string;
  readonly title?: string;
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

export interface AccessibilityReport {
  readonly auditSettings: AuditSettings;
  readonly generatedAt: number;
  readonly headings: readonly HeadingSummary[];
  readonly landmarks: readonly LandmarkSummary[];
  readonly pageTitle: string;
  readonly pageUrl: string;
  readonly violations: readonly KodeGlassViolation[];
}

export type LayerVisibility = Record<LayerName, boolean>;
