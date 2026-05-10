import {jsPDF} from 'jspdf';
import type {AccessibilityReport, KodeGlassViolation, ViolationFilterSettings, ViolationSeverity, WcagCoverageStatus} from '../../shared/accessibility-report';
import {getReadableViolationGuidance, getReadableViolationSummary} from '../../shared/text/violation-copy';
import {
  accent,
  border,
  critical,
  faintBorder,
  info,
  ink,
  linkBlue,
  mutedInk,
  paper,
  softInk,
  warning,
  white,
  coverageStatusColor,
  severityLabel,
  severityRank,
  severityRgb,
  statusRgb,
  type Rgb,
} from './pdf-styling';

export interface PdfEvidenceImage {
  readonly caption: string;
  readonly dataUrl: string;
  readonly violationId?: string;
}

export interface BuildReportPdfInput {
  readonly createdAt: number;
  readonly evidenceImages: readonly PdfEvidenceImage[];
  readonly focusedViolationId?: string;
  readonly report: AccessibilityReport;
  readonly selectedComponentLabel?: string;
  readonly visibleViolations: readonly KodeGlassViolation[];
  readonly violationFilters: ViolationFilterSettings;
}

interface FindingGroupSummary {
  readonly count: number;
  readonly engines: string;
  readonly guidance?: string;
  readonly ruleId: string;
  readonly severity: ViolationSeverity;
  readonly title: string;
}

export class PdfLayout {
  readonly contentWidth: number;
  readonly document: jsPDF;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly marginRight: number;
  readonly marginTop: number;
  readonly pageHeight: number;
  readonly pageWidth: number;
  cursorY: number;

  constructor(document: jsPDF, margins: {readonly bottom: number; readonly left: number; readonly right: number; readonly top: number}) {
    this.document = document;
    this.pageWidth = document.internal.pageSize.getWidth();
    this.pageHeight = document.internal.pageSize.getHeight();
    this.marginBottom = margins.bottom;
    this.marginLeft = margins.left;
    this.marginRight = margins.right;
    this.marginTop = margins.top;
    this.contentWidth = this.pageWidth - this.marginLeft - this.marginRight;
    this.cursorY = this.marginTop;
  }

  get bottomY(): number {
    return this.pageHeight - this.marginBottom;
  }

  get remainingHeight(): number {
    return this.bottomY - this.cursorY;
  }

  ensureSpace(height: number): void {
    if (this.cursorY + height <= this.bottomY || this.cursorY <= this.marginTop) {
      return;
    }

    this.addPage();
  }

  addGap(height: number): void {
    this.ensureSpace(height);
    this.cursorY += height;
  }

  addPage(): void {
    this.document.addPage();
    this.cursorY = this.marginTop;
  }
}

export function drawCover(layout: PdfLayout, input: BuildReportPdfInput): void {
  const document = layout.document;
  const contentX = layout.marginLeft + 8;
  const titleY = 86;
  const pageTitle = input.report.pageTitle || 'Untitled page';
  const urlLines = splitText(document, input.report.pageUrl, layout.contentWidth - 18);

  document.setFillColor(...paper);
  document.rect(0, 0, layout.pageWidth, layout.pageHeight, 'F');
  document.setFillColor(...accent);
  document.rect(0, 0, 18, layout.pageHeight, 'F');
  document.setDrawColor(...border);
  document.setLineWidth(1);
  document.line(layout.marginLeft, 302, layout.pageWidth - layout.marginRight, 302);

  document.setFont('helvetica', 'bold');
  document.setFontSize(11);
  document.setTextColor(...accent);
  document.text('KODE GLASS', contentX, titleY - 34);
  document.setFontSize(33);
  document.setTextColor(...ink);
  document.text('Accessibility QA Report', contentX, titleY);
  document.setFont('helvetica', 'normal');
  document.setFontSize(12);
  document.setTextColor(...mutedInk);
  document.text(splitText(document, pageTitle, layout.contentWidth - 20), contentX, titleY + 33);
  document.setFontSize(9.5);
  document.setTextColor(...linkBlue);
  document.text(urlLines, contentX, titleY + 58);
  addLinkAnnotations(document, urlLines, contentX, titleY + 58, 12, input.report.pageUrl);

  document.setFontSize(9.5);
  document.setTextColor(...softInk);
  document.text(`Generated ${formatDateTime(input.createdAt)}`, contentX, 280);
  drawCoverMetrics(layout, input.visibleViolations, input.report.violations.length);
  drawCoverScope(layout, input);
}

