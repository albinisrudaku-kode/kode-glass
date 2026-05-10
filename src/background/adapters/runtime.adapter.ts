export async function sendRuntimeMessage<TMessage>(message: TMessage): Promise<void> {
  await chrome.runtime.sendMessage(message);
}

export function addRuntimeMessageListener(
  listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0],
): void {
  chrome.runtime.onMessage.addListener(listener);
}
