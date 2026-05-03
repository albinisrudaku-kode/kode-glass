import type {KodeGlassViolation, ViolationFilterSettings} from './accessibility-report';

export const initialViolationFilterSettings: ViolationFilterSettings = {
  engine: 'both',
  severity: {
    critical: true,
    info: true,
    warning: true,
  },
};

export function matchesViolationFilters(
  violation: KodeGlassViolation,
  filters: ViolationFilterSettings,
  options: {readonly includeSeverityFilter: boolean} = {includeSeverityFilter: true},
): boolean {
  const matchesEngine = matchesViolationEngineFilter(violation, filters.engine);
  const matchesSeverity = !options.includeSeverityFilter || filters.severity[violation.severity];

  return matchesEngine && matchesSeverity;
}

function matchesViolationEngineFilter(violation: KodeGlassViolation, engineFilter: ViolationFilterSettings['engine']): boolean {
  const sourceEngines = violation.sourceEngines ?? [violation.engine];

  switch (engineFilter) {
    case 'axe':
      return sourceEngines.includes('axe-core');
    case 'ibm':
      return sourceEngines.includes('ibm-equal-access');
    case 'both':
      return true;
  }
}