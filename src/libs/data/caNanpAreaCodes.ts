/**
 * Vendored Canadian NANP area-code (NPA) dataset.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §9.5 —
 * this dataset is SECONDARY validation of an explicitly stored recipient
 * country, never the primary source of country truth (+1 is not proof of
 * Canada; Canada and the US share the numbering plan).
 *
 * Source: NANPA area-code assignments, Canadian geographic NPAs.
 * Snapshot date: 2026-08 (Gate A vendoring). Update path: replace the two
 * sets below from the current NANPA report and bump this snapshot date —
 * additions are routine (new overlays are announced years ahead).
 */

/** Geographic Canadian area codes (in service or in announced overlay service). */
export const CA_GEOGRAPHIC_AREA_CODES: ReadonlySet<string> = new Set([
  '204',
  '226',
  '236',
  '249',
  '250',
  '263',
  '289',
  '306',
  '343',
  '354',
  '365',
  '367',
  '368',
  '382',
  '387',
  '403',
  '416',
  '418',
  '428',
  '431',
  '437',
  '438',
  '450',
  '460',
  '468',
  '474',
  '506',
  '514',
  '519',
  '548',
  '579',
  '581',
  '584',
  '587',
  '604',
  '613',
  '639',
  '647',
  '672',
  '683',
  '705',
  '709',
  '742',
  '753',
  '778',
  '780',
  '782',
  '807',
  '819',
  '825',
  '867',
  '873',
  '879',
  '902',
  '905',
]);

/**
 * Non-geographic NANP codes (toll-free and service codes) shared across
 * the whole numbering plan. A number in one of these codes is
 * COUNTRY-AMBIGUOUS by construction — it must never be attributed to
 * Canada (or anywhere) from the code alone.
 */
export const NANP_NON_GEOGRAPHIC_AREA_CODES: ReadonlySet<string> = new Set([
  '800',
  '833',
  '844',
  '855',
  '866',
  '877',
  '888',
  '900',
]);
