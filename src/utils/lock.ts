const active = new Set<number>();

export async function withUserLock<T>(userId: number, task: () => Promise<T>): Promise<T | undefined> {
  if (active.has(userId)) return undefined;
  active.add(userId);
  try { return await task(); } finally { active.delete(userId); }
}