function drawCoverMetrics(layout: PdfLayout, violations: readonly KodeGlassViolation[], totalFindings: number): void {
  const document = layout.document;
  const metrics = [
    {label: 'Filtered findings', value: violations.length, color: ink},
    {label: 'Critical', value: countSeverity(violations, 'critical'), color: critical},
    {label: 'Warnings', value: countSeverity(violations, 'warning'), color: warning},
    {label: 'Info', value: countSeverity(violations, 'info'), color: info},
  ];
  const top = 342;
  const gap = 12;
  const blockWidth = (layout.contentWidth - gap * 3) / 4;
  let x = layout.marginLeft + 8;

  for (const metric of metrics) {
    document.setDrawColor(...border);
    document.setFillColor(...white);
    document.roundedRect(x, top, blockWidth, 76, 7, 7, 'FD');
    document.setFont('helvetica', 'bold');
    document.setFontSize(25);
    document.setTextColor(...metric.color);
    document.text(String(metric.value), x + 14, top + 31);
    document.setFontSize(8.5);
    document.setTextColor(...mutedInk);
    document.text(metric.label.toUpperCase(), x + 14, top + 55);
    x += blockWidth + gap;
  }

  document.setFont('helvetica', 'normal');
  document.setFontSize(10);
  document.setTextColor(...softInk);
  document.text(`${violations.length} of ${totalFindings} total findings are included after filters.`, layout.marginLeft + 8, top + 98);
}

function drawCoverScope(layout: PdfLayout, input: BuildReportPdfInput): void {
  const document = layout.document;
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['Engine scope', formatFilterEngine(input.violationFilters.engine)],
    ['Severity scope', formatEnabledSeverities(input.violationFilters)],
    ['Component scope', input.selectedComponentLabel ?? 'All components'],
    ['Focused finding', input.focusedViolationId ?? 'None'],
  ];
  const startY = 512;

  document.setFont('helvetica', 'bold');
  document.setFontSize(13);
  document.setTextColor(...ink);
  document.text('Report Scope', layout.marginLeft + 8, startY);

  let y = startY + 32;
  for (const [label, value] of rows) {
    document.setDrawColor(...faintBorder);
    document.line(layout.marginLeft + 8, y - 15, layout.pageWidth - layout.marginRight, y - 15);
    document.setFont('helvetica', 'bold');
    document.setFontSize(8.5);
    document.setTextColor(...softInk);
    document.text(label.toUpperCase(), layout.marginLeft + 8, y);
    document.setFont('helvetica', 'normal');
    document.setFontSize(10.5);
    document.setTextColor(...ink);
    document.text(splitText(document, value, layout.contentWidth - 170), layout.marginLeft + 160, y);
    y += 34;
  }
}

export function drawSectionTitle(layout: PdfLayout, title: string, subtitle?: string): void {
  const document = layout.document;
  layout.ensureSpace(subtitle ? 58 : 42);
  document.setFont('helvetica', 'bold');
  document.setFontSize(18);
  document.setTextColor(...ink);
  document.text(title, layout.marginLeft, layout.cursorY);
  layout.cursorY += 17;

  if (subtitle) {
    drawText(layout, subtitle, {
      color: softInk,
      fontSize: 9.8,
      gapAfter: 5,
      lineHeight: 12,
      width: layout.contentWidth,
    });
  }

  document.setDrawColor(...border);
  document.setLineWidth(0.7);
  document.line(layout.marginLeft, layout.cursorY + 2, layout.marginLeft + layout.contentWidth, layout.cursorY + 2);
  layout.cursorY += 18;
}

export function drawScanContext(layout: PdfLayout, input: BuildReportPdfInput): void {
  drawDefinitionList(layout, [
    ['Page', input.report.pageTitle || 'Untitled page'],
    ['URL', input.report.pageUrl],
    ['Generated', formatDateTime(input.createdAt)],
    ['Scan scopes', formatScanScopes(input.report)],
    ['Filters', `${formatFilterEngine(input.violationFilters.engine)} | ${formatEnabledSeverities(input.violationFilters)} | ${input.selectedComponentLabel ?? 'All components'}`],
  ], {linkLabels: new Set(['URL'])});
  layout.addGap(12);
}

