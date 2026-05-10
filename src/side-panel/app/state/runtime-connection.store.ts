import {Injectable, inject} from '@angular/core';
import {PanelFacadeService} from './panel-facade.service';

@Injectable({providedIn: 'root'})
export class RuntimeConnectionStore {
  private readonly panelFacade = inject(PanelFacadeService);

  connectRuntime(): void {
    this.panelFacade.connectRuntime();
  }

  closePanelSession(): void {
    this.panelFacade.closePanelSession();
  }

  requestAnalysis(): void {
    this.panelFacade.requestAnalysis();
  }

  resetAnalysis(): void {
    this.panelFacade.resetAnalysis();
  }
}
