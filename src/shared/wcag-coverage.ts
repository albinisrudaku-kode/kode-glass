import type {AccessibilityEngineStatus, AuditSettings, KodeGlassViolation, WcagCoverageItem, WcagCriterionLevel} from './accessibility-report';

interface WcagCriterionDefinition {
  readonly id: string;
  readonly level: WcagCriterionLevel;
  readonly principle: WcagCoverageItem['principle'];
  readonly title: string;
}

const wcag22Criteria: readonly WcagCriterionDefinition[] = [
  {id: '1.1.1', level: 'A', principle: 'Perceivable', title: 'Non-text Content'},
  {id: '1.2.1', level: 'A', principle: 'Perceivable', title: 'Audio-only and Video-only'},
  {id: '1.2.2', level: 'A', principle: 'Perceivable', title: 'Captions'},
  {id: '1.2.3', level: 'A', principle: 'Perceivable', title: 'Audio Description or Media Alternative'},
  {id: '1.2.4', level: 'AA', principle: 'Perceivable', title: 'Captions Live'},
  {id: '1.2.5', level: 'AA', principle: 'Perceivable', title: 'Audio Description'},
  {id: '1.3.1', level: 'A', principle: 'Perceivable', title: 'Info and Relationships'},
  {id: '1.3.2', level: 'A', principle: 'Perceivable', title: 'Meaningful Sequence'},
  {id: '1.3.3', level: 'A', principle: 'Perceivable', title: 'Sensory Characteristics'},
  {id: '1.3.4', level: 'AA', principle: 'Perceivable', title: 'Orientation'},
  {id: '1.3.5', level: 'AA', principle: 'Perceivable', title: 'Identify Input Purpose'},
  {id: '1.4.1', level: 'A', principle: 'Perceivable', title: 'Use of Color'},
  {id: '1.4.2', level: 'A', principle: 'Perceivable', title: 'Audio Control'},
  {id: '1.4.3', level: 'AA', principle: 'Perceivable', title: 'Contrast Minimum'},
  {id: '1.4.4', level: 'AA', principle: 'Perceivable', title: 'Resize Text'},
  {id: '1.4.5', level: 'AA', principle: 'Perceivable', title: 'Images of Text'},
  {id: '1.4.10', level: 'AA', principle: 'Perceivable', title: 'Reflow'},
  {id: '1.4.11', level: 'AA', principle: 'Perceivable', title: 'Non-text Contrast'},
  {id: '1.4.12', level: 'AA', principle: 'Perceivable', title: 'Text Spacing'},
  {id: '1.4.13', level: 'AA', principle: 'Perceivable', title: 'Content on Hover or Focus'},
  {id: '2.1.1', level: 'A', principle: 'Operable', title: 'Keyboard'},
  {id: '2.1.2', level: 'A', principle: 'Operable', title: 'No Keyboard Trap'},
  {id: '2.1.4', level: 'A', principle: 'Operable', title: 'Character Key Shortcuts'},
  {id: '2.2.1', level: 'A', principle: 'Operable', title: 'Timing Adjustable'},
  {id: '2.2.2', level: 'A', principle: 'Operable', title: 'Pause, Stop, Hide'},
  {id: '2.3.1', level: 'A', principle: 'Operable', title: 'Three Flashes or Below Threshold'},
  {id: '2.4.1', level: 'A', principle: 'Operable', title: 'Bypass Blocks'},
  {id: '2.4.2', level: 'A', principle: 'Operable', title: 'Page Titled'},
  {id: '2.4.3', level: 'A', principle: 'Operable', title: 'Focus Order'},
  {id: '2.4.4', level: 'A', principle: 'Operable', title: 'Link Purpose In Context'},
  {id: '2.4.5', level: 'AA', principle: 'Operable', title: 'Multiple Ways'},
  {id: '2.4.6', level: 'AA', principle: 'Operable', title: 'Headings and Labels'},
  {id: '2.4.7', level: 'AA', principle: 'Operable', title: 'Focus Visible'},
  {id: '2.4.11', level: 'AA', principle: 'Operable', title: 'Focus Not Obscured Minimum'},
  {id: '2.5.1', level: 'A', principle: 'Operable', title: 'Pointer Gestures'},
  {id: '2.5.2', level: 'A', principle: 'Operable', title: 'Pointer Cancellation'},
  {id: '2.5.3', level: 'A', principle: 'Operable', title: 'Label in Name'},
  {id: '2.5.4', level: 'A', principle: 'Operable', title: 'Motion Actuation'},
  {id: '2.5.7', level: 'AA', principle: 'Operable', title: 'Dragging Movements'},
  {id: '2.5.8', level: 'AA', principle: 'Operable', title: 'Target Size Minimum'},
  {id: '3.1.1', level: 'A', principle: 'Understandable', title: 'Language of Page'},
  {id: '3.1.2', level: 'AA', principle: 'Understandable', title: 'Language of Parts'},
  {id: '3.2.1', level: 'A', principle: 'Understandable', title: 'On Focus'},
  {id: '3.2.2', level: 'A', principle: 'Understandable', title: 'On Input'},
  {id: '3.2.3', level: 'AA', principle: 'Understandable', title: 'Consistent Navigation'},
  {id: '3.2.4', level: 'AA', principle: 'Understandable', title: 'Consistent Identification'},
  {id: '3.2.6', level: 'A', principle: 'Understandable', title: 'Consistent Help'},
  {id: '3.3.1', level: 'A', principle: 'Understandable', title: 'Error Identification'},
  {id: '3.3.2', level: 'A', principle: 'Understandable', title: 'Labels or Instructions'},
  {id: '3.3.3', level: 'AA', principle: 'Understandable', title: 'Error Suggestion'},
  {id: '3.3.4', level: 'AA', principle: 'Understandable', title: 'Error Prevention Legal Financial Data'},
  {id: '3.3.7', level: 'A', principle: 'Understandable', title: 'Redundant Entry'},
  {id: '3.3.8', level: 'AA', principle: 'Understandable', title: 'Accessible Authentication Minimum'},
  {id: '4.1.2', level: 'A', principle: 'Robust', title: 'Name, Role, Value'},
  {id: '4.1.3', level: 'AA', principle: 'Robust', title: 'Status Messages'},
];

