export interface MobileUser {
  id: number;
  username: string;
  isAdmin: boolean;
  avatarUrl?: string | null;
  rank?: string | null;
}

export interface MobileNewsPost {
  id: number;
  author: string;
  title: string;
  body: string;
  images?: string[];
  createdAt: string;
}

export interface MobilePublicUser {
  username: string;
  isAdmin: boolean;
  avatarUrl: string | null;
  rank?: string | null;
  lastSeen?: string | null;
  hasPage?: boolean;
  hasHostedSite?: boolean;
  upvotes?: number;
}

export interface MobileWikiPageSummary {
  slug: string;
  title: string;
  updatedBy: string;
  updatedAt: string;
  excerpt: string;
}

export interface MobileWikiAsset {
  id: number;
  fileName: string;
  contentType: string;
  size: number;
  url: string;
}

export interface MobileWikiPage {
  slug: string;
  title: string;
  content: string;
  createdBy: string;
  updatedBy: string;
  updatedAt: string;
}

export interface MobileHostedSite {
  exists: boolean;
  active: boolean;
  entryPath?: string;
}

function cleanOrigin(value: string | undefined): string {
  if (!value?.trim()) return "";
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(candidate).origin;
  } catch {
    return "";
  }
}

const configuredOrigin = cleanOrigin(
  process.env.EXPO_PUBLIC_API_BASE_URL || process.env.EXPO_PUBLIC_DOMAIN,
);
export const API_ORIGIN = configuredOrigin;
const API_BASE = configuredOrigin ? `${configuredOrigin}/api` : "";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE) {
    throw new Error("The app API address is not configured. Set EXPO_PUBLIC_API_BASE_URL for the native build.");
  }
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (response.status === 204) return undefined as T;
  let payload: any;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new ApiError(payload?.error || payload?.message || `Request failed (${response.status})`, response.status);
  }
  return payload as T;
}

export async function getMe(): Promise<MobileUser | null> {
  const response = await apiRequest<{ user: MobileUser | null }>("/auth/me");
  return response.user;
}

export async function login(username: string, password: string): Promise<void> {
  await apiRequest("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

export async function signup(username: string, password: string): Promise<void> {
  await apiRequest("/auth/signup", { method: "POST", body: JSON.stringify({ username, password }) });
}

export async function logout(): Promise<void> {
  await apiRequest("/auth/logout", { method: "POST" });
}

export async function fetchNews(): Promise<MobileNewsPost[]> {
  return apiRequest<MobileNewsPost[]>("/news");
}

export async function fetchUsers(): Promise<MobilePublicUser[]> {
  return apiRequest<MobilePublicUser[]>("/users");
}

export async function fetchWikiPages(): Promise<MobileWikiPageSummary[]> {
  return apiRequest<MobileWikiPageSummary[]>("/wiki/pages");
}

export async function fetchWikiPage(slug: string): Promise<{ page: MobileWikiPage; assets: MobileWikiAsset[] }> {
  return apiRequest(`/wiki/pages/${encodeURIComponent(slug)}`);
}

export async function fetchHostedSite(username: string): Promise<MobileHostedSite> {
  return apiRequest(`/custom-sites/${encodeURIComponent(username)}`);
}

export async function registerExpoPushToken(token: string, platform: "ios" | "android"): Promise<void> {
  await apiRequest("/push/expo/register", { method: "POST", body: JSON.stringify({ token, platform }) });
}

export async function unregisterExpoPushToken(token: string): Promise<void> {
  await apiRequest("/push/expo/unregister", { method: "POST", body: JSON.stringify({ token }) });
}

export function getHostedSiteUrl(username: string, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${API_ORIGIN}/api/custom-sites/${encodeURIComponent(username)}/${encodedPath}`;
}

