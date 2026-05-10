import {Injectable, inject} from '@angular/core';
import {PanelFacadeService} from './panel-facade.service';

@Injectable({providedIn: 'root'})
export class AnalysisReportStore {
  private readonly panelFacade = inject(PanelFacadeService);

  readonly pageReport = this.panelFacade.pageReport;
  readonly violations = this.panelFacade.violations;
  readonly visibleViolations = this.panelFacade.visibleViolations;
  readonly violationGroups = this.panelFacade.violationGroups;
  readonly reportMarkdown = this.panelFacade.reportMarkdown;
  readonly coverage = this.panelFacade.coverage;
  readonly severityCounts = this.panelFacade.severityCounts;
}
