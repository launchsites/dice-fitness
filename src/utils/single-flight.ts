const inFlight = new Map<string, Promise<void>>();

/** Serialize refreshes so a mutation during an older refresh always gets projected. */
export async function singleFlight(key: string, work: () => Promise<void>): Promise<void> {
  const existing = inFlight.get(key) ?? Promise.resolve();
  const promise = existing.catch(() => {}).then(work).finally(() => { if (inFlight.get(key) === promise) inFlight.delete(key); });
  inFlight.set(key, promise);
  return promise;
}
