export function mergeMedia<T>(
  current: T[],
  previous: T[],
  identity: (item: T) => string | null,
): T[] {
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const item of [...current, ...previous]) {
    const id = identity(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(item);
    if (merged.length === 5) break;
  }
  return merged.length > 0 ? merged : current.slice(0, 5);
}
