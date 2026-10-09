export interface WikiPageSummary {
  slug: string;
  title: string;
  updatedBy: string;
  updatedAt: string;
  excerpt: string;
}

export interface WikiAsset {
  id: number;
  fileName: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
  url: string;
}

export interface WikiPageRecord {
  slug: string;
  title: string;
  content: string;
  createdBy: string;
  updatedBy: string;
  updatedAt: string;
}

const updatedAt = "2026-10-09T10:30:00.000Z";
let nextAssetId = 10;
const pages: WikiPageRecord[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    content: `# Welcome to the community

This wiki is the community's shared place for guides, helpful links, and answers. Anyone can read it; members with wiki edit access can improve it.

## Find your way around

- **The desktop** — Open apps and windows from the Start menu.
- **Your profile** — Update your display name, preferences, and page.
- **Community chat** — Say hello and ask other members for help.

## Contributing

Use the page index to browse articles. Editors can create or update a page using Markdown, then attach images or video from the page editor. Please check whether a page already covers your topic before adding another.`,
    createdBy: "Community editors",
    updatedBy: "Jamie",
    updatedAt,
  },
  {
    slug: "desktop-themes",
    title: "Desktop themes",
    content: `# Choosing a desktop theme

Open **Settings** from the Start menu and choose a theme. Your selection is saved to your account and follows you between sessions.

## Available themes

The desktop includes classic light and dark themes, Windows XP, Vista light and dark, Gold picture frame, and Silver picture frame.

Themes change the appearance of the desktop and windows, not the content of your account.`,
    createdBy: "Community editors",
    updatedBy: "Morgan",
    updatedAt,
  },
  {
    slug: "personal-playlists",
    title: "Personal YouTube playlists",
    content: `# Listen while you browse

Personal playlists let you save YouTube links and listen through the visible player. Playback is local to your device and does not replace room music.

## Add a video

1. Open Personal Playlists.
2. Choose or create a playlist.
3. Paste a YouTube link and add it.

You can reorder your tracks without changing the playback of anyone else.`,
    createdBy: "Community editors",
    updatedBy: "Riley",
    updatedAt,
  },
  {
    slug: "community-guidelines",
    title: "Community guidelines",
    content: `# A few things that help

Be welcoming. Keep discussions useful. Give other people room to enjoy the site.

| Do | Avoid |
| --- | --- |
| Share helpful context | Post private information |
| Be patient with new members | Flood chat or pages |
| Ask before reusing someone's work | Edit pages to start arguments |

If something on a wiki page needs correcting, edit it respectfully or ask a wiki editor.`,
    createdBy: "Community editors",
    updatedBy: "Taylor",
    updatedAt,
  },
];

const assets = new Map<number, WikiAsset[]>();

export async function fetchWikiPages(): Promise<WikiPageSummary[]> {
  return pages.map(({ slug, title, updatedBy, updatedAt: date, content }) => ({
    slug,
    title,
    updatedBy,
    updatedAt: date,
    excerpt: content.split("\n").find(line => line && !line.startsWith("#")) ?? "",
  }));
}

export async function fetchWikiPage(slug: string): Promise<{ page: WikiPageRecord; assets: WikiAsset[] }> {
  const page = pages.find(item => item.slug === slug);
  if (!page) throw new Error("That wiki page could not be opened.");
  return { page: { ...page }, assets: [...(assets.get(slug) ?? [])] };
}

export async function createWikiPage(title: string, content: string) {
  const slug = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "new-page";
  if (pages.some(page => page.slug === slug)) throw new Error("A page with that title already exists.");
  const page = { slug, title, content, createdBy: "Community editor", updatedBy: "Community editor", updatedAt: new Date().toISOString() };
  pages.push(page);
  return { page: { ...page }, assets: [] as WikiAsset[] };
}

export async function updateWikiPage(slug: string, title: string, content: string) {
  const page = pages.find(item => item.slug === slug);
  if (!page) throw new Error("That wiki page could not be opened.");
  Object.assign(page, { title, content, updatedBy: "Community editor", updatedAt: new Date().toISOString() });
  return { page: { ...page }, assets: [...(assets.get(slug) ?? [])] };
}

export async function deleteWikiPage(slug: string): Promise<void> {
  const index = pages.findIndex(item => item.slug === slug);
  if (index >= 0) pages.splice(index, 1);
  assets.delete(slug);
}

export async function uploadWikiAsset(slug: string, fileName: string, dataUrl: string): Promise<WikiAsset> {
  const comma = dataUrl.indexOf(",");
  const metadata = dataUrl.slice(0, comma);
  const contentType = metadata.match(/^data:([^;]+)/)?.[1] ?? "image/png";
  const asset = { id: nextAssetId++, fileName, contentType, size: dataUrl.length, uploadedBy: "Community editor", createdAt: new Date().toISOString(), url: dataUrl };
  assets.set(slug, [...(assets.get(slug) ?? []), asset]);
  return asset;
}

export async function deleteWikiAsset(id: number): Promise<void> {
  for (const [slug, list] of assets) assets.set(slug, list.filter(asset => asset.id !== id));
}
