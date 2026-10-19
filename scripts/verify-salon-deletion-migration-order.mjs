import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const { entries } = JSON.parse(readFileSync('migrations/meta/_journal.json', 'utf8'));
const deletion = entries.find(entry => entry.tag === '0113_salon_deletion_cleanup');
if (deletion) {
  const reviewedSqlHash = '265265ad444a3d65f8f1f657513fa733ec3ce02850969a661a04265fb96a680b';
  const actualSqlHash = createHash('sha256').update(readFileSync('migrations/0113_salon_deletion_cleanup.sql')).digest('hex');
  if (actualSqlHash !== reviewedSqlHash) {
    console.error('Deletion migration 0113 SQL does not match the reviewed immutable postimage.');
    process.exitCode = 1;
  }
  const preceding = entries.filter(entry => entry.idx >= 97 && entry.idx <= 111);
  if (deletion.idx !== 112 || preceding.length !== 15
    || preceding.some((entry, index) => entry.idx !== 97 + index
      || !entry.tag.startsWith(`${String(98 + index).padStart(4, '0')}_`))
      || preceding.some(entry => entry.when >= deletion.when)
      || entries.some((entry, index) => index > 0 && entry.when <= entries[index - 1].when)) {
    console.error('Deletion migration 0113 is release-blocked: integrate the reviewed 0098–0112 sequence and rehearse the combined migration ledger first.');
    process.exitCode = 1;
  }
}
