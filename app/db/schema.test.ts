import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import * as schema from "./schema";

const tables = Object.values(schema as Record<string, unknown>).filter(
  (value): value is SQLiteTable => is(value, SQLiteTable)
);

// SQLite can only use an index for a lookup on its leading column, so a
// foreign key counts as indexed when it is the first column of an index or
// unique constraint, or is unique on its own.
function unindexedForeignKeys(table: SQLiteTable): string[] {
  const config = getTableConfig(table);
  const leadingColumns = new Set<string>([
    ...config.columns.filter((column) => column.isUnique).map((c) => c.name),
    ...config.indexes.map((index) => {
      const [first] = index.config.columns;
      return first && "name" in first ? first.name : "";
    }),
    ...config.uniqueConstraints.map(
      (constraint) => constraint.columns[0]?.name ?? ""
    ),
  ]);

  return config.foreignKeys
    .map((foreignKey) => foreignKey.reference().columns[0]?.name ?? "")
    .filter((column) => !leadingColumns.has(column))
    .map((column) => `${config.name}.${column}`);
}

describe("schema", () => {
  it("indexes every foreign key", () => {
    expect(tables.flatMap(unindexedForeignKeys)).toEqual([]);
  });
});
