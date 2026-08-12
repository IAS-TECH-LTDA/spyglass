import type { TableSchema } from "spyglass-protocol";

/**
 * Heuristic foreign-key detection: a column named `xxx_id` is treated as a
 * reference to a table named `xxx`, `xxxs`, or `xxxies` (for `y`-ending
 * names), matched case-insensitively against the tables in this snapshot.
 * Only tables with a primary key (`isPrimaryKey`, or a column literally
 * named `id` as a fallback) are valid targets, since that's what clicking
 * the link — or drawing the diagram edge — matches against.
 *
 * Falls back to a *suffix* match when no table has that exact name — e.g.
 * `gallery_id` matching a table named `face_gallery`, for schemas whose
 * table names are prefixed/compound rather than the bare noun the column
 * stem implies. Only applied when it's unambiguous: if more than one table
 * ends in `_gallery`/`_galleries`, there's no way to tell which one the
 * column actually references, and guessing wrong would be worse than
 * drawing no line at all — so that case is deliberately left unconnected.
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

    const exact = candidates.map((c) => byLowerName.get(c)).find((name): name is string => Boolean(name));
    if (exact && exact !== currentTable) {
      result[column] = exact;
      continue;
    }

    // Ambiguity must be counted over *every* matching table, including
    // `currentTable` itself — excluding it first would turn a genuine
    // 2-way ambiguity (e.g. both `face_gallery` and `fingerprint_gallery`
    // end in `_gallery`) into a false "unique" match whenever evaluated
    // from either table's own perspective, silently connecting two tables
    // that just happen to share a column name.
    const allSuffixMatches = tablesWithId
      .map((t) => t.name)
      .filter((name) => candidates.some((c) => name.toLowerCase().endsWith(`_${c}`)));
    if (allSuffixMatches.length === 1 && allSuffixMatches[0] !== currentTable) {
      result[column] = allSuffixMatches[0];
    }
  }

  return result;
}
