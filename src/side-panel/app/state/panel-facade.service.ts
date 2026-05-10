import {Injectable} from '@angular/core';
import {SidePanelStateService} from '../side-panel-state.service';

@Injectable({providedIn: 'root'})
export class PanelFacadeService extends SidePanelStateService {}
