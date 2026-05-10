import {signal, type Signal} from '@angular/core';
import {getErrorMessage} from '../../shared/error-boundary';
import type {
  AccessibilityReport,
  ComponentScope,
  EvidenceCaptureMode,
  KodeGlassViolation,
  ViolationFilterSettings,
} from '../../shared/accessibility-report';
import {RuntimeMessageType, type RuntimeMessage, type ViolationSelectedPayload} from '../../shared/messages';
import {buildFilteredReportPdf, type PdfEvidenceImage} from './report-pdf';
import {getReadableSummary, selectEvidenceViolations, wait} from './violation-grouping';

const pdfFindingEvidenceLimit = 36;

export interface PdfServiceCallbacks {
  readonly getPageReport: () => AccessibilityReport | null;
  readonly getVisibleViolations: () => readonly KodeGlassViolation[];
  readonly getSelectedViolation: () => ViolationSelectedPayload | null;
  readonly getSelectedComponentScope: () => ComponentScope | null;
  readonly getViolationFilterSettings: () => ViolationFilterSettings;
  readonly captureEvidenceImageData: (
    mode: EvidenceCaptureMode,
    options?: {readonly silent?: boolean; readonly throttled?: boolean},
  ) => Promise<string | null>;
  readonly sendRuntimeMessage: (message: RuntimeMessage) => void;
  readonly setError: (error: string | null) => void;
}

export class PdfService {
  readonly pdfExportPending: Signal<boolean>;
  private readonly pdfExportPendingSignal = signal(false);

  constructor(private readonly callbacks: PdfServiceCallbacks) {
    this.pdfExportPending = this.pdfExportPendingSignal.asReadonly();
  }

  async exportReport(): Promise<void> {
    const report = this.callbacks.getPageReport();

    if (!report || this.pdfExportPending()) {
      return;
    }

    this.callbacks.setError(null);
    this.pdfExportPendingSignal.set(true);

    try {
      const visibleViolations = this.callbacks.getVisibleViolations();
      const evidenceImages: PdfEvidenceImage[] = [];
      const fullScreenImage = await this.callbacks.captureEvidenceImageData('full-screen', {silent: true, throttled: true});

      if (fullScreenImage) {
        evidenceImages.push({caption: 'Full page snapshot', dataUrl: fullScreenImage});
      }

      const findingEvidence = await this.captureFindingEvidenceImages(visibleViolations, pdfFindingEvidenceLimit);
      evidenceImages.push(...findingEvidence);

      const pdfBlob = await buildFilteredReportPdf({
        createdAt: Date.now(),
        evidenceImages,
        focusedViolationId: this.callbacks.getSelectedViolation()?.violationId,
        report,
        selectedComponentLabel: this.callbacks.getSelectedComponentScope()?.label,
        violationFilters: this.callbacks.getViolationFilterSettings(),
        visibleViolations,
      });
      const objectUrl = URL.createObjectURL(pdfBlob);

      try {
        await chrome.downloads.download({
          filename: `kode-glass-report-${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`,
          saveAs: true,
          url: objectUrl,
        });
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      }
    } catch (error) {
      this.callbacks.setError(`Unable to export PDF report: ${getErrorMessage(error)}`);
    } finally {
      this.pdfExportPendingSignal.set(false);
    }
  }

  private async captureFindingEvidenceImages(
    violations: readonly KodeGlassViolation[],
    maxImages: number,
  ): Promise<readonly PdfEvidenceImage[]> {
    if (!violations.length || maxImages <= 0) {
      return [];
    }

    const previousFocus = this.callbacks.getSelectedViolation();
    const evidenceImages: PdfEvidenceImage[] = [];
    const rankedViolations = selectEvidenceViolations(violations, maxImages);

    try {
      for (const [index, violation] of rankedViolations.entries()) {
        this.callbacks.sendRuntimeMessage({
          payload: {selector: violation.selector, violationId: violation.id},
          type: RuntimeMessageType.ViolationFocusChanged,
        });
        await wait(250);
        const elementSnapshot = await this.callbacks.captureEvidenceImageData('element', {silent: true, throttled: true});

        if (!elementSnapshot) {
          continue;
        }

        evidenceImages.push({
          caption: `${index + 1}. ${getReadableSummary(violation)} (${violation.severity})`,
          dataUrl: elementSnapshot,
          violationId: violation.id,
        });
      }
    } finally {
      this.callbacks.sendRuntimeMessage({payload: previousFocus, type: RuntimeMessageType.ViolationFocusChanged});
    }

    return evidenceImages;
  }
}
