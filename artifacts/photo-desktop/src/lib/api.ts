const BASE = "/api";

const opts: RequestInit = { credentials: "include" };

export interface Drawing {
  id: number;
  author: string;
  dataUrl: string;
  createdAt: string;
  score: number;
  myVote: number;
}

export interface ChatMessage {
  id: number;
  author: string;
  body: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  replyTo?: number | null;
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
  rank?: string | null;
}

export async function updateProfile(data: { avatarUrl?: string | null; backgroundUrl?: string | null; backgroundColor?: string | null }): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/auth/profile`, {
    ...opts, method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }));
}

export interface PublicUser { username: string; isAdmin: boolean; avatarUrl: string | null; rank?: string | null; }
export async function fetchUsers(): Promise<PublicUser[]> {
  return jsonOrThrow(await fetch(`${BASE}/users`, opts));
}
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
export async function voteDrawing(id: number, vote: -1 | 0 | 1): Promise<{ ok: true; score: number; myVote: number }> {
  return jsonOrThrow(await fetch(`${BASE}/drawings/${id}/vote`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vote }),
  }));
}

// ----- Chat -----
export async function fetchChat(): Promise<ChatMessage[]> {
  return jsonOrThrow(await fetch(`${BASE}/chat`, opts));
}
export async function postChat(body: string, imageUrl?: string | null, videoUrl?: string | null, replyTo?: number | null): Promise<ChatMessage> {
  return jsonOrThrow(await fetch(`${BASE}/chat`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, imageUrl: imageUrl || null, videoUrl: videoUrl || null, replyTo: replyTo ?? null }),
  }));
}
export async function pingTyping(): Promise<void> {
  try { await fetch(`${BASE}/chat/typing`, { ...opts, method: "POST" }); } catch {}
}
export async function fetchTyping(): Promise<string[]> {
  try { const j = await jsonOrThrow(await fetch(`${BASE}/chat/typing`, opts)); return j.typing || []; } catch { return []; }
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
export interface ForumThread { id: number; title: string; author: string; createdAt: string; postCount: number; hasPassword?: boolean; }
export interface ForumPost { id: number; threadId: number; author: string; body: string; imageUrl?: string | null; createdAt: string; }
export async function fetchThreads(): Promise<ForumThread[]> {
  return jsonOrThrow(await fetch(`${BASE}/forum/threads`, opts));
}
export async function fetchThread(id: number): Promise<{ thread: ForumThread; posts: ForumPost[] }> {
  return jsonOrThrow(await fetch(`${BASE}/forum/threads/${id}`, opts));
}
export async function fetchThreadOrLock(id: number): Promise<{ ok: true; thread: ForumThread; posts: ForumPost[] } | { ok: false; needsPassword: true; thread: ForumThread }> {
  const r = await fetch(`${BASE}/forum/threads/${id}`, opts);
  const j = await r.json();
  if (r.ok) return { ok: true, ...j };
  if (j?.needsPassword) return { ok: false, needsPassword: true, thread: j.thread };
  throw new Error(j?.error || `HTTP ${r.status}`);
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
  turnStartedAt?: number;
  serverNow?: number;
}
export async function bjState(): Promise<BJState> { return jsonOrThrow(await fetch(`${BASE}/blackjack`, opts)); }
export async function bjJoin(): Promise<BJState> { return jsonOrThrow(await fetch(`${BASE}/blackjack/join`, { ...opts, method: "POST" })); }
export async function bjLeave(): Promise<BJState> { return jsonOrThrow(await fetch(`${BASE}/blackjack/leave`, { ...opts, method: "POST" })); }
export async function bjDeal(): Promise<BJState> { return jsonOrThrow(await fetch(`${BASE}/blackjack/deal`, { ...opts, method: "POST" })); }
export async function bjHit(): Promise<BJState> { return jsonOrThrow(await fetch(`${BASE}/blackjack/hit`, { ...opts, method: "POST" })); }
export async function bjStand(): Promise<BJState> { return jsonOrThrow(await fetch(`${BASE}/blackjack/stand`, { ...opts, method: "POST" })); }
export async function bjSkip(): Promise<BJState> { return jsonOrThrow(await fetch(`${BASE}/blackjack/skip`, { ...opts, method: "POST" })); }
export async function bjReset(): Promise<BJState> { return jsonOrThrow(await fetch(`${BASE}/blackjack/reset`, { ...opts, method: "POST" })); }

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

// ----- Ranks -----
export interface Rank { id: number; name: string; color: string; permissions: string[]; tier: number; }
export async function fetchRanks(): Promise<Rank[]> { return jsonOrThrow(await fetch(`${BASE}/ranks`, opts)); }
export async function createRank(name: string, color: string, permissions: string[], tier: number): Promise<Rank> {
  return jsonOrThrow(await fetch(`${BASE}/ranks`, { ...opts, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, color, permissions, tier }) }));
}
export async function deleteRank(name: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/ranks/${encodeURIComponent(name)}`, { ...opts, method: "DELETE" }));
}
export async function assignRank(username: string, rank: string | null): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/ranks/assign`, { ...opts, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, rank }) }));
}

// ----- Forum (passwords) -----
export async function createThreadWithOpts(title: string, body: string, password?: string): Promise<ForumThread> {
  return jsonOrThrow(await fetch(`${BASE}/forum/threads`, { ...opts, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, body, password: password || undefined }) }));
}
export async function unlockThread(id: number, password: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/forum/threads/${id}/unlock`, { ...opts, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }));
}

