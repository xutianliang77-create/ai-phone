export async function runAbortable<T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw abortError(signal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(operation).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort))
      .catch(() => undefined);
  });
}

export function isAborted(_error: unknown, signal: AbortSignal) {
  return signal.aborted;
}

function abortError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("Pipeline operation aborted", "AbortError");
}
