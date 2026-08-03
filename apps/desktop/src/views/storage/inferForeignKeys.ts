import type { TableSchema } from "@datamobile/protocol";

/**
 * Heuristic foreign-key detection: a column named `xxx_id` is treated as a
 * reference to a table named `xxx`, `xxxs`, or `xxxies` (for `y`-ending
 * names), matched case-insensitively against the tables in this snapshot.
 * Only tables with a primary key (`isPrimaryKey`, or a column literally
 * named `id` as a fallback) are valid targets, since that's what clicking
 * the link — or drawing the diagram edge — matches against.
 */
export function inferForeignKeys(schema: TableSchema[], currentTable: string): Record<string, string> {
  const tablesWithId = schema.filter((t) => t.columns.some((c) => c.isPrimaryKey || c.name.toLowerCase() === "id"));
  const byLowerName = new Map(tablesWithId.map((t) => [t.name.toLowerCase(), t.name]));

  const result: Record<string, string> = {};
  const columns = schema.find((t) => t.name === currentTable)?.columns ?? [];

  for (const { name: column } of columns) {
    if (column.toLowerCase() === "id" || !column.toLowerCase().endsWith("_id")) continue;
    const stem = column.slice(0, -3).toLowerCase();
    const candidates = [stem, `${stem}s`, stem.endsWith("y") ? `${stem.slice(0, -1)}ies` : `${stem}es`];
    const match = candidates.map((c) => byLowerName.get(c)).find((name): name is string => Boolean(name));
    if (match && match !== currentTable) result[column] = match;
  }

  return result;
}
