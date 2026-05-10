import type {ViolationSeverity, WcagCoverageStatus} from '../../shared/accessibility-report';

export type Rgb = readonly [number, number, number];

export const ink: Rgb = [17, 24, 39];
export const mutedInk: Rgb = [75, 85, 99];
export const softInk: Rgb = [107, 114, 128];
export const border: Rgb = [218, 226, 236];
export const faintBorder: Rgb = [235, 240, 246];
export const paper: Rgb = [250, 252, 255];
export const accent: Rgb = [31, 91, 190];
export const linkBlue: Rgb = [37, 99, 235];
export const critical: Rgb = [190, 18, 60];
export const warning: Rgb = [194, 102, 20];
export const info: Rgb = [37, 99, 235];
export const success: Rgb = [21, 128, 61];
export const white: Rgb = [255, 255, 255];

export function severityRgb(severity: ViolationSeverity): Rgb {
  if (severity === 'critical') {
    return critical;
  }

  if (severity === 'warning') {
    return warning;
  }

  return info;
}

export function statusRgb(status: 'completed' | 'failed' | 'skipped'): Rgb {
  if (status === 'completed') {
    return success;
  }

  if (status === 'failed') {
    return critical;
  }

  return warning;
}

export function coverageStatusColor(status: WcagCoverageStatus): Rgb {
  return ({
    failed: critical,
    'needs-manual-review': warning,
    'not-tested': mutedInk,
    'passed-automated': success,
  } as Record<WcagCoverageStatus, Rgb>)[status];
}

export function severityLabel(severity: ViolationSeverity): string {
  if (severity === 'critical') {
    return 'Critical';
  }

  if (severity === 'warning') {
    return 'Warning';
  }

  return 'Info';
}

export function severityRank(severity: ViolationSeverity): number {
  return ({critical: 3, warning: 2, info: 1} as Record<ViolationSeverity, number>)[severity];
}
