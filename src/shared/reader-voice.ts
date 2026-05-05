export interface ReaderVoiceCandidate {
  readonly lang: string;
  readonly label: string;
  readonly name: string;
  readonly voiceURI: string;
}

export interface ReaderVoicePick {
  readonly voiceName: string;
  readonly voiceURI: string;
}

export function scoreReaderVoiceCandidate(label: string, lang: string): number {
  const normalizedLang = lang.toLowerCase().replace('_', '-');
  const lower = label.toLowerCase();
  let score = 0;

  if (normalizedLang === 'en-us') {
    score += 140;
  } else if (normalizedLang.startsWith('en-us')) {
    score += 120;
  } else if (normalizedLang.startsWith('en')) {
    score += 45;
  }

  if (/google\s+us\s+english/i.test(label)) {
    score += 160;
  } else if (/google/.test(lower) && /\bus\b/.test(lower) && /english/.test(lower)) {
    score += 130;
  }

  if (/microsoft.*\(.*english.*united states|microsoft.*\(.*english.*\(us\)/i.test(label)) {
    score += 80;
  }

  if (/jenny|aria|zira|samantha|victoria|susan|karen|heather/i.test(lower)) {
    score += 55;
  }

  if (/natural|online/i.test(lower)) {
    score += 35;
  }

  if (/female/i.test(lower)) {
    score += 18;
  }

  if (/male/i.test(lower)) {
    score -= 35;
  }

  return score;
}

export function pickDefaultReaderVoice(voices: readonly ReaderVoiceCandidate[]): ReaderVoicePick | undefined {
  if (!voices.length) {
    return undefined;
  }

  const ranked = [...voices].sort((first, second) => {
    const delta =
      scoreReaderVoiceCandidate(second.label, second.lang) - scoreReaderVoiceCandidate(first.label, first.lang);

    if (delta !== 0) {
      return delta;
    }

    return first.label.localeCompare(second.label);
  });

  const choice = ranked[0];

  return choice ? {voiceURI: choice.voiceURI, voiceName: choice.name} : undefined;
}
