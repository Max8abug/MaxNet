const BASE = "/api";

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

export async function fetchDrawings(): Promise<Drawing[]> {
  const r = await fetch(`${BASE}/drawings`);
  if (!r.ok) throw new Error("Failed to load drawings");
  return r.json();
}

export async function submitDrawing(dataUrl: string, author: string): Promise<Drawing> {
  const r = await fetch(`${BASE}/drawings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl, author }),
  });
  if (!r.ok) throw new Error("Failed to submit drawing");
  return r.json();
}

export async function fetchChat(): Promise<ChatMessage[]> {
  const r = await fetch(`${BASE}/chat`);
  if (!r.ok) throw new Error("Failed to load chat");
  return r.json();
}

export async function postChat(body: string, author: string): Promise<ChatMessage> {
  const r = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, author }),
  });
  if (!r.ok) throw new Error("Failed to send message");
  return r.json();
}

export async function getVisits(): Promise<number> {
  const r = await fetch(`${BASE}/visits`);
  if (!r.ok) throw new Error("Failed to load visits");
  const j = await r.json();
  return j.count ?? 0;
}

export async function pingVisit(): Promise<number> {
  const r = await fetch(`${BASE}/visits`, { method: "POST" });
  if (!r.ok) throw new Error("Failed to ping visit");
  const j = await r.json();
  return j.count ?? 0;
}
