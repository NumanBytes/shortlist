// Bounds a Redis call. Depending on connection state, a dead Redis either errors at once
// ("Connection is closed") or makes ioredis/BullMQ wait for a ready connection
// indefinitely — both were observed — and an HTTP request must never hang on that.
// Rejects with a timeout error if `op` hasn't settled in time. The losing promise gets a
// no-op catch, so a late rejection doesn't become an unhandled rejection.
export async function withTimeout<T>(op: Promise<T>, ms: number, what = 'Redis'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no response from ${what} in ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([op, timeout]);
  } finally {
    clearTimeout(timer);
    op.catch(() => undefined);
  }
}
