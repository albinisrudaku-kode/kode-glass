import {ChangeDetectionStrategy, Component, input, output} from '@angular/core';
import {TuiButton} from '@taiga-ui/core';

@Component({
  selector: 'kode-glass-settings-jira-account',
  imports: [TuiButton],
  templateUrl: './settings-jira-account.component.html',
  styleUrl: './settings-jira-account.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsJiraAccountComponent {
  readonly jiraConnected = input.required<boolean>();
  readonly jiraPending = input.required<boolean>();
  readonly jiraStatus = input.required<string>();
  readonly analysisError = input<string | null>(null);

  readonly connectRequested = output<void>();
  readonly disconnectRequested = output<void>();
  readonly dismissErrorRequested = output<void>();
}
