export function isExcludedComponentTag(tagName: string): boolean {
  const normalizedTagName = tagName.toLowerCase();

  return normalizedTagName === 'router-outlet'
    || normalizedTagName.startsWith('kode-glass-')
    || normalizedTagName.startsWith('tui-')
    || normalizedTagName.startsWith('cdk-')
    || normalizedTagName.startsWith('ng-');
}

export function formatComponentScopeLabel(label: string): string {
  const normalizedLabel = label.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return normalizedLabel || 'Unknown component';
}