export function drawSeveritySummary(layout: PdfLayout, violations: readonly KodeGlassViolation[], totalFindings: number): void {
  const document = layout.document;
  const criticalCount = countSeverity(violations, 'critical');
  const warningCount = countSeverity(violations, 'warning');
  const infoCount = countSeverity(violations, 'info');
  const total = Math.max(violations.length, 1);
  const barWidth = layout.contentWidth;
  const barHeight = 12;
  const segments = [
    {count: criticalCount, color: critical},
    {count: warningCount, color: warning},
    {count: infoCount, color: info},
  ];
  layout.ensureSpace(80);

  document.setFont('helvetica', 'bold');
  document.setFontSize(12);
  document.setTextColor(...ink);
  document.text('Severity Distribution', layout.marginLeft, layout.cursorY);
  layout.cursorY += 19;

  document.setFillColor(241, 245, 249);
  document.roundedRect(layout.marginLeft, layout.cursorY, barWidth, barHeight, 6, 6, 'F');
  let x = layout.marginLeft;
  for (const segment of segments) {
    const width = violations.length ? (segment.count / total) * barWidth : 0;
    if (width > 0) {
      document.setFillColor(...segment.color);
      document.rect(x, layout.cursorY, width, barHeight, 'F');
      x += width;
    }
  }
  layout.cursorY += 30;

  const summary = `Critical ${criticalCount} | Warning ${warningCount} | Info ${infoCount} | ${violations.length} shown from ${totalFindings} total findings`;
  drawText(layout, summary, {color: mutedInk, fontSize: 10, gapAfter: 16, lineHeight: 12, width: layout.contentWidth});
}

function drawDefinitionList(
  layout: PdfLayout,
  rows: ReadonlyArray<readonly [string, string]>,
  options: {readonly linkLabels?: ReadonlySet<string>} = {},
): void {
  const document = layout.document;
  const labelWidth = 116;
  const valueX = layout.marginLeft + labelWidth + 18;
  const valueWidth = layout.contentWidth - labelWidth - 18;

  for (const [label, value] of rows) {
    document.setFont('helvetica', 'normal');
    document.setFontSize(9.8);
    const lines = splitText(document, value, valueWidth);
    const rowHeight = Math.max(28, lines.length * 12 + 11);
    layout.ensureSpace(rowHeight + 4);
    const rowY = layout.cursorY;
    document.setDrawColor(...faintBorder);
    document.line(layout.marginLeft, rowY + rowHeight, layout.marginLeft + layout.contentWidth, rowY + rowHeight);
    document.setFont('helvetica', 'bold');
    document.setFontSize(8.3);
    document.setTextColor(...softInk);
    document.text(label.toUpperCase(), layout.marginLeft, rowY + 15);
    document.setFont('helvetica', 'normal');
    document.setFontSize(9.8);
    document.setTextColor(...(options.linkLabels?.has(label) && isHttpUrl(value) ? linkBlue : ink));
    document.text(lines, valueX, rowY + 15);

    if (options.linkLabels?.has(label) && isHttpUrl(value)) {
      addLinkAnnotations(document, lines, valueX, rowY + 15, 12, value);
    }

    layout.cursorY += rowHeight + 4;
  }
}

export function drawEngineStatusTable(layout: PdfLayout, statuses: AccessibilityReport['engineStatuses']): void {
  const document = layout.document;
  layout.ensureSpace(42);
  document.setFont('helvetica', 'bold');
  document.setFontSize(12);
  document.setTextColor(...ink);
  document.text('Engine Status', layout.marginLeft, layout.cursorY);
  layout.cursorY += 18;

  if (!statuses.length) {
    drawEmptyState(layout, 'No engine status data is available.');

    return;
  }

  drawTableHeader(layout, ['Engine', 'Status', 'Findings', 'Scopes', 'Duration'], [0, 190, 300, 370, 440]);

  for (const status of statuses) {
    const errorLines = status.error ? splitText(document, status.error, layout.contentWidth - 18) : [];
    const rowHeight = Math.max(34, 22 + errorLines.length * 11);
    layout.ensureSpace(rowHeight + 2);
    const y = layout.cursorY;
    document.setDrawColor(...faintBorder);
    document.line(layout.marginLeft, y + rowHeight, layout.marginLeft + layout.contentWidth, y + rowHeight);
    document.setFont('helvetica', 'bold');
    document.setFontSize(9.5);
    document.setTextColor(...ink);
    document.text(status.label, layout.marginLeft, y + 15);
    document.setTextColor(...statusRgb(status.status));
    document.text(status.status.toUpperCase(), layout.marginLeft + 210, y + 15);
    document.setFont('helvetica', 'normal');
    document.setTextColor(...mutedInk);
    document.text(String(status.violations), layout.marginLeft + 300, y + 15);
    document.text(String(status.scopes ?? '-'), layout.marginLeft + 370, y + 15);
    document.text(`${status.durationMs}ms`, layout.marginLeft + 440, y + 15);

    if (status.error) {
      document.setTextColor(...critical);
      document.text(errorLines, layout.marginLeft, y + 30);
    }

    layout.cursorY += rowHeight + 2;
  }

  layout.addGap(18);
}

