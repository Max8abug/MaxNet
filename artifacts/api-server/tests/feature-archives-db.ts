import assert from "node:assert/strict";

export let archiveRow: { archivedFeatures: unknown } | undefined;
export function setArchiveRow(value: typeof archiveRow) { archiveRow = value; }
export const siteSettingsTable = { archivedFeatures: "archive-column" };
export const db = {
  select(fields: unknown) {
    // Fail if polling ever starts selecting the full settings/image row.
    assert.deepEqual(fields, { archivedFeatures: siteSettingsTable.archivedFeatures });
    return {
      from(table: unknown) {
        assert.equal(table, siteSettingsTable);
        return { async limit(count: number) {
          assert.equal(count, 1);
          return archiveRow ? [archiveRow] : [];
        } };
      },
    };
  },
};
