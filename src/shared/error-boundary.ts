/**
 * Extracts a readable error message from an unknown error value.
 * Handles Error instances, string errors, and other primitives.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wraps an async operation to always return a success/failure result.
 * Use when you want to handle errors without try/catch blocks.
 *
 * @example
 * const result = await safeAsync(someRiskyOperation());
 * if (result.ok) {
 *   console.log(result.value);
 * } else {
 *   console.error(result.error);
 * }
 */
export async function safeAsync<T>(
  promise: Promise<T>,
): Promise<{ok: true; value: T} | {ok: false; error: string}> {
  try {
    const value = await promise;
    return {ok: true, value};
  } catch (err) {
    return {ok: false, error: getErrorMessage(err)};
  }
}

/**
 * No-op marker for intentional error silencing.
 * Use when you explicitly want to discard an error without swallowing it.
 *
 * @example
 * catch (e) {
 *   if (isExpected(e)) {
 *     silenced(); // Deliberately ignored
 *   } else {
 *     throw e;
 *   }
 * }
 */
export function silenced(): void {
  // Intentionally empty — signals deliberate ignore
}