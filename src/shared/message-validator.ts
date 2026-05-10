/**
 * Sender validation utilities for Chrome extension message handling.
 * Provides type-safe checks to verify messages originate from trusted contexts.
 */

const SIDE_PANEL_PORT_NAME = 'kode-glass-side-panel' as const;

/**
 * Checks if the message sender is this extension (not an external page or other extension).
 * Validates sender.id matches our extension ID.
 */
export function isInternalMessage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id;
}

/**
 * Checks if the message originates from a content script context.
 * Content script messages have both our extension ID and a tab ID.
 */
export function isContentScriptMessage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.tab?.id !== undefined;
}

/**
 * Checks if the port is the side panel connection.
 */
export function isPortConnection(port: chrome.runtime.Port): boolean {
  return port.name === SIDE_PANEL_PORT_NAME;
}