// ----- DMs -----
export interface DMContact { username: string; avatarUrl: string | null; rank: string | null; isAdmin: boolean; }
export interface DMMessage { id: number; fromUser: string; toUser: string; body: string; createdAt: string; }
export interface DMConversation { partner: string; lastBody: string; lastAt: string; unread: number; }
export async function fetchDMContacts(): Promise<DMContact[]> { return jsonOrThrow(await fetch(`${BASE}/dms/contacts`, opts)); }
export async function fetchDMConversations(): Promise<DMConversation[]> { return jsonOrThrow(await fetch(`${BASE}/dms`, opts)); }
export async function fetchDMs(other: string): Promise<DMMessage[]> { return jsonOrThrow(await fetch(`${BASE}/dms/${encodeURIComponent(other)}`, opts)); }
export async function sendDM(other: string, body: string): Promise<DMMessage> {
  return jsonOrThrow(await fetch(`${BASE}/dms/${encodeURIComponent(other)}`, { ...opts, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) }));
}

// ----- Polls -----
export interface Poll { id: number; question: string; creator: string; options: { id: number; label: string }[]; votes: Record<string, number>; createdAt: string; }
export async function fetchPolls(): Promise<Poll[]> { return jsonOrThrow(await fetch(`${BASE}/polls`, opts)); }
export async function createPoll(question: string, options: string[]): Promise<Poll> {
  return jsonOrThrow(await fetch(`${BASE}/polls`, { ...opts, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, options }) }));
}
export async function votePoll(id: number, optionId: number): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/polls/${id}/vote`, { ...opts, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ optionId }) }));
}
export async function deletePoll(id: number): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/polls/${id}`, { ...opts, method: "DELETE" }));
}

// ----- Music -----
export interface Track { id: number; uploader: string; title: string; createdAt: string; }
export async function fetchTracks(): Promise<Track[]> { return jsonOrThrow(await fetch(`${BASE}/music`, opts)); }
export async function fetchTrackAudio(id: number): Promise<string> {
  const j = await jsonOrThrow(await fetch(`${BASE}/music/${id}/audio`, opts));
  return j.dataUrl;
}
export async function uploadTrack(title: string, dataUrl: string): Promise<Track> {
  return jsonOrThrow(await fetch(`${BASE}/music`, { ...opts, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, dataUrl }) }));
}
export async function deleteTrack(id: number): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/music/${id}`, { ...opts, method: "DELETE" }));
}

// ----- User pages -----
export type UserPageElement =
  | { type: "text"; x: number; y: number; w: number; h: number; content: string; color: string; size: number }
  | { type: "image"; x: number; y: number; w: number; h: number; url: string }
  | { type: "embed"; x: number; y: number; w: number; h: number; url: string };
export interface UserPage { dataUrl: string; elements?: UserPageElement[]; updatedAt: string; }
export async function fetchUserPage(username: string): Promise<UserPage | null> {
  const j = await jsonOrThrow(await fetch(`${BASE}/userpages/${encodeURIComponent(username)}`, opts));
  return j.page;
}
export async function saveUserPage(dataUrl: string, elements: UserPageElement[] = []): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/userpages`, { ...opts, method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl, elements }) }));
}
export async function clearUserPage(username: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/userpages/${encodeURIComponent(username)}`, { ...opts, method: "DELETE" }));
}

// ----- Cafe -----
export interface CafePresence { username: string; x: number; y: number; avatar: any; lastSeen: string; }
export interface CafeChatMsg { id: number; author: string; body: string; createdAt: string; }
export interface CafeState { presence: CafePresence[]; chat: CafeChatMsg[]; theme: string; }
export async function fetchCafeState(): Promise<CafeState> { return jsonOrThrow(await fetch(`${BASE}/cafe/state`, opts)); }
export async function moveCafe(x: number, y: number, avatar: any): Promise<void> {
  await fetch(`${BASE}/cafe/move`, { ...opts, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x, y, avatar }) });
}
export async function sayCafe(body: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/cafe/say`, { ...opts, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) }));
}
export async function setCafeTheme(theme: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/cafe/theme`, { ...opts, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme }) }));
}
export async function leaveCafe(): Promise<void> {
  try { await fetch(`${BASE}/cafe/leave`, { ...opts, method: "POST" }); } catch {}
}

// ----- Chess -----
export interface ChessLobby { id: number; name: string; hostUser: string; whiteUser: string | null; blackUser: string | null; fen: string; moves: string[]; status: string; winner: string | null; chat: { author: string; body: string; at: number }[]; updatedAt: string; createdAt: string; }
export async function fetchChessLobbies(): Promise<ChessLobby[]> { return jsonOrThrow(await fetch(`${BASE}/chess/lobbies`, opts)); }
export async function createChessLobby(name: string): Promise<ChessLobby> {
  return jsonOrThrow(await fetch(`${BASE}/chess/lobbies`, { ...opts, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }));
}
export async function fetchChessLobby(id: number): Promise<ChessLobby> { return jsonOrThrow(await fetch(`${BASE}/chess/lobbies/${id}`, opts)); }
export async function joinChessLobby(id: number): Promise<void> { await jsonOrThrow(await fetch(`${BASE}/chess/lobbies/${id}/join`, { ...opts, method: "POST" })); }
export async function moveChess(id: number, uci: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/chess/lobbies/${id}/move`, { ...opts, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uci }) }));
}
export async function resignChess(id: number): Promise<void> { await jsonOrThrow(await fetch(`${BASE}/chess/lobbies/${id}/resign`, { ...opts, method: "POST" })); }
export async function chatChess(id: number, body: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/chess/lobbies/${id}/chat`, { ...opts, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) }));
}
export async function fetchChessMoves(id: number): Promise<string[]> {
  const j = await jsonOrThrow(await fetch(`${BASE}/chess/lobbies/${id}/moves`, opts));
  return j.moves || [];
}
