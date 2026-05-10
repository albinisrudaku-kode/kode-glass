import type {AccessibleNodeSummary, NarratorNavigationUnit, ReaderModeSettings} from '../shared/accessibility-report';
import {RuntimeMessageType} from '../shared/messages';
import {getPreviewDetails} from './violation-renderer';

export interface SpokenSummaryContext {
  readonly index?: number;
  readonly total?: number;
  readonly unit?: NarratorNavigationUnit;
}

export function getSpokenSummary(
  summary: AccessibleNodeSummary,
  readerMode: ReaderModeSettings,
  context: SpokenSummaryContext = {},
): string {
  const isRequired = summary.state.some(state => state.toLowerCase() === 'required');
  const previewDetails = getPreviewDetails(summary.state);
  const value = getStateValue(previewDetails.states, 'value: ');
  const hasSelectedState = previewDetails.states.some(state => state.toLowerCase() === 'selected');
  const toggleState = getSpokenToggleState(summary.role, previewDetails.states);
  const role = getSpokenRole(summary.role, previewDetails.states);
  const baseName = summary.name || value || 'Unnamed element';
  const nameWithMarker = isRequired && !baseName.includes('*') ? `${baseName} *` : baseName;
  const verbosity = readerMode.verbosity ?? 'medium';
  const isVoiceOverProfile = readerMode.commandProfile === 'voiceover';
  const description = summary.description && verbosity !== 'low' ? `. ${summary.description}` : '';
  const state = previewDetails.states.length && verbosity !== 'low' ? `. ${previewDetails.states.join('. ')}` : '';
  const destination = previewDetails.destination && verbosity === 'high' ? `. Destination: ${previewDetails.destination}` : '';
  const sequence = context.index && context.total && verbosity !== 'low'
    ? `. ${context.index} of ${context.total}${context.unit ? ` ${context.unit}` : ''}`
    : '';
  const requiredCue = isRequired ? '. Required. Asterisk' : '';

  if (isVoiceOverProfile) {
    const parts = [nameWithMarker];

    if (hasSelectedState) {
      parts.push('contents selected');
    }

    if (isRequired) {
      parts.push('required');
    }

    if (toggleState) {
      parts.push(toggleState);
    }

    if (isInteractiveRole(role)) {
      parts.push('clickable');
    }

    if (shouldSpeakRole(role)) {
      parts.push(role);
    }

    if (context.index && context.total && verbosity !== 'low') {
      parts.push(`${context.index} of ${context.total}${context.unit ? ` ${context.unit}` : ''}`);
    }

    return parts.join(', ');
  }

  return `${nameWithMarker}. ${role}${sequence}${requiredCue}${description}${state}${destination}`;
}

export function requestReaderSpeak(text: string, readerMode: ReaderModeSettings): void {
  if (!chrome.runtime?.id) {
    return;
  }

  void chrome.runtime.sendMessage({
    payload: {readerMode, text},
    type: RuntimeMessageType.ReaderSpeakRequested,
  });
}

function getSpokenRole(role: string, states: readonly string[]): string {
  const normalizedRole = role.trim().toLowerCase();
  const hasPopupState = states.some(state => {
    const lowerState = state.toLowerCase();
    return lowerState === 'collapsed' || lowerState === 'expanded';
  });

  if (normalizedRole === 'textbox' && hasPopupState) {
    return 'combo box';
  }

  return ({
    button: 'button',
    checkbox: 'checkbox',
    combobox: 'combo box',
    generic: '',
    img: 'image',
    interactive: '',
    link: 'link',
    listbox: 'list box',
    option: 'option',
    radio: 'radio button',
    searchbox: 'search field',
    slider: 'slider',
    spinbutton: 'stepper',
    switch: 'switch',
    tab: 'tab',
    textbox: 'text',
  } as Record<string, string>)[normalizedRole] ?? role;
}

function getStateValue(states: readonly string[], prefix: string): string | null {
  const valueState = states.find(state => state.toLowerCase().startsWith(prefix));
  return valueState?.slice(prefix.length).trim() || null;
}

function getSpokenToggleState(role: string, states: readonly string[]): string | null {
  const normalizedRole = role.trim().toLowerCase();
  const checkedState = states.find(state => {
    const lowerState = state.toLowerCase();
    return lowerState === 'checked' || lowerState === 'unchecked' || lowerState === 'partially checked';
  });

  if (!checkedState) {
    return null;
  }

  const normalizedState = checkedState.toLowerCase();

  if (normalizedRole === 'switch') {
    if (normalizedState === 'checked') {
      return 'on';
    }

    if (normalizedState === 'unchecked') {
      return 'off';
    }
  }

  if (normalizedState === 'unchecked') {
    return 'not checked';
  }

  return normalizedState;
}

function isInteractiveRole(role: string): boolean {
  return new Set([
    'button',
    'checkbox',
    'combo box',
    'link',
    'list box',
    'option',
    'radio button',
    'search field',
    'slider',
    'stepper',
    'switch',
    'tab',
  ]).has(role);
}

function shouldSpeakRole(role: string): boolean {
  return role.trim().length > 0;
}