export function drawWcagCoverageSummary(layout: PdfLayout, report: AccessibilityReport): void {
  if (!report.coverage.length) {
    return;
  }

  const failedCount = countCoverageStatus(report, 'failed');
  const passedCount = countCoverageStatus(report, 'passed-automated');
  const manualCount = countCoverageStatus(report, 'needs-manual-review');
  const notTestedCount = countCoverageStatus(report, 'not-tested');
  const reviewItems = report.coverage
    .filter(item => item.status === 'failed' || item.status === 'needs-manual-review')
    .slice(0, 10);
  const document = layout.document;

  layout.ensureSpace(82);
  document.setFont('helvetica', 'bold');
  document.setFontSize(12);
  document.setTextColor(...ink);
  document.text('WCAG Coverage', layout.marginLeft, layout.cursorY);
  layout.cursorY += 18;

  drawText(layout, `Failed ${failedCount} | Passed automated checks ${passedCount} | Needs manual review ${manualCount} | Not tested ${notTestedCount}`, {
    color: mutedInk,
    fontSize: 10,
    gapAfter: 10,
    lineHeight: 12,
    width: layout.contentWidth,
  });

  if (!reviewItems.length) {
    drawEmptyState(layout, 'No WCAG criteria have mapped failures or manual review prompts.');
    layout.addGap(14);

    return;
  }

  drawTableHeader(layout, ['Status', 'Criterion', 'Title', 'Findings'], [0, 92, 170, 450]);

  for (const item of reviewItems) {
    layout.ensureSpace(34);
    const y = layout.cursorY;
    document.setDrawColor(...faintBorder);
    document.line(layout.marginLeft, y + 31, layout.marginLeft + layout.contentWidth, y + 31);
    document.setFont('helvetica', 'bold');
    document.setFontSize(8.8);
    document.setTextColor(...coverageStatusColor(item.status));
    document.text(formatCoverageStatus(item.status), layout.marginLeft, y + 14);
    document.setTextColor(...ink);
    document.text(`${item.criterionId} ${item.level}`, layout.marginLeft + 92, y + 14);
    document.setFont('helvetica', 'normal');
    document.setTextColor(...mutedInk);
    document.text(splitText(document, item.title, 260).slice(0, 1), layout.marginLeft + 170, y + 14);
    document.text(String(item.violationIds.length || '-'), layout.marginLeft + 450, y + 14);
    layout.cursorY += 33;
  }

  layout.addGap(18);
}

export function drawRemediationPlan(layout: PdfLayout, violations: readonly KodeGlassViolation[]): void {
  const groups = createFindingGroups(violations).slice(0, 12);

  if (!groups.length) {
    drawEmptyState(layout, 'No grouped remediation work is available for the selected filters.');

    return;
  }

  drawText(layout, 'Start with the rows at the top: they combine severity and repeat count so broad fixes are easier to schedule.', {
    color: mutedInk,
    fontSize: 10,
    gapAfter: 12,
    lineHeight: 12.5,
    width: layout.contentWidth,
  });
  drawTableHeader(layout, ['Impact', 'Issue family', 'Recommended direction', 'Count'], [0, 58, 292, 450]);

  for (const group of groups) {
    drawRemediationRow(layout, group);
  }

  layout.addGap(18);
}

function drawRemediationRow(layout: PdfLayout, group: FindingGroupSummary): void {
  const document = layout.document;
  const issueWidth = 206;
  const guidanceWidth = 142;
  document.setFont('helvetica', 'bold');
  document.setFontSize(9.2);
  const issueLines = splitText(document, group.title, issueWidth);
  document.setFont('helvetica', 'normal');
  document.setFontSize(8.8);
  const guidanceLines = splitText(document, getPlanGuidance(group), guidanceWidth);
  const issueHeight = issueLines.length * 10.8 + 22;
  const guidanceHeight = guidanceLines.length * 10.8 + 12;
  const rowHeight = Math.max(42, issueHeight, guidanceHeight);
  layout.ensureSpace(rowHeight + 2);
  const y = layout.cursorY;

  document.setDrawColor(...faintBorder);
  document.line(layout.marginLeft, y + rowHeight, layout.marginLeft + layout.contentWidth, y + rowHeight);
  document.setFillColor(...severityRgb(group.severity));
  document.rect(layout.marginLeft, y + 6, 4, rowHeight - 12, 'F');
  document.setFont('helvetica', 'bold');
  document.setFontSize(8.2);
  document.setTextColor(...severityRgb(group.severity));
  document.text(severityLabel(group.severity).toUpperCase(), layout.marginLeft + 12, y + 18);
  document.setFontSize(9.2);
  document.setTextColor(...ink);
  document.text(issueLines, layout.marginLeft + 58, y + 15);
  document.setFont('helvetica', 'normal');
  document.setFontSize(8.2);
  document.setTextColor(...softInk);
  document.text(`${group.engines} | ${group.ruleId}`, layout.marginLeft + 58, y + rowHeight - 8);
  document.setFontSize(8.8);
  document.setTextColor(...mutedInk);
  document.text(guidanceLines, layout.marginLeft + 292, y + 15);
  document.setFont('helvetica', 'bold');
  document.setFontSize(9.5);
  document.setTextColor(...accent);
  document.text(String(group.count), layout.marginLeft + 460, y + 18);
  layout.cursorY += rowHeight + 2;
}

