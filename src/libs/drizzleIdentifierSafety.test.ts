import { EventEmitter } from 'node:events';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, pgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

const source = pgTable('drizzle_identifier_safety', {
  id: integer('id').primaryKey(),
});

// SQL rendering only: toSQL() must not ask this client to open a connection.
const db = drizzle(new EventEmitter() as never, { schema: { source } });

describe('PostgreSQL SQL identifier quoting', () => {
  it('escapes identifier and alias delimiters while keeping ordinary values parameterized', () => {
    const identifier = 'column"suffix';
    const alias = 'label"suffix';
    const value = 'ordinary user value';

    const query = db.select({
      result: sql`${sql.identifier(identifier)} || ${value}`.as(alias),
    }).from(source).toSQL();

    expect(query.sql).toContain('"column""suffix"');
    expect(query.sql).toContain('as "label""suffix"');
    expect(query.sql).toContain('from "drizzle_identifier_safety"');
    expect(query.params).toEqual([value]);
  });
});