const automatedCriteria = new Set([
  '1.1.1', '1.3.1', '1.3.5', '1.4.3', '1.4.11', '2.4.1', '2.4.2', '2.4.4', '2.4.6', '2.5.3', '2.5.8', '3.1.1', '3.1.2', '3.3.1', '3.3.2', '4.1.2', '4.1.3',
]);

const ruleCriteriaMap: Record<string, readonly string[]> = {
  'area-alt': ['1.1.1'],
  'aria-allowed-attr': ['4.1.2'],
  'aria-allowed-role': ['4.1.2'],
  'aria-command-name': ['4.1.2'],
  'aria-conditional-attr': ['4.1.2'],
  'aria-deprecated-role': ['4.1.2'],
  'aria-dialog-name': ['4.1.2'],
  'aria-hidden-focus': ['4.1.2'],
  'aria-input-field-name': ['4.1.2'],
  'aria-meter-name': ['4.1.2'],
  'aria-progressbar-name': ['4.1.2'],
  'aria-prohibited-attr': ['4.1.2'],
  'aria-required-attr': ['4.1.2'],
  'aria-required-children': ['1.3.1', '4.1.2'],
  'aria-required-parent': ['1.3.1', '4.1.2'],
  'aria-roles': ['4.1.2'],
  'aria-toggle-field-name': ['4.1.2'],
  'aria-tooltip-name': ['4.1.2'],
  'aria-valid-attr': ['4.1.2'],
  'aria-valid-attr-value': ['4.1.2'],
  'button-name': ['4.1.2'],
  'bypass': ['2.4.1'],
  'color-contrast': ['1.4.3'],
  'definition-list': ['1.3.1'],
  'dlitem': ['1.3.1'],
  'document-title': ['2.4.2'],
  'duplicate-id-aria': ['4.1.2'],
  'form-field-multiple-labels': ['3.3.2'],
  'frame-title': ['2.4.2'],
  'html-has-lang': ['3.1.1'],
  'html-lang-valid': ['3.1.1'],
  'html-xml-lang-mismatch': ['3.1.1'],
  'image-alt': ['1.1.1'],
  'input-button-name': ['4.1.2'],
  'input-image-alt': ['1.1.1'],
  label: ['3.3.2', '4.1.2'],
  'label-content-name-mismatch': ['2.5.3'],
  'link-in-text-block': ['1.4.1'],
  'link-name': ['2.4.4', '4.1.2'],
  list: ['1.3.1'],
  listitem: ['1.3.1'],
  'meta-refresh': ['2.2.1'],
  'nested-interactive': ['4.1.2'],
  'object-alt': ['1.1.1'],
  'role-img-alt': ['1.1.1'],
  'select-name': ['4.1.2'],
  'server-side-image-map': ['2.1.1'],
  'status-messages': ['4.1.3'],
  'svg-img-alt': ['1.1.1'],
  tabindex: ['2.4.3'],
  'target-size': ['2.5.8'],
  'td-headers-attr': ['1.3.1'],
  'th-has-data-cells': ['1.3.1'],
  'valid-lang': ['3.1.2'],
};

