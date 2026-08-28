export async function settlesWithin(
  promise: Promise<void>,
  timeoutMs: number,
) {
  if (timeoutMs <= 0) {
    return Promise.race([promise.then(() => true), Promise.resolve(false)]);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
