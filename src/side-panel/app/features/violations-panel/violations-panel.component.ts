import {ChangeDetectionStrategy, Component, input, output} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {TuiButton, TuiFilterByInputPipe, TuiIcon} from '@taiga-ui/core';
import {TuiAccordion, TuiChip, TuiComboBox, TuiDataListWrapper} from '@taiga-ui/kit';
import {TuiLink} from '@taiga-ui/core/components/link';
import type {ComponentScope, ViolationSeverity} from '../../../../shared/accessibility-report';
import type {ViolationSelectedPayload} from '../../../../shared/messages';
import type {ViolationGroup} from '../../side-panel-state.service';
import type {ComponentScopeSelectItem, SeverityFilterItem} from '../../shared/panel-ui.types';

@Component({
  selector: 'kode-glass-violations-panel',
  imports: [
    FormsModule,
    TuiAccordion,
    TuiButton,
    TuiChip,
    TuiComboBox,
    TuiDataListWrapper,
    TuiFilterByInputPipe,
    TuiIcon,
    TuiLink,
  ],
  templateUrl: './violations-panel.component.html',
  styleUrl: './violations-panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViolationsPanelComponent {
  readonly hasViolations = input.required<boolean>();
  readonly selectedViolation = input<ViolationSelectedPayload | null>(null);
  readonly selectedComponentScope = input<ComponentScope | null>(null);
  readonly selectedComponentScopeLabel = input.required<string>();
  readonly componentScopeItems = input.required<readonly ComponentScopeSelectItem[]>();
  readonly componentScopeOptions = input.required<readonly string[]>();
  readonly severityFilters = input.required<readonly SeverityFilterItem[]>();
  readonly severityVisibility = input.required<Record<ViolationSeverity, boolean>>();
  readonly availableSeverityCounts = input.required<Record<ViolationSeverity, number>>();
  readonly hasVisibleViolations = input.required<boolean>();
  readonly visibleViolationGroups = input.required<readonly ViolationGroup[]>();
  readonly expandedGroupIds = input.required<ReadonlySet<string>>();
  readonly isFocusedGroup = input.required<(group: ViolationGroup) => boolean>();

  readonly clearSelectedViolationRequested = output<void>();
  readonly clearSelectedComponentScopeRequested = output<void>();
  readonly componentScopeLabelChange = output<string | null>();
  readonly severityFilterToggle = output<ViolationSeverity>();
  readonly violationGroupHeaderClick = output<ViolationGroup>();

  isViolationGroupExpanded(groupId: string): boolean {
    return this.expandedGroupIds().has(groupId);
  }
}
