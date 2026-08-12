import { describe, expect, it } from "vitest";
import type { TableSchema } from "spyglass-protocol";
import { inferForeignKeys } from "../inferForeignKeys.js";

function table(name: string, columnNames: string[]): TableSchema {
  return {
    name,
    columns: [
      { name: "id", isPrimaryKey: true },
      ...columnNames.map((n) => ({ name: n })),
    ],
  };
}

describe("inferForeignKeys", () => {
  it("matches a column against an exactly-named table (existing behavior)", () => {
    const schema = [table("users", []), table("posts", ["user_id", "title"])];
    expect(inferForeignKeys(schema, "posts")).toEqual({ user_id: "users" });
  });

  it("matches a column against a pluralized-with-ies table name", () => {
    const schema = [table("categories", []), table("posts", ["category_id"])];
    expect(inferForeignKeys(schema, "posts")).toEqual({ category_id: "categories" });
  });

  it("falls back to a suffix match when exactly one compound table name matches", () => {
    const schema = [table("product_image", []), table("reviews", ["image_id"])];
    expect(inferForeignKeys(schema, "reviews")).toEqual({ image_id: "product_image" });
  });

  it("does not connect when the suffix match is ambiguous (2+ candidate tables elsewhere)", () => {
    const schema = [
      table("face_gallery", []),
      table("fingerprint_gallery", []),
      table("sync_history", ["gallery_id"]),
    ];
    expect(inferForeignKeys(schema, "sync_history")).toEqual({});
  });

  it("regression: does not falsely connect two tables that share both a name suffix and the ambiguous column — the actual screenshot bug", () => {
    // face_gallery and fingerprint_gallery both end in "_gallery" AND both
    // have their own gallery_id column. Naively excluding `currentTable`
    // before counting candidates makes each one look like "the only other
    // _gallery table" from the other's perspective — a false unique match
    // in both directions. Must stay unconnected both ways.
    const schema = [table("face_gallery", ["gallery_id"]), table("fingerprint_gallery", ["gallery_id"])];
    expect(inferForeignKeys(schema, "face_gallery")).toEqual({});
    expect(inferForeignKeys(schema, "fingerprint_gallery")).toEqual({});
  });

  it("does not connect a column with no matching table at all — the screenshot's gallery_entry_id case", () => {
    const schema = [table("face_gallery", []), table("sync_history", ["gallery_entry_id"])];
    expect(inferForeignKeys(schema, "sync_history")).toEqual({});
  });

  it("prefers an exact match over a suffix match when both exist", () => {
    const schema = [table("gallery", []), table("face_gallery", []), table("sync_history", ["gallery_id"])];
    expect(inferForeignKeys(schema, "sync_history")).toEqual({ gallery_id: "gallery" });
  });

  it("excludes self-references via the suffix path, same as the exact-match path", () => {
    const schema = [table("face_gallery", ["gallery_id"])];
    expect(inferForeignKeys(schema, "face_gallery")).toEqual({});
  });

  it("ignores tables with no primary key / id column as candidates", () => {
    const noIdTable: TableSchema = { name: "face_gallery", columns: [{ name: "face_hash" }] };
    const schema = [noIdTable, table("sync_history", ["gallery_id"])];
    expect(inferForeignKeys(schema, "sync_history")).toEqual({});
  });

  it("never treats the literal 'id' column itself as a foreign key", () => {
    const schema = [table("id", []), table("posts", [])];
    expect(inferForeignKeys(schema, "posts")).toEqual({});
  });
});
