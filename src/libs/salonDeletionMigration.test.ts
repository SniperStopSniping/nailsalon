import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('deletion cleanup migration release contract', () => {
  it('blocks a missing or reordered predecessor sequence before release', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'deletion-release-order-'));
    const reviewedSql = await readFile(path.join(process.cwd(), 'migrations/0113_salon_deletion_cleanup.sql'));
    const script = path.join(process.cwd(), 'scripts/verify-salon-deletion-migration-order.mjs');
    const deletion = { idx: 112, tag: '0113_salon_deletion_cleanup', when: 2000 };
    const preceding = Array.from({ length: 15 }, (_, index) => ({ idx: 97 + index, tag: `${String(98 + index).padStart(4, '0')}_test`, when: 1000 + index }));
    try {
      await mkdir(path.join(root, 'migrations/meta'), { recursive: true });
      await writeFile(path.join(root, 'migrations/0113_salon_deletion_cleanup.sql'), reviewedSql);
      for (const [entries, status] of [
        [[deletion], 1],
        [[...preceding, deletion], 0],
        [[...preceding.slice().reverse(), deletion], 1],
      ] as const) {
        await writeFile(path.join(root, 'migrations/meta/_journal.json'), JSON.stringify({ entries }));

        expect(spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' }).status).toBe(status);
      }
      await writeFile(path.join(root, 'migrations/meta/_journal.json'), JSON.stringify({ entries: [...preceding, deletion] }));
      await writeFile(path.join(root, 'migrations/0113_salon_deletion_cleanup.sql'), `${reviewedSql.toString()}\n-- unreviewed mutation`);
      const changed = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });

      expect(changed.status).toBe(1);
      expect(changed.stderr).toContain('SQL does not match the reviewed immutable postimage');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reserves 0113 after the separately reviewed 0098–0112 sequence', async () => {
    const journal = JSON.parse(await readFile(path.join(process.cwd(), 'migrations/meta/_journal.json'), 'utf8'));
    const entry = journal.entries.filter((item: { tag: string }) => item.tag === '0113_salon_deletion_cleanup');

    expect(entry).toEqual([{ idx: 112, version: '7', when: 1792449000000, tag: '0113_salon_deletion_cleanup', breakpoints: true }]);
    expect(entry[0].when).toBeGreaterThan(1792303500000);

    const migration = await readFile(path.join(process.cwd(), 'migrations/0113_salon_deletion_cleanup.sql'), 'utf8');

    expect(migration).not.toMatch(/REFERENCES\s+"?salon"?/i);
    expect(migration).toContain('"salon_deletion_cleanup_source_once"');
    expect(migration).toContain('"media_removed" + jsonb_array_length("pending_assets") = "media_total"');
  });
});
