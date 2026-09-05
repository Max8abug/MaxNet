import { db, siteSettingsTable } from "@workspace/db";

export type ContentBlockList = "username" | "chat" | "forum";
type BlockListColumn = "usernameBlockedPhrases" | "chatBlockedPhrases" | "forumBlockedPhrases";

const columns: Record<ContentBlockList, BlockListColumn> = {
  username: "usernameBlockedPhrases",
  chat: "chatBlockedPhrases",
  forum: "forumBlockedPhrases",
};

export function normalizeBlockedPhrases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((phrase): phrase is string => typeof phrase === "string")
      .map((phrase) => phrase.trim().replace(/\s+/g, " ").toLocaleLowerCase())
      .filter(Boolean)
      .map((phrase) => phrase.slice(0, 80))
  )].slice(0, 100);
}

export async function getBlockedPhrases(kind: ContentBlockList): Promise<string[]> {
  const [row] = await db.select({
    phrases: siteSettingsTable[columns[kind]],
  }).from(siteSettingsTable).limit(1);
  return normalizeBlockedPhrases(row?.phrases);
}

export function findBlockedPhrase(value: string, phrases: string[]): string | null {
  const normalized = value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return phrases.find((phrase) => normalized.includes(phrase)) || null;
}