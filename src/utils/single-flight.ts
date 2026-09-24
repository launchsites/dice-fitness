const inFlight = new Map<string, Promise<void>>();

/** Coalesces concurrent projection refreshes in this one long-polling process. */
export async function singleFlight(key: string, work: () => Promise<void>): Promise<void> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = work().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