export async function drawImagePlate(
  layout: PdfLayout,
  input: {readonly caption: string; readonly dataUrl: string; readonly maxHeight: number},
): Promise<void> {
  const document = layout.document;
  let imageDimensions: {readonly height: number; readonly width: number};

  try {
    imageDimensions = await getImageDimensions(input.dataUrl);
  } catch {
    drawEmptyState(layout, 'Evidence image could not be loaded.');

    return;
  }

  const captionLines = splitText(document, input.caption, layout.contentWidth);
  const scale = Math.min(layout.contentWidth / imageDimensions.width, input.maxHeight / imageDimensions.height, 1);
  const imageWidth = imageDimensions.width * scale;
  const imageHeight = imageDimensions.height * scale;
  const blockHeight = captionLines.length * 12 + imageHeight + 24;
  layout.ensureSpace(blockHeight + 12);
  const y = layout.cursorY;

  document.setFont('helvetica', 'bold');
  document.setFontSize(9.5);
  document.setTextColor(...ink);
  document.text(captionLines, layout.marginLeft, y + 10);
  document.setDrawColor(...border);
  document.roundedRect(
    layout.marginLeft + (layout.contentWidth - imageWidth) / 2,
    y + captionLines.length * 12 + 10,
    imageWidth,
    imageHeight,
    4,
    4,
    'S',
  );
  document.addImage(
    input.dataUrl,
    'PNG',
    layout.marginLeft + (layout.contentWidth - imageWidth) / 2,
    y + captionLines.length * 12 + 10,
    imageWidth,
    imageHeight,
  );
  layout.cursorY += blockHeight + 12;
}

export function drawAppendixIntro(layout: PdfLayout, findingCount: number, evidenceCount: number): void {
  drawText(
    layout,
    `${findingCount} findings are listed below. ${evidenceCount} findings include inline element evidence captured during export.`,
    {color: mutedInk, fontSize: 10, gapAfter: 12, lineHeight: 12.5, width: layout.contentWidth},
  );
}

export async function drawFindingEntry(
  layout: PdfLayout,
  input: {readonly evidence?: PdfEvidenceImage; readonly index: number; readonly violation: KodeGlassViolation},
): Promise<void> {
  const document = layout.document;
  const violation = input.violation;
  const findingLabel = `F-${padNumber(input.index)}`;
  const title = getReadableSummary(violation);
  const titleX = layout.marginLeft + 72;
  const titleWidth = layout.contentWidth - 72;
  document.setFont('helvetica', 'bold');
  document.setFontSize(10.5);
  const titleLines = splitText(document, title, titleWidth);
  const headerHeight = Math.max(52, titleLines.length * 12.8 + 31);
  const firstContentHeight = estimateFindingOpeningHeight(document, layout, violation, input.evidence);
  layout.ensureSpace(headerHeight + firstContentHeight);
  const y = layout.cursorY;

  document.setDrawColor(...border);
  document.setLineWidth(0.7);
  document.line(layout.marginLeft, y, layout.marginLeft + layout.contentWidth, y);
  document.setFillColor(...severityRgb(violation.severity));
  document.rect(layout.marginLeft, y + 10, 4, headerHeight - 20, 'F');
  document.setFont('helvetica', 'bold');
  document.setFontSize(10);
  document.setTextColor(...ink);
  document.text(findingLabel, layout.marginLeft + 12, y + 20);
  document.setFontSize(7.8);
  document.setTextColor(...severityRgb(violation.severity));
  document.text(severityLabel(violation.severity).toUpperCase(), layout.marginLeft + 12, y + 35);
  document.setFontSize(10.5);
  document.setTextColor(...ink);
  document.text(titleLines, titleX, y + 18);
  document.setFont('helvetica', 'normal');
  document.setFontSize(8.5);
  document.setTextColor(...softInk);
  document.text(`${formatViolationEngines(violation)} | ${violation.ruleId}`, titleX, y + titleLines.length * 12.8 + 25);
  layout.cursorY = y + headerHeight;

  drawFindingMeta(layout, violation, Boolean(input.evidence));

  if (input.evidence) {
    await drawInlineEvidence(layout, input.evidence);
  }

  drawFindingField(layout, 'Selector', violation.selector, {code: true});

  if (violation.componentScope?.label) {
    drawFindingField(layout, 'Component', violation.componentScope.label);
  }

  if (violation.description) {
    drawFindingField(layout, 'Check', violation.description);
  }

  if (violation.guidance) {
    drawFindingField(layout, 'Fix', getReadableGuidance(violation.guidance));
  }

  if (violation.helpUrl) {
    drawFindingField(layout, 'Reference', violation.helpUrl, {url: violation.helpUrl});
  }

  layout.addGap(16);
}

