import {getErrorMessage} from '../shared/error-boundary';
import {
  type EvidenceVideoBufferToggledMessage,
  type EvidenceVideoBufferToggleResponse,
  type EvidenceVideoRollbackRequestedMessage,
  type EvidenceVideoRollbackResponse,
} from '../shared/messages';
import {activeTabId, buildEvidenceFileNameBase} from './message-router';

const videoBuffersByTab = new Map<number, TabVideoBufferState>();
const videoChunkTimesliceMs = 1000;
const maxRollbackWindowMs = 5 * 60 * 1000;

export interface TabVideoBufferState {
  readonly chunks: Array<{readonly blob: Blob; readonly recordedAt: number}>;
  readonly mimeType: string;
  readonly recorder: MediaRecorder;
  readonly stream: MediaStream;
}

export async function toggleVideoBuffer(
  message: EvidenceVideoBufferToggledMessage,
): Promise<EvidenceVideoBufferToggleResponse> {
  const tabId = message.tabId ?? activeTabId;

  if (tabId === undefined) {
    return {error: 'No active tab available for video buffering.', ok: false};
  }

  if (!message.payload.enabled) {
    await stopVideoBuffer(tabId);

    return {ok: true};
  }

  try {
    await startVideoBuffer(tabId);

    return {ok: true};
  } catch (error) {
    await stopVideoBuffer(tabId);

    return {error: getErrorMessage(error), ok: false};
  }
}

export async function downloadRollbackVideo(
  message: EvidenceVideoRollbackRequestedMessage,
): Promise<EvidenceVideoRollbackResponse> {
  const tabId = message.tabId ?? activeTabId;

  if (tabId === undefined) {
    return {error: 'No active tab available for rollback export.', ok: false};
  }

  const state = videoBuffersByTab.get(tabId);

  if (!state) {
    return {error: 'Video buffer is not running for this tab.', ok: false};
  }

  const cutoff = Date.now() - message.payload.minutes * 60_000;
  const selectedChunks = state.chunks.filter(chunk => chunk.recordedAt >= cutoff).map(chunk => chunk.blob);

  if (!selectedChunks.length) {
    return {error: 'No buffered footage available for the selected rollback window.', ok: false};
  }

  const blob = new Blob(selectedChunks, {type: state.mimeType});
  const objectUrl = URL.createObjectURL(blob);

  try {
    const filename = `${buildEvidenceFileNameBase('rollback')}-${message.payload.minutes}m.webm`;
    await chrome.downloads.download({filename, saveAs: true, url: objectUrl});
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }

  return {ok: true};
}

export async function startVideoBuffer(tabId: number): Promise<void> {
  await stopVideoBuffer(tabId);

  const stream = await new Promise<MediaStream>((resolve, reject) => {
    chrome.tabCapture.capture({audio: false, video: true}, capturedStream => {
      if (chrome.runtime.lastError || !capturedStream) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'Failed to start tab capture.'));

        return;
      }

      resolve(capturedStream);
    });
  });

  const mimeType = getPreferredRecorderMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, {mimeType}) : new MediaRecorder(stream);
  const state: TabVideoBufferState = {
    chunks: [],
    mimeType: mimeType || recorder.mimeType || 'video/webm',
    recorder,
    stream,
  };

  recorder.addEventListener('dataavailable', event => {
    if (!event.data || event.data.size === 0) {
      return;
    }

    state.chunks.push({blob: event.data, recordedAt: Date.now()});
    pruneVideoChunks(state);
  });

  recorder.addEventListener('stop', () => {
    stream.getTracks().forEach(track => track.stop());
  });

  recorder.start(videoChunkTimesliceMs);
  videoBuffersByTab.set(tabId, state);
}

export async function stopVideoBuffer(tabId: number): Promise<void> {
  const state = videoBuffersByTab.get(tabId);

  if (!state) {
    return;
  }

  videoBuffersByTab.delete(tabId);

  if (state.recorder.state !== 'inactive') {
    state.recorder.stop();
  }

  state.stream.getTracks().forEach(track => track.stop());
}

export function pruneVideoChunks(state: TabVideoBufferState): void {
  const cutoff = Date.now() - maxRollbackWindowMs;
  const firstIndexInWindow = state.chunks.findIndex(chunk => chunk.recordedAt >= cutoff);

  if (firstIndexInWindow <= 0) {
    return;
  }

  state.chunks.splice(0, firstIndexInWindow);
}

export function getPreferredRecorderMimeType(): string | undefined {
  const preferredMimeTypes = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  return preferredMimeTypes.find(mimeType => MediaRecorder.isTypeSupported(mimeType));
}
