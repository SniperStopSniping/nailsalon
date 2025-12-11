module.exports = {
  // Lint JS/TS in src (don't try to lint images, SQL, etc.)
  'src/**/*.{js,jsx,ts,tsx}': ['eslint --fix --no-warn-ignored'],

  // Type-check when any TS/TSX file is staged
  '**/*.ts?(x)': () => 'npm run check-types',

  // Auto-generate migration when Schema.ts changes
  'src/models/Schema.ts': () => 'npm run db:generate',

  // Auto-apply migrations to DEV database (never prod!)
  'migrations/**/*.sql': () => 'npm run db:migrate:dev',
};