function drawFindingMeta(layout: PdfLayout, violation: KodeGlassViolation, hasEvidence: boolean): void {
  const items = [
    `Severity: ${severityLabel(violation.severity)}`,
    `Rule: ${violation.ruleId}`,
    hasEvidence ? 'Evidence: included below' : 'Evidence: not captured',
  ];
  drawText(layout, items.join(' | '), {
    color: softInk,
    fontSize: 8.8,
    gapAfter: 8,
    lineHeight: 11.2,
    width: layout.contentWidth - 72,
    x: layout.marginLeft + 72,
  });
}

async function drawInlineEvidence(layout: PdfLayout, evidence: PdfEvidenceImage): Promise<void> {
  const document = layout.document;
  let imageDimensions: {readonly height: number; readonly width: number};

  try {
    imageDimensions = await getImageDimensions(evidence.dataUrl);
  } catch {
    drawFindingField(layout, 'Evidence', 'Evidence image could not be loaded.');

    return;
  }

  const x = layout.marginLeft + 72;
  const width = layout.contentWidth - 72;
  const captionLines = splitText(document, 'Evidence', width);
  const scale = Math.min(width / imageDimensions.width, 150 / imageDimensions.height, 1);
  const imageWidth = imageDimensions.width * scale;
  const imageHeight = imageDimensions.height * scale;
  const blockHeight = captionLines.length * 10 + imageHeight + 18;
  layout.ensureSpace(blockHeight + 8);
  const y = layout.cursorY;

  document.setFont('helvetica', 'bold');
  document.setFontSize(7.8);
  document.setTextColor(...accent);
  document.text(captionLines, x, y);
  document.setDrawColor(...border);
  document.roundedRect(x, y + 8, imageWidth, imageHeight, 4, 4, 'S');
  document.addImage(evidence.dataUrl, 'PNG', x, y + 8, imageWidth, imageHeight);
  layout.cursorY += blockHeight + 8;
}

function estimateFindingOpeningHeight(
  document: jsPDF,
  layout: PdfLayout,
  violation: KodeGlassViolation,
  evidence?: PdfEvidenceImage,
): number {
  const selectorWidth = layout.contentWidth - 72 - 16;
  document.setFont('courier', 'normal');
  document.setFontSize(7.4);
  const selectorLineCount = splitText(document, violation.selector, selectorWidth).length;
  const selectorHeight = Math.min(72, selectorLineCount * 9.7 + 24);
  const evidenceHeight = evidence ? 185 : 0;

  return 34 + evidenceHeight + selectorHeight;
}

function drawFindingField(
  layout: PdfLayout,
  label: string,
  value: string,
  options: {readonly code?: boolean; readonly url?: string} = {},
): void {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return;
  }

  layout.ensureSpace(24);
  const document = layout.document;
  document.setFont('helvetica', 'bold');
  document.setFontSize(7.8);
  document.setTextColor(...accent);
  document.text(label.toUpperCase(), layout.marginLeft + 72, layout.cursorY);
  layout.cursorY += 10;

  if (options.code) {
    drawCodeText(layout, normalizedValue, {x: layout.marginLeft + 72, width: layout.contentWidth - 72});

    return;
  }

  drawText(layout, normalizedValue, {
    color: options.url ? linkBlue : mutedInk,
    fontSize: 9.2,
    gapAfter: 8,
    lineHeight: 11.5,
    url: options.url,
    width: layout.contentWidth - 72,
    x: layout.marginLeft + 72,
  });
}

