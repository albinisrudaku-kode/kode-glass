import {ChangeDetectionStrategy, Component, input, output} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {TuiButton} from '@taiga-ui/core';
import type {JiraIssueTypeOption, JiraProjectOption} from '../../../../shared/accessibility-report';
import type {JiraIssueDraft} from '../../side-panel-state.service';

@Component({
  selector: 'kode-glass-jira-composer',
  imports: [FormsModule, TuiButton],
  templateUrl: './jira-composer.component.html',
  styleUrl: './jira-composer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JiraComposerComponent {
  readonly jiraPending = input.required<boolean>();
  readonly jiraConnected = input.required<boolean>();
  readonly jiraProjectKey = input.required<string>();
  readonly jiraIssueTypeId = input.required<string>();
  readonly jiraProjects = input.required<readonly JiraProjectOption[]>();
  readonly jiraIssueTypes = input.required<readonly JiraIssueTypeOption[]>();
  readonly jiraLinkTypes = input.required<readonly string[]>();
  readonly jiraParentIssueKey = input.required<string>();
  readonly jiraLinkIssueKey = input.required<string>();
  readonly jiraLinkTypeName = input.required<string>();
  readonly jiraIncludePageMetadata = input.required<boolean>();
  readonly jiraIncludeAppliedFilters = input.required<boolean>();
  readonly jiraIncludeFilteredFindings = input.required<boolean>();
  readonly jiraIncludeFocusedViolation = input.required<boolean>();
  readonly jiraIncludeStructureSnapshot = input.required<boolean>();
  readonly jiraIncludeEvidenceImage = input.required<boolean>();
  readonly jiraIncludeRollbackVideoGuidance = input.required<boolean>();
  readonly jiraIncludePdfReportGuidance = input.required<boolean>();
  readonly jiraIncludeReportMarkdown = input.required<boolean>();
  readonly jiraMaxFindings = input.required<number>();
  readonly jiraPreviewPending = input.required<boolean>();
  readonly jiraIssueDraft = input.required<JiraIssueDraft>();
  readonly jiraPreviewImageUrl = input<string | null>(null);
  readonly jiraPreviewVideoUrl = input<string | null>(null);

  readonly jiraProjectKeyChange = output<string>();
  readonly jiraIssueTypeIdChange = output<string>();
  readonly jiraParentIssueKeyChange = output<string>();
  readonly jiraLinkIssueKeyChange = output<string>();
  readonly jiraLinkTypeNameChange = output<string>();
  readonly jiraIncludePageMetadataChange = output<boolean>();
  readonly jiraIncludeAppliedFiltersChange = output<boolean>();
  readonly jiraIncludeFilteredFindingsChange = output<boolean>();
  readonly jiraIncludeFocusedViolationChange = output<boolean>();
  readonly jiraIncludeStructureSnapshotChange = output<boolean>();
  readonly jiraIncludeEvidenceImageChange = output<boolean>();
  readonly jiraIncludeRollbackVideoGuidanceChange = output<boolean>();
  readonly jiraIncludePdfReportGuidanceChange = output<boolean>();
  readonly jiraIncludeReportMarkdownChange = output<boolean>();
  readonly jiraMaxFindingsChange = output<string | null>();
  readonly refreshPreviewRequested = output<void>();
  readonly createTaskRequested = output<void>();
}