export function createWcagCoverage(
  auditSettings: AuditSettings,
  violations: readonly KodeGlassViolation[],
  engineStatuses: readonly AccessibilityEngineStatus[],
): readonly WcagCoverageItem[] {
  const automatedEnginesCompleted = engineStatuses.some(status => status.status === 'completed' && (status.engine === 'axe-core' || status.engine === 'ibm-equal-access'));
  const violationsByCriterion = collectViolationsByCriterion(violations);

  return wcag22Criteria
    .filter(criterion => isCriterionInAudit(criterion, auditSettings))
    .map(criterion => {
      const criterionViolations = violationsByCriterion.get(criterion.id) ?? [];
      const relatedRuleIds = [...new Set(criterionViolations.map(violation => violation.ruleId))].sort();

      return {
        criterionId: criterion.id,
        level: criterion.level,
        principle: criterion.principle,
        relatedRuleIds,
        status: getCoverageStatus(criterion.id, criterionViolations, automatedEnginesCompleted),
        title: criterion.title,
        violationIds: criterionViolations.map(violation => violation.id),
      } satisfies WcagCoverageItem;
    });
}

export function enrichViolationsWithWcagCriteria(violations: readonly KodeGlassViolation[]): readonly KodeGlassViolation[] {
  return violations.map(violation => ({
    ...violation,
    wcagCriteria: getWcagCriteriaForRule(violation.ruleId),
  }));
}

export function getWcagCriteriaForRule(ruleId: string): readonly string[] {
  const normalizedRuleId = normalizeRuleId(ruleId);
  const explicitCriteria = ruleCriteriaMap[normalizedRuleId];

  if (explicitCriteria) {
    return explicitCriteria;
  }

  if (normalizedRuleId.includes('contrast')) {
    return ['1.4.3'];
  }

  if (normalizedRuleId.includes('label') || normalizedRuleId.includes('name')) {
    return ['4.1.2'];
  }

  if (normalizedRuleId.includes('role') || normalizedRuleId.includes('aria')) {
    return ['4.1.2'];
  }

  if (normalizedRuleId.includes('keyboard') || normalizedRuleId.includes('focus') || normalizedRuleId.includes('tab')) {
    return ['2.1.1', '2.4.3'];
  }

  if (normalizedRuleId.includes('heading')) {
    return ['1.3.1', '2.4.6'];
  }

  if (normalizedRuleId.includes('landmark') || normalizedRuleId.includes('region')) {
    return ['1.3.1', '2.4.1'];
  }

  if (normalizedRuleId.includes('alt')) {
    return ['1.1.1'];
  }

  return [];
}

function collectViolationsByCriterion(violations: readonly KodeGlassViolation[]): Map<string, KodeGlassViolation[]> {
  const violationsByCriterion = new Map<string, KodeGlassViolation[]>();

  for (const violation of violations) {
    for (const criterionId of violation.wcagCriteria ?? getWcagCriteriaForRule(violation.ruleId)) {
      violationsByCriterion.set(criterionId, [...(violationsByCriterion.get(criterionId) ?? []), violation]);
    }
  }

  return violationsByCriterion;
}

function getCoverageStatus(
  criterionId: string,
  violations: readonly KodeGlassViolation[],
  automatedEnginesCompleted: boolean,
): WcagCoverageItem['status'] {
  if (violations.length) {
    return 'failed';
  }

  if (automatedCriteria.has(criterionId)) {
    return automatedEnginesCompleted ? 'passed-automated' : 'not-tested';
  }

  return 'needs-manual-review';
}

function isCriterionInAudit(criterion: WcagCriterionDefinition, auditSettings: AuditSettings): boolean {
  switch (auditSettings.standard) {
    case 'wcag2a':
      return criterion.level === 'A';
    case 'wcag2aa':
    case 'wcag2aaa':
      return criterion.level === 'A' || criterion.level === 'AA';
    case 'best-practice':
      return false;
  }
}

function normalizeRuleId(ruleId: string): string {
  return ruleId
    .replace(/^axe:/i, '')
    .replace(/^ibm:/i, '')
    .replace(/^ibma_/i, '')
    .replace(/^wcag\d+_/i, '')
    .replace(/_/g, '-')
    .toLowerCase();
}
