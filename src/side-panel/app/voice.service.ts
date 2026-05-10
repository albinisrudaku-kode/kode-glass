import {signal, type Signal} from '@angular/core';
import {pickDefaultReaderVoice} from '../../shared/reader-voice';
import type {ReaderModeSettings} from '../../shared/accessibility-report';
import {RuntimeMessageType, type ReaderVoicesResponse} from '../../shared/messages';

export interface ReaderVoiceOption {
  readonly label: string;
  readonly lang: string;
  readonly localService: boolean;
  readonly name: string;
  readonly voiceURI: string;
}

export interface VoiceServiceCallbacks {
  readonly getReaderMode: () => ReaderModeSettings;
  readonly commitReaderMode: (readerMode: ReaderModeSettings) => void;
}

export class VoiceService {
  readonly voiceOptions: Signal<readonly ReaderVoiceOption[]>;
  private readonly voiceOptionsSignal = signal<readonly ReaderVoiceOption[]>([]);
  private detachVoicesChangedListener: (() => void) | undefined;

  constructor(private readonly callbacks: VoiceServiceCallbacks) {
    this.voiceOptions = this.voiceOptionsSignal.asReadonly();
  }

  loadVoiceOptions(): void {
    if (!chrome.runtime?.id) {
      return;
    }
    void chrome.runtime.sendMessage({
      payload: {},
      type: RuntimeMessageType.ReaderVoicesRequested,
    } as const, (response: ReaderVoicesResponse | undefined) => {
      if (!response?.ok) {
        return;
      }

      const voices = response.voices
        .map(voice => ({
          label: voice.label,
          lang: voice.lang,
          localService: voice.localService,
          name: voice.name,
          voiceURI: voice.voiceURI,
        }))
        .sort((first, second) => Number(second.localService) - Number(first.localService) || first.label.localeCompare(second.label));

      this.voiceOptionsSignal.set(voices);

      if (!this.callbacks.getReaderMode().voiceURI) {
        const picked = pickDefaultReaderVoice(voices);

        if (picked) {
          const readerMode = this.callbacks.getReaderMode();

          this.callbacks.commitReaderMode({
            ...readerMode,
            voiceName: picked.voiceName,
            voiceURI: picked.voiceURI,
          });
        }
      }
    });
  }

  teardownListener(): void {
    this.detachVoicesChangedListener?.();
    this.detachVoicesChangedListener = undefined;
  }

  cancelSpeech(): void {
    if (!chrome.runtime?.id) {
      return;
    }

    void chrome.runtime.sendMessage({
      payload: {action: 'stop'},
      type: RuntimeMessageType.ReaderSpeechControlRequested,
    } as const);
  }
}
