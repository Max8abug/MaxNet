const BASE = "/api";

const opts: RequestInit = { credentials: "include" };

export interface Drawing {
  id: number;
  author: string;
  dataUrl: string;
  createdAt: string;
}

export interface ChatMessage {
  id: number;
  author: string;
  body: string;
  imageUrl?: string | null;
  createdAt: string;
}

export interface GuestbookEntry {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface SharedPhoto {
  id: number;
  caption: string;
  dataUrl: string;
  createdAt: string;
}

export interface AuthUser {
  id: number;
  username: string;
  isAdmin: boolean;
  avatarUrl?: string | null;
  backgroundUrl?: string | null;
  backgroundColor?: string | null;
}

export async function updateProfile(data: { avatarUrl?: string | null; backgroundUrl?: string | null; backgroundColor?: string | null }): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/auth/profile`, {
    ...opts, method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }));
}

export interface PublicUser { username: string; isAdmin: boolean; avatarUrl: string | null; }
export async function fetchUserProfile(username: string): Promise<PublicUser | null> {
  const j = await jsonOrThrow(await fetch(`${BASE}/users/${encodeURIComponent(username)}`, opts));
  return j.user ?? null;
}

async function jsonOrThrow(r: Response) {
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

// ----- Auth -----
export async function getMe(): Promise<AuthUser | null> {
  const r = await fetch(`${BASE}/auth/me`, opts);
  const j = await jsonOrThrow(r);
  return j.user ?? null;
}
export async function login(username: string, password: string): Promise<AuthUser> {
  const r = await fetch(`${BASE}/auth/login`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const j = await jsonOrThrow(r);
  return j.user;
}
export async function signup(username: string, password: string): Promise<AuthUser> {
  const r = await fetch(`${BASE}/auth/signup`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const j = await jsonOrThrow(r);
  return j.user;
}
export async function logout(): Promise<void> {
  await fetch(`${BASE}/auth/logout`, { ...opts, method: "POST" });
}

// ----- Drawings -----
export async function fetchDrawings(): Promise<Drawing[]> {
  return jsonOrThrow(await fetch(`${BASE}/drawings`, opts));
}
export async function deleteDrawing(id: number): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/drawings/${id}`, { ...opts, method: "DELETE" }));
}
export async function submitDrawing(dataUrl: string, author: string): Promise<Drawing> {
  return jsonOrThrow(await fetch(`${BASE}/drawings`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl, author }),
  }));
}

// ----- Chat -----
export async function fetchChat(): Promise<ChatMessage[]> {
  return jsonOrThrow(await fetch(`${BASE}/chat`, opts));
}
export async function postChat(body: string, imageUrl?: string | null): Promise<ChatMessage> {
  return jsonOrThrow(await fetch(`${BASE}/chat`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, imageUrl: imageUrl || null }),
  }));
}
export async function clearChat(): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/chat`, { ...opts, method: "DELETE" }));
}

export async function deleteChatMessage(id: number): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/chat/${id}`, { ...opts, method: "DELETE" }));
}

export interface ChatAuditEntry {
  id: number;
  action: string;
  actor: string;
  target: string;
  body: string;
  createdAt: string;
}
export async function fetchChatAudit(): Promise<ChatAuditEntry[]> {
  return jsonOrThrow(await fetch(`${BASE}/chat/audit`, opts));
}

export interface BannedUser {
  id: number;
  username: string;
  bannedBy: string;
  reason: string;
  createdAt: string;
}
export async function fetchBans(): Promise<BannedUser[]> {
  return jsonOrThrow(await fetch(`${BASE}/bans`, opts));
}
export async function addBan(username: string, reason: string): Promise<BannedUser> {
  return jsonOrThrow(await fetch(`${BASE}/bans`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, reason }),
  }));
}
export async function removeBan(username: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/bans/${encodeURIComponent(username)}`, {
    ...opts, method: "DELETE",
  }));
}

// ----- Guestbook -----
export async function fetchGuestbook(): Promise<GuestbookEntry[]> {
  return jsonOrThrow(await fetch(`${BASE}/guestbook`, opts));
}
export async function postGuestbook(body: string, author: string): Promise<GuestbookEntry> {
  return jsonOrThrow(await fetch(`${BASE}/guestbook`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, author }),
  }));
}
export async function deleteGuestbookEntry(id: number): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/guestbook/${id}`, { ...opts, method: "DELETE" }));
}

