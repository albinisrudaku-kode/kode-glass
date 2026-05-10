import type {RuntimeMessage} from '../../shared/messages';

export async function dispatchRuntimeMessage(message: RuntimeMessage): Promise<void> {
  if (!chrome.runtime?.id) {
    throw new Error('Extension runtime is unavailable.');
  }

  await chrome.runtime.sendMessage(message);
}
