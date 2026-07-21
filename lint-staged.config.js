module.exports = {
  // Lint JS/TS in src (don't try to lint images, SQL, etc.)
  'src/**/*.{js,jsx,ts,tsx}': ['eslint --fix --no-warn-ignored'],

  // Type-check when any TS/TSX file is staged
  '**/*.ts?(x)': () => 'npm run check-types',

  // NOTE: this hook used to run `db:generate` on Schema.ts changes and
  // `db:migrate:dev` on migration changes. Both were removed deliberately.
  //
  // drizzle's snapshots in migrations/meta/ stop at 0009, so `db:generate` no
  // longer diffs against the real schema — it emits a full ~235-statement dump
  // recreating every type, table and constraint as a brand new migration, and
  // registers it in _journal.json. `db:migrate:dev` then ran in the same hook,
  // against the database dev and production share, so an ordinary commit could
  // have applied that dump to live data.
  //
  // Migrations here are hand-written. Write the SQL, add the entry to
  // migrations/meta/_journal.json, and apply it deliberately with:
  //   npx dotenv -e .env.development.local -- npx drizzle-kit migrate
  // Do not reinstate `db:generate` until the snapshots are rebuilt.
};
