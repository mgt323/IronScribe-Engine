export interface CatalogSection<T extends { id: string; name: string }> {
  get(id: string): T | undefined;
  /** Exact id/name match wins; otherwise every entry containing all query words. */
  find(query: string): readonly T[];
  /** Sorted by id. */
  list(): readonly T[];
}

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function createSection<T extends { id: string; name: string }>(
  entries: readonly T[],
): CatalogSection<T> {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(sorted.map((e) => [e.id, e]));
  if (byId.size !== sorted.length) throw new Error('duplicate catalog id');
  const indexed = sorted.map((e) => ({
    entry: e,
    id: normalizeText(e.id),
    name: normalizeText(e.name),
    words: new Set(normalizeText(e.name).split(' ')),
  }));
  return {
    get: (id) => byId.get(id),
    list: () => sorted,
    find(query) {
      const q = normalizeText(query);
      if (q === '') return [];
      const exact = indexed.filter((x) => x.id === q || x.name === q);
      if (exact.length > 0) return exact.map((x) => x.entry);
      const tokens = q.split(' ');
      return indexed.filter((x) => tokens.every((t) => x.words.has(t))).map((x) => x.entry);
    },
  };
}
