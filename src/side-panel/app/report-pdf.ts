import {jsPDF} from 'jspdf';
import {
  type BuildReportPdfInput,
  PdfLayout,
  addPageNumbers,
  drawAppendixIntro,
  drawCover,
  drawEmptyState,
  drawFindingEntry,
  drawImagePlate,
  drawRemediationPlan,
  drawScanContext,
  drawSectionTitle,
  drawSeveritySummary,
  drawWcagCoverageSummary,
  drawEngineStatusTable,
} from './pdf-section-builder';

export {type BuildReportPdfInput, type PdfEvidenceImage} from './pdf-section-builder';

export async function buildFilteredReportPdf(input: BuildReportPdfInput): Promise<Blob> {
  const document = new jsPDF({compress: true, format: 'a4', unit: 'pt'});
  const layout = new PdfLayout(document, {
    bottom: 54,
    left: 54,
    right: 54,
    top: 48,
  });
  const pageEvidence = input.evidenceImages.find(image => !image.violationId);
  const findingEvidence = input.evidenceImages.filter(image => image.violationId);
  const evidenceByViolationId = new Map(
    findingEvidence
      .filter(image => image.violationId)
      .map(image => [image.violationId as string, image]),
  );

  drawCover(layout, input);
  layout.addPage();

  drawSectionTitle(layout, 'Assessment Snapshot', 'Scope, filters, scan health, and the current risk profile.');
  drawScanContext(layout, input);
  drawSeveritySummary(layout, input.visibleViolations, input.report.violations.length);
  drawEngineStatusTable(layout, input.report.engineStatuses);
  drawWcagCoverageSummary(layout, input.report);

  drawSectionTitle(layout, 'Remediation Plan', 'Highest-impact issue families grouped for triage.');
  drawRemediationPlan(layout, input.visibleViolations);

  if (pageEvidence) {
    drawSectionTitle(layout, 'Page Context', 'Full page capture for orientation. Element evidence appears directly inside each finding.');
    await drawImagePlate(layout, {
      caption: 'Full page context',
      dataUrl: pageEvidence.dataUrl,
      maxHeight: 230,
    });
  }

  drawSectionTitle(layout, 'Finding Appendix', 'Complete filtered finding list with evidence, selectors, remediation notes, and links.');
  drawAppendixIntro(layout, input.visibleViolations.length, findingEvidence.length);

  if (!input.visibleViolations.length) {
    drawEmptyState(layout, 'No findings matched the selected filters.');
  }

  for (const [index, violation] of input.visibleViolations.entries()) {
    await drawFindingEntry(layout, {
      evidence: evidenceByViolationId.get(violation.id),
      index: index + 1,
      violation,
    });
  }

  addPageNumbers(document, layout);
  const bytes = document.output('arraybuffer');

  return new Blob([bytes], {type: 'application/pdf'});
}