// ----- Photos -----
export async function fetchPhotos(): Promise<SharedPhoto[]> {
  return jsonOrThrow(await fetch(`${BASE}/photos`, opts));
}
export async function uploadPhoto(dataUrl: string, caption: string): Promise<SharedPhoto> {
  return jsonOrThrow(await fetch(`${BASE}/photos`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl, caption }),
  }));
}
export async function deletePhoto(id: number): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/photos/${id}`, { ...opts, method: "DELETE" }));
}

// ----- Visits -----
export async function getVisits(): Promise<number> {
  const j = await jsonOrThrow(await fetch(`${BASE}/visits`, opts));
  return j.count ?? 0;
}
export async function pingVisit(): Promise<number> {
  const j = await jsonOrThrow(await fetch(`${BASE}/visits`, { ...opts, method: "POST" }));
  return j.count ?? 0;
}

// ----- Forum -----
export interface ForumThread { id: number; title: string; author: string; createdAt: string; postCount: number; }
export interface ForumPost { id: number; threadId: number; author: string; body: string; imageUrl?: string | null; createdAt: string; }
export async function fetchThreads(): Promise<ForumThread[]> {
  return jsonOrThrow(await fetch(`${BASE}/forum/threads`, opts));
}
export async function fetchThread(id: number): Promise<{ thread: ForumThread; posts: ForumPost[] }> {
  return jsonOrThrow(await fetch(`${BASE}/forum/threads/${id}`, opts));
}
export async function createThread(title: string, body: string): Promise<ForumThread> {
  return jsonOrThrow(await fetch(`${BASE}/forum/threads`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body }),
  }));
}
export async function postReply(threadId: number, body: string, imageUrl?: string | null): Promise<ForumPost> {
  return jsonOrThrow(await fetch(`${BASE}/forum/threads/${threadId}/posts`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, imageUrl: imageUrl || null }),
  }));
}
export async function deleteForumPost(id: number): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/forum/posts/${id}`, { ...opts, method: "DELETE" }));
}
export async function deleteForumThread(id: number): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/forum/threads/${id}`, { ...opts, method: "DELETE" }));
}

// ----- Synced YouTube -----
export interface YouTubeSync { videoId: string; startedAt: string; setBy: string; serverNow: string; }
export async function getYouTubeSync(): Promise<YouTubeSync> {
  return jsonOrThrow(await fetch(`${BASE}/youtube/sync`, opts));
}
export async function setYouTubeSync(videoId: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/youtube/sync`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId }),
  }));
}

// ----- Blackjack -----
export interface BJState {
  tableId?: number;
  phase: "waiting" | "playing" | "dealer" | "done";
  dealerHand: { r: string; s: string }[];
  dealerValue: number;
  players: { username: string; hand: { r: string; s: string }[]; value: number; status: string; bet: number }[];
  currentTurn: number;
  log: string[];
  deckRemaining: number;
}
export async function bjState(): Promise<BJState> { return jsonOrThrow(await fetch(`${BASE}/blackjack`, opts)); }
export async function bjJoin(): Promise<BJState> { return jsonOrThrow(await fetch(`${BASE}/blackjack/join`, { ...opts, method: "POST" })); }
export async function bjLeave(): Promise<BJState> { return jsonOrThrow(await fetch(`${BASE}/blackjack/leave`, { ...opts, method: "POST" })); }
export async function bjDeal(): Promise<BJState> { return jsonOrThrow(await fetch(`${BASE}/blackjack/deal`, { ...opts, method: "POST" })); }
export async function bjHit(): Promise<BJState> { return jsonOrThrow(await fetch(`${BASE}/blackjack/hit`, { ...opts, method: "POST" })); }
export async function bjStand(): Promise<BJState> { return jsonOrThrow(await fetch(`${BASE}/blackjack/stand`, { ...opts, method: "POST" })); }

// ----- Flappy -----
export interface FlappyPlayer { username: string; y: number; score: number; alive: boolean; updatedAt: string; }
export interface FlappyScore { id: number; username: string; score: number; createdAt: string; }
export async function flappyState(): Promise<{ players: FlappyPlayer[]; top: FlappyScore[] }> {
  return jsonOrThrow(await fetch(`${BASE}/flappy/state`, opts));
}
export async function flappyTick(y: number, score: number, alive: boolean): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/flappy/tick`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ y, score, alive }),
  }));
}
export async function flappyScore(score: number): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/flappy/score`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score }),
  }));
}
