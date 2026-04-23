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
export async function postChat(body: string): Promise<ChatMessage> {
  return jsonOrThrow(await fetch(`${BASE}/chat`, {
    ...opts, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  }));
}
export async function clearChat(): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/chat`, { ...opts, method: "DELETE" }));
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
