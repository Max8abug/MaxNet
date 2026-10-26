import path from "node:path";

export const GAME_PORT_DATA_ROOT = path.resolve(
  process.env["GAME_PORT_DATA_DIR"] ||
    path.join(process.cwd(), "selfhost", "data", "game-user-files"),
);

export const GAME_PORT_DATA_CATALOG = [
  { id: "chocolatedoom", assetId: "chocolate-doom", title: "Chocolate Doom", needs: "A Doom IWAD, such as doom1.wad, doom.wad, or doom2.wad.", uploadable: true },
  { id: "duke3d", assetId: "belgian-chocolate-duke3d", title: "Belgian Chocolate Duke3D", needs: "DUKE3D.GRP from a Duke Nukem 3D installation.", uploadable: true },
  { id: "spacecadetpinball", assetId: "space-cadet-pinball", title: "Space Cadet Pinball", needs: "pinball.exe with its PDB, or CADET.EXE from Full Tilt! Pinball.", uploadable: true },
  { id: "fallout1ce", assetId: "fallout1-ce", title: "Fallout 1 CE", needs: "master.dat, critter.dat, and the complete data/ folder.", uploadable: true },
  { id: "fallout2ce", assetId: "fallout2-ce", title: "Fallout 2 CE", needs: "master.dat, critter.dat, patch000.dat, and the complete data/ folder.", uploadable: true },
  { id: "lttp", assetId: "lttp", title: "A Link to the Past", needs: "No ROM upload; this is a recreation. Its source build needs Git LFS assets.", uploadable: false },
  { id: "islepizza", assetId: "isle-pizza", title: "LEGO Island", needs: "A LEGO Island installation folder or CD image; the engine build is separate.", uploadable: true },
  { id: "legolandport", assetId: "legoland-port", title: "LEGO Land Web Port", needs: "A LEGOLAND CD image (.iso or .bin). The game installs it in browser storage.", uploadable: true },
  { id: "webcompiled", assetId: "webcompiled", title: "Webcompiled", needs: "A Wii game disc image (.rvz, .iso, .wbfs, .wia, .gcz, .ciso, or .gcm).", uploadable: true },
  { id: "pokeemerald3d", assetId: "pokeemerald-3d", title: "Pokémon Emerald 3D", needs: "The project README does not identify a separate user-supplied ROM file.", uploadable: false },
  { id: "goldenballoon", assetId: "goldenballoon", title: "Golden Balloon", needs: "A legally acquired ROM supported by the game's ROM checker.", uploadable: true },
  { id: "openlara", assetId: "openlara", title: "OpenLara", needs: "The web demo includes a demo level; full play needs Tomb Raider data files.", uploadable: true },
  { id: "jsdos", assetId: "js-dos", title: "js-dos", needs: "A DOS game's files, usually packaged as a .jsdos bundle.", uploadable: true },
] as const;

const byId = new Map(GAME_PORT_DATA_CATALOG.map((item) => [item.id, item]));
export function gameDataPort(gameId: string) {
  return byId.get(gameId as (typeof GAME_PORT_DATA_CATALOG)[number]["id"]);
}

export const MAX_GAME_PORT_DATA_FILE_BYTES = 8_000_000_000;
export const MAX_GAME_PORT_DATA_TOTAL_BYTES = 12_000_000_000;

export function safeGameDataPath(value: string): string | null {
  if (!value || value.length > 512 || value.includes("\\") || value.startsWith("/")) return null;
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) return null;
  if (parts.some((part) => !/^[A-Za-z0-9 _().+-]{1,120}$/.test(part))) return null;
  const extension = path.extname(parts.at(-1) ?? "").toLowerCase();
  if ([".html", ".htm", ".js", ".mjs", ".cjs", ".svg", ".wasm", ".map"].includes(extension)) return null;
  return parts.join("/");
}
