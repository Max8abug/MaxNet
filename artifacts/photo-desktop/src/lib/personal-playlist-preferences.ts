type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function shufflePreferenceKey(username: string): string {
  return `photo-desktop:personal-playlists:${encodeURIComponent(username.trim().toLowerCase())}:shuffle`;
}

export function readPersonalPlaylistShufflePreference(
  username: string,
  storage?: PreferenceStorage,
): boolean {
  try {
    return (storage ?? window.localStorage).getItem(shufflePreferenceKey(username)) === "true";
  } catch {
    return false;
  }
}

export function writePersonalPlaylistShufflePreference(
  username: string,
  enabled: boolean,
  storage?: PreferenceStorage,
): boolean {
  try {
    (storage ?? window.localStorage).setItem(shufflePreferenceKey(username), String(enabled));
    return true;
  } catch {
    return false;
  }
}