function drawText(
  layout: PdfLayout,
  text: string,
  options: {
    readonly color: Rgb;
    readonly fontSize: number;
    readonly fontStyle?: 'bold' | 'normal';
    readonly gapAfter?: number;
    readonly lineHeight: number;
    readonly url?: string;
    readonly width: number;
    readonly x?: number;
  },
): void {
  const document = layout.document;
  const x = options.x ?? layout.marginLeft;
  document.setFont('helvetica', options.fontStyle ?? 'normal');
  document.setFontSize(options.fontSize);
  document.setTextColor(...options.color);

  for (const line of splitText(document, text || '-', options.width)) {
    layout.ensureSpace(options.lineHeight + 2);
    document.text(line, x, layout.cursorY);

    if (options.url && isHttpUrl(options.url)) {
      const linkWidth = Math.min(document.getTextWidth(line), options.width);
      document.link(x, layout.cursorY - options.fontSize, linkWidth, options.lineHeight, {url: options.url});
      document.setDrawColor(...linkBlue);
      document.setLineWidth(0.35);
      document.line(x, layout.cursorY + 1.8, x + linkWidth, layout.cursorY + 1.8);
    }

    layout.cursorY += options.lineHeight;
  }

  if (options.gapAfter) {
    layout.addGap(options.gapAfter);
  }
}

function drawCodeText(layout: PdfLayout, text: string, options: {readonly width: number; readonly x: number}): void {
  const document = layout.document;
  const paddingX = 8;
  const paddingY = 7;
  const lineHeight = 9.7;
  document.setFont('courier', 'normal');
  document.setFontSize(7.4);
  const lines = splitText(document, text || '-', options.width - paddingX * 2);
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    layout.ensureSpace(34);
    const availableLines = Math.max(1, Math.floor((layout.remainingHeight - paddingY * 2) / lineHeight));
    const chunk = lines.slice(lineIndex, lineIndex + availableLines);
    const blockHeight = chunk.length * lineHeight + paddingY * 2;
    const y = layout.cursorY;
    document.setFillColor(248, 250, 252);
    document.setDrawColor(...faintBorder);
    document.roundedRect(options.x, y, options.width, blockHeight, 4, 4, 'FD');
    document.setFont('courier', 'normal');
    document.setFontSize(7.4);
    document.setTextColor(...mutedInk);
    document.text(chunk, options.x + paddingX, y + paddingY + 7);
    layout.cursorY += blockHeight + 6;
    lineIndex += chunk.length;
  }
}

function drawTableHeader(layout: PdfLayout, labels: readonly string[], offsets: readonly number[]): void {
  const document = layout.document;
  layout.ensureSpace(24);
  document.setFillColor(...paper);
  document.rect(layout.marginLeft, layout.cursorY, layout.contentWidth, 22, 'F');
  document.setFont('helvetica', 'bold');
  document.setFontSize(7.8);
  document.setTextColor(...softInk);

  for (const [index, label] of labels.entries()) {
    document.text(label.toUpperCase(), layout.marginLeft + (offsets[index] ?? 0), layout.cursorY + 14);
  }

  layout.cursorY += 24;
}

export function drawEmptyState(layout: PdfLayout, text: string): void {
  layout.ensureSpace(34);
  drawText(layout, text, {color: softInk, fontSize: 10, gapAfter: 12, lineHeight: 12.5, width: layout.contentWidth});
}

function createFindingGroups(violations: readonly KodeGlassViolation[]): readonly FindingGroupSummary[] {
  const groups = violations.reduce((groupMap, violation) => {
    const key = `${formatViolationEngines(violation)}:${violation.ruleId}`;
    const current = groupMap.get(key);
    groupMap.set(key, {
      count: (current?.count ?? 0) + 1,
      engines: current?.engines ?? formatViolationEngines(violation),
      guidance: current?.guidance ?? violation.guidance,
      ruleId: violation.ruleId,
      severity: getHighestSeverity(current?.severity, violation.severity),
      title: current?.title ?? getReadableSummary(violation),
    });

    return groupMap;
  }, new Map<string, FindingGroupSummary>());

  return [...groups.values()].sort((first, second) => {
    const severityDelta = severityRank(second.severity) - severityRank(first.severity);

    return severityDelta || second.count - first.count || first.ruleId.localeCompare(second.ruleId);
  });
}

