import {Injectable, inject} from '@angular/core';
import type {JiraIssueComposerOptions, JiraIssueRelationOptions} from '../side-panel-state.service';
import {PanelFacadeService} from './panel-facade.service';

@Injectable({providedIn: 'root'})
export class JiraOrchestrationStore {
  private readonly panelFacade = inject(PanelFacadeService);

  readonly jiraSession = this.panelFacade.jiraSession;
  readonly jiraConnected = this.panelFacade.jiraConnected;
  readonly jiraPending = this.panelFacade.jiraPending;
  readonly jiraProjects = this.panelFacade.jiraProjects;
  readonly jiraIssueTypes = this.panelFacade.jiraIssueTypes;

  connectJira(): Promise<void> {
    return this.panelFacade.connectJira();
  }

  disconnectJira(): Promise<void> {
    return this.panelFacade.disconnectJira();
  }

  createIssueFromDraft(options: JiraIssueComposerOptions, relations: JiraIssueRelationOptions): Promise<void> {
    return this.panelFacade.createIssueFromDraft(options, relations);
  }

  buildJiraIssueDraft(options: JiraIssueComposerOptions) {
    return this.panelFacade.buildJiraIssueDraft(options);
  }
}
