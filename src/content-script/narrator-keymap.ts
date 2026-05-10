import type {NarratorCommand, NarratorCommandProfile} from '../shared/accessibility-report';

export function mapKeyboardEventToNarratorCommand(
  event: KeyboardEvent,
  commandProfile: NarratorCommandProfile,
): NarratorCommand | null {
  if (commandProfile === 'voiceover' || commandProfile === 'hybrid') {
    const voiceOverCommand = mapVoiceOverLikeCommands(event);

    if (voiceOverCommand) {
      return voiceOverCommand;
    }
  }

  if (commandProfile === 'windows-narrator' || commandProfile === 'hybrid') {
    const narratorCommand = mapWindowsNarratorLikeCommands(event);

    if (narratorCommand) {
      return narratorCommand;
    }
  }

  if (commandProfile === 'nvda-jaws' || commandProfile === 'hybrid') {
    const desktopSrCommand = mapDesktopScreenReaderCommands(event);

    if (desktopSrCommand) {
      return desktopSrCommand;
    }
  }

  return mapSharedNarratorCommands(event);
}

function mapVoiceOverLikeCommands(event: KeyboardEvent): NarratorCommand | null {
  // VoiceOver primary interaction style uses VO keys (Control + Option) on macOS.
  if (event.ctrlKey && event.altKey && !event.metaKey) {
    if (event.key === 'ArrowRight') {
      return {type: 'next-unit', unit: 'element'};
    }

    if (event.key === 'ArrowLeft') {
      return {type: 'previous-unit', unit: 'element'};
    }

    if (event.key === ' ') {
      return {type: 'read-current'};
    }
  }

  return null;
}

function mapWindowsNarratorLikeCommands(event: KeyboardEvent): NarratorCommand | null {
  if (event.ctrlKey && event.altKey && event.key === 'ArrowRight') {
    return {type: 'next-unit', unit: 'control'};
  }

  if (event.ctrlKey && event.altKey && event.key === 'ArrowLeft') {
    return {type: 'previous-unit', unit: 'control'};
  }

  if (event.ctrlKey && event.altKey && event.key === ' ') {
    return {type: 'read-current'};
  }

  return null;
}

function mapDesktopScreenReaderCommands(event: KeyboardEvent): NarratorCommand | null {
  if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }

  const key = event.key.toLowerCase();

  if (key === 'h') {
    return {type: event.shiftKey ? 'previous-unit' : 'next-unit', unit: 'heading'};
  }

  if (key === 'l') {
    return {type: event.shiftKey ? 'previous-unit' : 'next-unit', unit: 'link'};
  }

  if (key === 'b') {
    return {type: event.shiftKey ? 'previous-unit' : 'next-unit', unit: 'button'};
  }

  if (key === 'f') {
    return {type: event.shiftKey ? 'previous-unit' : 'next-unit', unit: 'form-field'};
  }

  if (key === 'r') {
    return {type: event.shiftKey ? 'previous-unit' : 'next-unit', unit: 'landmark'};
  }

  if (key === 'e') {
    return {type: event.shiftKey ? 'previous-unit' : 'next-unit', unit: 'element'};
  }

  return null;
}

function mapSharedNarratorCommands(event: KeyboardEvent): NarratorCommand | null {
  if (event.key === 'ArrowDown' && !event.altKey && !event.ctrlKey && !event.metaKey) {
    return {type: 'next-unit', unit: 'line'};
  }

  if (event.key === 'ArrowUp' && !event.altKey && !event.ctrlKey && !event.metaKey) {
    return {type: 'previous-unit', unit: 'line'};
  }

  if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey) {
    return {type: 'activate-current'};
  }

  if (event.key === ' ' && event.ctrlKey && event.shiftKey) {
    return {type: 'say-all', value: true};
  }

  if (event.key === 'Escape') {
    return {type: 'stop-speech'};
  }

  if (event.key === ' ' && event.ctrlKey) {
    return {type: 'pause-speech'};
  }

  if (event.key === ' ' && event.altKey) {
    return {type: 'resume-speech'};
  }

  return null;
}
