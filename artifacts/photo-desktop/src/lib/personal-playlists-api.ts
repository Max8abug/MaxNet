export interface PersonalYouTubeTrack {
  id: string;
  videoId: string;
  title: string;
}
export interface PersonalYouTubePlaylist {
  id: number;
  name: string;
  revision: number;
  tracks: PersonalYouTubeTrack[];
  createdAt: string;
  updatedAt: string;
}
async function request<T>(path = "", init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/personal-playlists${path}`, {
    ...init, credentials: "include", headers: { "Content-Type": "application/json" },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not update your playlists.");
  return data as T;
}
export const fetchPersonalPlaylists = () => request<PersonalYouTubePlaylist[]>();
export const createPersonalPlaylist = (name: string) =>
  request<PersonalYouTubePlaylist>("", { method: "POST", body: JSON.stringify({ name }) });
export const updatePersonalPlaylist = (id: number, input: { name?: string; trackIds?: string[]; revision: number }) =>
  request<PersonalYouTubePlaylist>(`/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const deletePersonalPlaylist = (id: number) =>
  request<{ ok: boolean }>(`/${id}`, { method: "DELETE" });
export const addPersonalPlaylistLinks = (id: number, links: string) =>
  request<{ playlist: PersonalYouTubePlaylist; added: number; duplicates: number; rejected: string[] }>(
    `/${id}/links`, { method: "POST", body: JSON.stringify({ links }) },
  );
