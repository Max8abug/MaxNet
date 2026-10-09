type User = { id: string; username: string };
type PreviewAuthState = {
  user: User;
  ranks: string[];
  refreshRanks: () => Promise<void>;
};

const state: PreviewAuthState = {
  user: { id: "wiki-preview", username: "Community editor" },
  ranks: ["wiki-editor"],
  refreshRanks: async () => {},
};

export function usePreviewWikiAuth<T>(select: (state: PreviewAuthState) => T): T {
  return select(state);
}

export function hasPermission(_user: unknown, permission: string, _ranks: string[]): boolean {
  return permission === "editWiki";
}
