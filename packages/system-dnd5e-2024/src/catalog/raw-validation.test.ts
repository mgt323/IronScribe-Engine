import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { RAW_DIR } from './paths.js';
import { UPSTREAM_FILES } from './upstream/index.js';

// The import script points this at its staging directory before swapping it into raw/.
const DIR = process.env['SRD_RAW_DIR'] ?? RAW_DIR;
const staging = process.env['SRD_RAW_DIR'] !== undefined;

const read = (f: string): unknown => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
type Row = { index: string };

describe('raw data', () => {
  it('raw/ holds exactly the upstream files', () => {
    expect(readdirSync(DIR).sort()).toEqual(UPSTREAM_FILES.map((f) => f.raw).sort());
  });

  it.each(UPSTREAM_FILES.map((f) => [f.raw, f] as const))(
    '%s passes the strict upstream schema, ids unique',
    (_name, f) => {
      const rows = z.array(f.schema).parse(read(f.raw)) as Row[];
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.index)).size).toBe(rows.length);
    },
  );

  it.skipIf(staging)('entry counts match SOURCE.json and the commit is pinned', () => {
    const src = JSON.parse(readFileSync(join(DIR, '..', 'SOURCE.json'), 'utf8')) as {
      commit: string;
      files: { raw: string; entries: number }[];
    };
    expect(src.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(src.files.map((f) => f.raw).sort()).toEqual(UPSTREAM_FILES.map((f) => f.raw).sort());
    for (const f of src.files) {
      expect((read(f.raw) as unknown[]).length).toBe(f.entries);
    }
  });
});

// Upstream URL collection -> raw file. Nested urls (classes/x/levels/1) are not checked.
const COLLECTION_FILE: Record<string, string> = Object.fromEntries(
  UPSTREAM_FILES.map((f) => [f.raw.replace('.json', ''), f.raw]),
);

/**
 * Known references upstream leaves dangling at the pinned commit: Backgrounds and
 * Equipment point at tool proficiencies that proficiencies.json does not contain.
 */
const DANGLING_ALLOWED = new Set<string>(
  [
    'carpenters-tools',
    'cartographers-tools',
    'cobblers-tools',
    'cooks-utensils',
    'glassblowers-tools',
    'jewelers-tools',
    'leatherworkers-tools',
    'masons-tools',
    'painters-supplies',
    'potters-tools',
    'smiths-tools',
    'tinkers-tools',
    'weavers-tools',
    'woodcarvers-tools',
    'disguise-kit',
    'forgery-kit',
  ].map((t) => `proficiencies/tool-${t}`),
);

function collectRefs(node: unknown, out: { url: string; index: string }[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collectRefs(n, out);
  } else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o['url'] === 'string' && typeof o['index'] === 'string') {
      out.push({ url: o['url'], index: o['index'] });
    }
    for (const v of Object.values(o)) collectRefs(v, out);
  }
}

describe('cross-references', () => {
  it('every {index, url} reference resolves to an entry we carry', () => {
    const ids = new Map<string, Set<string>>();
    const refs: { file: string; url: string; index: string }[] = [];
    for (const f of UPSTREAM_FILES) {
      const rows = read(f.raw) as Row[];
      ids.set(f.raw.replace('.json', ''), new Set(rows.map((r) => r.index)));
      const found: { url: string; index: string }[] = [];
      collectRefs(rows, found);
      refs.push(...found.map((r) => ({ file: f.raw, ...r })));
    }
    const dangling = new Set<string>();
    for (const r of refs) {
      const parts = r.url.split('/');
      if (parts[1] !== 'api' || parts[2] !== '2024') {
        dangling.add(`${r.url} (not 2024)`);
        continue;
      }
      if (parts.length > 5) continue; // nested resource
      const collection = parts[3] ?? '';
      if (!COLLECTION_FILE[collection] || !ids.get(collection)?.has(parts[4] ?? '')) {
        dangling.add(`${collection}/${parts[4] ?? ''}`);
      }
    }
    const unexpected = [...dangling].filter((d) => !DANGLING_ALLOWED.has(d));
    expect(unexpected).toEqual([]);
  });
});
