import {Injectable, inject} from '@angular/core';
import {PanelFacadeService} from './panel-facade.service';

@Injectable({providedIn: 'root'})
export class ReaderModeStore {
  private readonly panelFacade = inject(PanelFacadeService);

  readonly readerMode = this.panelFacade.readerMode;
  readonly voiceOptions = this.panelFacade.voiceOptions;

  setReaderModeEnabled(enabled: boolean): void {
    this.panelFacade.setReaderModeEnabled(enabled);
  }

  setMouseInspection(enabled: boolean): void {
    this.panelFacade.setMouseInspection(enabled);
  }

  setInspectInteractionLock(lockInteractions: boolean): void {
    this.panelFacade.setInspectInteractionLock(lockInteractions);
  }

  setReaderSpeech(speak: boolean): void {
    this.panelFacade.setReaderSpeech(speak);
  }
}