export function addPageNumbers(document: jsPDF, layout: PdfLayout): void {
  const pageCount = document.getNumberOfPages();

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    document.setPage(pageNumber);
    document.setFont('helvetica', 'normal');
    document.setFontSize(8.5);
    document.setTextColor(...softInk);
    document.setDrawColor(...faintBorder);
    document.line(layout.marginLeft, layout.pageHeight - 34, layout.pageWidth - layout.marginRight, layout.pageHeight - 34);
    document.text('Kode Glass Accessibility QA', layout.marginLeft, layout.pageHeight - 18);
    document.text(`Page ${pageNumber} of ${pageCount}`, layout.pageWidth - layout.marginRight - 58, layout.pageHeight - 18);
  }
}

function addLinkAnnotations(document: jsPDF, lines: readonly string[], x: number, firstBaselineY: number, lineHeight: number, url: string): void {
  if (!isHttpUrl(url)) {
    return;
  }

  for (const [index, line] of lines.entries()) {
    const baselineY = firstBaselineY + index * lineHeight;
    document.link(x, baselineY - lineHeight + 2, document.getTextWidth(line), lineHeight, {url});
  }
}

function splitText(document: jsPDF, text: string, width: number): string[] {
  const lines = document.splitTextToSize(normalizeText(text), width) as string[] | string;

  return Array.isArray(lines) ? lines.map(String) : [String(lines)];
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function countSeverity(violations: readonly KodeGlassViolation[], severity: ViolationSeverity): number {
  return violations.filter(violation => violation.severity === severity).length;
}

function formatEnabledSeverities(filters: ViolationFilterSettings): string {
  return Object.entries(filters.severity)
    .filter(([, enabled]) => enabled)
    .map(([severity]) => severity)
    .join(', ') || 'none';
}

function formatFilterEngine(engine: ViolationFilterSettings['engine']): string {
  if (engine === 'axe') {
    return 'axe';
  }

  if (engine === 'ibm') {
    return 'IBM Equal Access';
  }

  return 'axe + IBM Equal Access';
}

function formatScanScopes(report: AccessibilityReport): string {
  const overlayCount = report.scanScopes.filter(scope => scope.kind === 'overlay').length;
  const totalElements = report.scanScopes.reduce((total, scope) => total + scope.elementCount, 0);

  return `${report.scanScopes.length} scopes, ${overlayCount} overlays, ${totalElements} scoped elements`;
}

function countCoverageStatus(report: AccessibilityReport, status: WcagCoverageStatus): number {
  return report.coverage.filter(item => item.status === status).length;
}

function formatCoverageStatus(status: WcagCoverageStatus): string {
  return ({
    failed: 'Failed',
    'needs-manual-review': 'Manual',
    'not-tested': 'Not tested',
    'passed-automated': 'Passed',
  } as Record<WcagCoverageStatus, string>)[status];
}

function formatViolationEngines(violation: KodeGlassViolation): string {
  const engines = violation.sourceEngines ?? [violation.engine];

  return engines.map(formatViolationEngine).join(' + ');
}

function formatViolationEngine(engine: KodeGlassViolation['engine']): string {
  return ({
    'axe-core': 'axe',
    'ibm-equal-access': 'IBM',
    manual: 'Manual',
    playwright: 'Playwright',
  } as Record<KodeGlassViolation['engine'], string>)[engine];
}

function getReadableSummary(violation: KodeGlassViolation): string {
  return getReadableViolationSummary(violation);
}

function getReadableGuidance(guidance: string): string {
  return getReadableViolationGuidance(guidance);
}

function getPlanGuidance(group: FindingGroupSummary): string {
  if (group.guidance) {
    return getReadableGuidance(group.guidance);
  }

  if (group.ruleId.includes('contrast')) {
    return 'Update color tokens or text styles until the affected states meet WCAG contrast requirements.';
  }

  if (group.ruleId.includes('label') || group.ruleId.includes('name')) {
    return 'Add programmatic names or labels and verify the result with keyboard and screen reader checks.';
  }

  if (group.ruleId.includes('focus') || group.ruleId.includes('tabbable')) {
    return 'Review focus order, visibility, and keyboard operation for the affected interactive elements.';
  }

  return 'Review the affected pattern once, then apply the fix consistently across repeated instances.';
}

function getHighestSeverity(current: ViolationSeverity | undefined, next: ViolationSeverity): ViolationSeverity {
  if (!current) {
    return next;
  }

  return severityRank(next) > severityRank(current) ? next : current;
}

function padNumber(value: number): string {
  return String(value).padStart(3, '0');
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

async function getImageDimensions(dataUrl: string): Promise<{readonly height: number; readonly width: number}> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({height: image.height, width: image.width});
    image.onerror = () => reject(new Error('Failed to load evidence image.'));
    image.src = dataUrl;
  });
}
