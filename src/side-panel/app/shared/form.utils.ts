export function getFormValue(event: Event): string {
  return event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target.value : '';
}

export function getStoredTheme(): 'light' | 'dark' {
  return localStorage.getItem('kode-glass-theme') === 'dark' ? 'dark' : 'light';
}
