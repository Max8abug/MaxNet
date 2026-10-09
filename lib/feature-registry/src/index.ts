// Browser-safe, dependency-free archive metadata. IDs are persisted WindowType
// values: never rename them. Register new archivable features here once.
// Archiving is launcher visibility only, not authorization or data deletion.
export const ARCHIVABLE_FEATURES = [
  { id: "planner", name: "Planner", category: "Info" },
  { id: "news", name: "Site News", category: "Info" },
  { id: "sharedphotos", name: "Photo Gallery", category: "Info" },
  { id: "userlist", name: "Users", category: "Info" },
  { id: "visits", name: "Visitor Counter", category: "Info" },
  { id: "guestbook", name: "Guestbook", category: "Info" },
  { id: "chess", name: "Chess", category: "Games" },
  { id: "blackjack", name: "Blackjack", category: "Games" },
  { id: "flappy", name: "Flappy Bird", category: "Games" },
  { id: "geometry", name: "Geometry Dash", category: "Games" },
  { id: "poker", name: "Poker", category: "Games" },
  { id: "eaglercraft", name: "Eaglercraft", category: "Games" },
  { id: "newcp", name: "New Club Penguin", category: "Games" },
  { id: "terraria", name: "Terraria", category: "Games" },
  { id: "mypage", name: "My Page", category: "Social" },
  { id: "forum", name: "Forum", category: "Social" },
  { id: "chat", name: "Chatbox", category: "Social" },
  { id: "dms", name: "Direct Messages", category: "Social" },
  { id: "youtube", name: "Synced YouTube", category: "Social" },
  { id: "cafe", name: "Cafe", category: "Social" },
  { id: "browser", name: "Web Browser", category: "Social" },
  { id: "polls", name: "Polls", category: "Social" },
  { id: "music", name: "Music Player", category: "Social" },
  { id: "personalplaylists", name: "My Playlists", category: "Social" },
  { id: "drawing", name: "Drawing Pad", category: "Social" },
  { id: "link", name: "Link Shortcut", category: "Tools" },
  { id: "text", name: "Text Note", category: "Tools" },
] as const;

export type ArchivableFeatureId = (typeof ARCHIVABLE_FEATURES)[number]["id"];

// UI visibility and API availability are intentionally separate. Cafe stays
// unavailable from launchers while its API remains available to dependent apps.
export const HIDDEN_LAUNCHER_FEATURES = ["cafe"] as const satisfies readonly ArchivableFeatureId[];
const hiddenLauncherFeatureIds: ReadonlySet<string> = new Set(HIDDEN_LAUNCHER_FEATURES);

export function isFeatureHiddenFromLaunchers(value: unknown): boolean {
  return typeof value === "string" && hiddenLauncherFeatureIds.has(value);
}

// Only list features here when their API must return 503. Hiding a launcher
// must never disable service endpoints used by other features.
export const API_DISABLED_FEATURES: readonly ArchivableFeatureId[] = [];
const apiDisabledFeatureIds: ReadonlySet<string> = new Set(API_DISABLED_FEATURES);

export function isApiFeatureDisabled(value: unknown): boolean {
  return typeof value === "string" && apiDisabledFeatureIds.has(value);
}

// These launchers must remain available to manage access and restore features.
export const PROTECTED_LAUNCHER_IDS = [
  "settings", "ranksadmin", "accountadmin", "sitesettings", "featurearchive",
  "themelab", "sitebackup", "diagnostics", "iplookup",
] as const;
export type ProtectedLauncherId = (typeof PROTECTED_LAUNCHER_IDS)[number];
export type LauncherWindowId = ArchivableFeatureId | ProtectedLauncherId;

const featureIds: ReadonlySet<string> = new Set(ARCHIVABLE_FEATURES.map((feature) => feature.id));

export function isArchivableFeatureId(value: unknown): value is ArchivableFeatureId {
  return typeof value === "string" && featureIds.has(value);
}

export function cleanArchivedFeatures(value: unknown): ArchivableFeatureId[] {
  return Array.isArray(value) ? [...new Set(value.filter(isArchivableFeatureId))] : [];
}
