#!/usr/bin/env python3
"""Install the selected static game ports into the self-hosted asset directory."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath


REPO_ROOT = Path(__file__).resolve().parent.parent
ASSET_ROOT = REPO_ROOT / "selfhost" / "data" / "ported-games"
MANIFEST_PATH = ASSET_ROOT / "asset-manifest.json"
USER_AGENT = "Portfolio98-selfhost-game-assets/1.0"
MAX_TOTAL_BYTES = 15_000_000_000
MAX_WORKERS = 6
RUFFLE_VERSION = "0.7.1"
RUFFLE_ARCHIVE_URL = (
    "https://github.com/ruffle-rs/ruffle/releases/download/v0.7.1/"
    "ruffle-0.7.1-web-selfhosted.zip"
)
RUFFLE_ARCHIVE_SHA256 = "ef12edbee135d581a9cd523837d746da30a07a64dbf1cf472d2e472c656f4b5e"
RUFFLE_FILES = {
    "LICENSE_MIT": 1_097,
    "LICENSE_APACHE": 9_723,
    "ruffle.js": 465_885,
    "core.ruffle.16d61072ac7fdc4d5013.js": 108_322,
    "core.ruffle.994eeef0a471a88cd0e3.js": 114_743,
    "172de42e6619eac8f371.wasm": 14_302_754,
    "878d548199cddef07035.wasm": 14_227_884,
}
RUFFLE_BYTES = sum(RUFFLE_FILES.values())

# Only the requested game subfolders are fetched. Commits are pinned so a normal
# site update cannot silently change the game files or expand the download.
GAMES = (
    {
        "id": "getting-over-it",
        "repo": "genizy/web-port",
        "commit": "a8bea5fd11f88e5a9192857f434e299c40efe7e6",
        "path": "getting-over-it",
        "remote_base_href": "https://cdn.jsdelivr.net/gh/genizy/web-port@main/getting-over-it/",
        "expected_files": 49,
        "expected_bytes": 692_185_540,
    },
    {
        "id": "web-fishing",
        "repo": "genizy/web-port",
        "commit": "a8bea5fd11f88e5a9192857f434e299c40efe7e6",
        "path": "web-fishing",
        "remote_base_href": "https://cdn.jsdelivr.net/gh/genizy/web-port@main/web-fishing/",
        "expected_files": 11,
        "expected_bytes": 64_277_360,
    },
    {
        "id": "pvz",
        "repo": "web-ports/pvz",
        "commit": "e3b5ddce5a318df69698d906a6d78313e327f965",
        "path": "",
        "remote_base_href": "https://cdn.jsdelivr.net/gh/web-ports/pvz@latest/",
        "expected_files": 11,
        "expected_bytes": 51_397_666,
    },
    {
        "id": "undertale",
        "repo": "bandit968thegamer-ops/undertale",
        "commit": "5a0e1d886142b69eeb21ec6642469757c5fcb307",
        "path": "undertale",
        "remote_base_href": "https://cdn.jsdelivr.net/gh/genizy/web-port@master/undertale/",
        "expected_files": 230,
        "expected_bytes": 202_508_178,
    },
    {
        "id": "among-us",
        "repo": "wasmdotrip/AmongUsPort",
        "commit": "7b6881186a73a3165ad7274b5e5dd31e3290cbfc",
        "path": "",
        "remote_base_href": "",
        "expected_files": 70,
        "expected_bytes": 864_877_715,
    },
    {
        "id": "ac-gamecube",
        "repo": "web-ports/ac-gamecube",
        "commit": "02e63512555558da9a4a1db5fc8c7ea7a0baffdc",
        "path": "",
        "remote_base_href": "",
        "expected_files": 22,
        "expected_bytes": 37_280_261,
    },
    {
        "id": "class-of-09",
        "repo": "genizy/web-port",
        "commit": "a8bea5fd11f88e5a9192857f434e299c40efe7e6",
        "path": "class-of-09",
        "remote_base_href": "https://cdn.jsdelivr.net/gh/genizy/web-port@main/class-of-09/",
        "expected_files": 111,
        "expected_bytes": 245_830_265,
    },
    {
        "id": "cuphead",
        "repo": "web-ports/cuphead",
        "commit": "08a62227c742d74092f739b168ee4be1993f8ba5",
        "path": "",
        "remote_base_href": "https://cdn.jsdelivr.net/gh/web-ports/cuphead@c9ff1b6b16f9d402b78a42fc2200e1c076c0ab6e/",
        "expected_files": 125,
        "expected_bytes": 2_208_353_037,
    },
    {
        "id": "deltatraveler",
        "repo": "genizy/web-port",
        "commit": "a8bea5fd11f88e5a9192857f434e299c40efe7e6",
        "path": "deltatraveler",
        "remote_base_href": "https://cdn.jsdelivr.net/gh/genizy/web-port@main/deltatraveler/",
        "expected_files": 17,
        "expected_bytes": 256_912_659,
    },
    {
        "id": "deltarune",
        "repo": "Mollomm1/test",
        "commit": "ac1db67df09e8ae48572c5de84b4b6ac5ebd1e67",
        "path": "",
        "remote_base_href": "",
        "expected_files": 510,
        "expected_bytes": 933_226_913,
    },
    {
        "id": "gang-beasts",
        "repo": "jmhq20120212-cmd/GangBeast-WebPort",
        "commit": "4943afeebe714d8c0a2a1aa0614d0e6779eec02b",
        "path": "",
        "remote_base_href": "",
        "expected_files": 43,
        "expected_bytes": 489_357_360,
    },
    {
        "id": "hill-climb-racing",
        "repo": "NotRexed/HillClimbRacingPort",
        "commit": "43c3f7537369a4f89d8c81f53f7bfc472d738459",
        "path": "",
        "remote_base_href": "",
        "expected_files": 15,
        "expected_bytes": 186_445_517,
    },
    {
        "id": "untitled-goose-game",
        "repo": "web-ports/untitled-goose-game",
        "commit": "fbdd0473a0f35fabaea9790e7d60330be1788e26",
        "path": "",
        "remote_base_href": "https://cdn.jsdelivr.net/gh/web-ports/untitled-goose-game@main/",
        "expected_files": 20,
        "expected_bytes": 100_800_959,
    },
    {
        "id": "oneshot",
        "repo": "Kitaylena/oneshotthing",
        "commit": "168f34c60799ab6559e1e6c4ddc2d79ff3a71d3f",
        "path": "",
        "remote_base_href": "",
        "expected_files": 378,
        "expected_bytes": 83_446_381,
    },
    {
        "id": "minesweeperplus",
        "repo": "genizy/web-port",
        "commit": "a8bea5fd11f88e5a9192857f434e299c40efe7e6",
        "path": "minesweeperplus",
        "remote_base_href": "",
        "entry": "MinesweeperPlus.html",
        "expected_files": 17,
        "expected_bytes": 91_807_534,
    },
    {
        "id": "night-in-the-woods",
        "repo": "reeyuki/NightInTheWoods",
        "commit": "0a31ed6d0a54eaf93d1cec111dc743cabfed4d0b",
        "path": "",
        "remote_base_href": "",
        "expected_files": 33,
        "expected_bytes": 438_750_872,
    },
    {
        "id": "tattletail",
        "repo": "genizy/web-port",
        "commit": "a8bea5fd11f88e5a9192857f434e299c40efe7e6",
        "path": "tattletail",
        "remote_base_href": "https://cdn.jsdelivr.net/gh/genizy/web-port@main/tattletail/",
        "expected_files": 9,
        "expected_bytes": 70_170_858,
    },
    {
        "id": "tabs",
        "repo": "web-ports/tabs",
        "commit": "f03af105ef2a57a6a7c6ccf1831c95da3327c6f0",
        "path": "",
        "remote_base_href": "https://cdn.jsdelivr.net/gh/web-ports/tabs@main/",
        "expected_files": 153,
        "expected_bytes": 1_840_088_490,
    },
    {
        "id": "daddygame",
        "repo": "Reeyuki/daddygame",
        "commit": "b3ee2fe65d5f9565e992ca28d7484b1ee1d8ca23",
        "path": "",
        "remote_base_href": "",
        "expected_files": 15,
        "expected_bytes": 126_653_214,
    },
    {
        "id": "web-balatro",
        "repo": "W0W53R/web-balatro",
        "commit": "53ddedfdd2e44d29b922210a92b85b2bfd57d9c2",
        "path": "",
        "remote_base_href": "",
        "expected_files": 21,
        "expected_bytes": 18_727_836,
    },
    {
        "id": "quake3",
        "repo": "lrusso/Quake3",
        "commit": "a1da35382627b548ce59ca1e09a27d6da0285574",
        "path": "",
        "remote_base_href": "",
        "expected_files": 11,
        "expected_bytes": 50_937_513,
        "entry": "Quake3.htm?demo",
    },
    {
        "id": "hit-and-run-web",
        "repo": "Vheissu/hit-and-run-web",
        "commit": "94800b3436df05dee92e52e70c2bdaa8d9ee8420",
        "path": "",
        "remote_base_href": "",
        "expected_files": 12_568,
        "expected_bytes": 1_228_679_250,
        "entry": "index.html",
        "build_vite_site": True,
    },
    {
        "id": "dumb-ways-to-die",
        "repo": "web-ports/dumb-ways-to-die",
        "commit": "0a96f33195c8a19a023342162da8302ef9735b18",
        "path": "",
        "remote_base_href": "https://cdn.jsdelivr.net/gh/web-ports/dumb-ways-to-die@main/",
        "expected_files": 3,
        "expected_bytes": 25_836_728,
        "entry": "index.html",
        "ruffle": True,
    },
    {
        "id": "bendy",
        "repo": "genizy/web-port",
        "commit": "a8bea5fd11f88e5a9192857f434e299c40efe7e6",
        "path": "bendy",
        "remote_base_href": "https://cdn.jsdelivr.net/gh/genizy/web-port@main/bendy/",
        "expected_files": 14,
        "expected_bytes": 136_025_330,
        "entry": "index.html",
    },
    {
        "id": "duck-8",
        "repo": "web-ports/duck-8",
        "commit": "e383317e834db183a3893b0303b4d7d9be2a473b",
        "path": "",
        "remote_base_href": "",
        "expected_files": 21,
        "expected_bytes": 187_434_672,
        "entry": "index.html",
    },
    {
        "id": "inside",
        "repo": "web-ports/milk-bag-games",
        "commit": "b807a5dbb662c604418d9484820522f597c3d810",
        "path": "inside",
        "remote_base_href": "",
        "expected_files": 35,
        "expected_bytes": 176_756_632,
        "entry": "index.html",
    },
    {
        "id": "outside",
        "repo": "web-ports/milk-bag-games",
        "commit": "b807a5dbb662c604418d9484820522f597c3d810",
        "path": "outside",
        "remote_base_href": "",
        "expected_files": 59,
        "expected_bytes": 696_890_477,
        "entry": "index.html",
    },
    {
        "id": "tfs",
        "repo": "AlexBoops/TFS",
        "commit": "9b6be0e00f0c5a65228d8aed9fee4e0cb5a7ab88",
        "path": "",
        "remote_base_href": "",
        "expected_files": 1_021,
        "expected_bytes": 1_136_856_008,
        "entry": "index.html",
    },
    {
        "id": "tru",
        "repo": "AlexBoops/tru",
        "commit": "bba8426e8e3d02e6a85b5091f7fdbad3baf9490e",
        "path": "",
        "remote_base_href": "",
        "expected_files": 1_056,
        "expected_bytes": 1_217_512_058,
        "entry": "index.html",
    },
    {
        "id": "geometry-dash-webport",
        "repo": "AlexBoops/geometry-dash-webport",
        "commit": "c6ac9417ff93ea957425b23ee87f1ed290663ebb",
        "path": "",
        "remote_base_href": "",
        "expected_files": 29,
        "expected_bytes": 387_802_365,
        "entry": "index.html",
    },
    {
        "id": "doom-wasm",
        "repo": "jacobenget/doom.wasm",
        "commit": "25ea598859a7dba4e2f86ea0354d583e1b3f5ecd",
        "path": "examples/browser",
        "remote_base_href": "",
        "expected_files": 5,
        "expected_bytes": 4_573_731,
        "entry": "doom.html",
    },
    {
        "id": "openjkdf2",
        "repo": "maxthomas.dev/openjkdf2 (demo linked by OpenJKDF2 README)",
        "commit": "sha256:fa69fcb0d00d5b1b5f07fea5f6622f6840930511ec8ffcff985ec40a90bdb190",
        "path": "",
        "remote_base_href": "",
        "expected_files": 5,
        "expected_bytes": 67_286_014,
        "entry": "index.html",
        "external_files": [
            {
                "path": "index.html",
                "url": "https://maxthomas.dev/openjkdf2/index.html",
                "bytes": 8_245,
                "oid": "189dcef0ecb40ec6708feadeb610d54a5c1d9b27",
            },
            {
                "path": "openjkdf2.js",
                "url": "https://maxthomas.dev/openjkdf2/openjkdf2.js",
                "bytes": 434_709,
                "oid": "4adef84afc027a1653b3e1a07f99f30907bf6498",
            },
            {
                "path": "openjkdf2.wasm",
                "url": "https://maxthomas.dev/openjkdf2/openjkdf2.wasm",
                "bytes": 2_955_996,
                "oid": "323f192fe7692c2434c6d1959d995beb8fbe62cc",
            },
            {
                "path": "openjkdf2_data.js",
                "url": "https://maxthomas.dev/openjkdf2/openjkdf2_data.js",
                "bytes": 7_751,
                "oid": "fc6f363452074a3cd52233c097264d0336edea38",
            },
            {
                "path": "openjkdf2_data.data",
                "url": "https://maxthomas.dev/openjkdf2/openjkdf2_data.data",
                "bytes": 63_879_313,
                "oid": "c2b3dbe216e3db7d5be6a345b40be024e2b2ea0c",
            },
        ],
    },
    {
        "id": "stardew-wasm",
        "repo": "degloved-net/stardew-wasm",
        "commit": "a664842611f09771f9155b9718046649bcaded33",
        "path": "",
        "remote_base_href": "",
        "expected_files": 96,
        "expected_bytes": 640_053_043,
        "entry": "index.html",
    },
)

STARDEW_OPFS_SETUP_ORIGINAL = (
    b"const opfs = await navigator.storage.getDirectory();"
)
STARDEW_OPFS_SETUP_SANDBOX_SAFE = b"""const opfs = await (async () => {
try { return await navigator.storage?.getDirectory?.(); } catch { return null; }
})();"""
STARDEW_OPFS_PERSIST_ORIGINAL = b"navigator.storage.persist?.().catch(() => false)"
STARDEW_OPFS_PERSIST_SANDBOX_SAFE = b"navigator.storage?.persist?.().catch(() => false)"
STARDEW_OPFS_READ_ORIGINAL = b"""async function opfsRead(name) {
\treturn new Uint8Array(await (await (await opfs.getFileHandle(name)).getFile()).arrayBuffer());
}"""
STARDEW_OPFS_READ_SANDBOX_SAFE = b"""async function opfsRead(name) {
\tif (!opfs) throw new DOMException("Persistent storage unavailable", "NotFoundError");
\treturn new Uint8Array(await (await (await opfs.getFileHandle(name)).getFile()).arrayBuffer());
}"""

PVZ_CACHE_FUNCTION_ORIGINAL = b"""    async function mergeFiles(fileParts, cacheKey) {
      const cache = await caches.open("pvz-cache");
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        const blob = await cachedResponse.blob();
        return URL.createObjectURL(blob);
      }
      const buffers = await Promise.all(
        fileParts.map(part => fetchWithProgress(part))
      );
      const mergedBlob = new Blob(buffers);
      const response = new Response(mergedBlob);
      await cache.put(cacheKey, response);
      return URL.createObjectURL(mergedBlob);
    }
"""

PVZ_CACHE_FUNCTION_SANDBOX_SAFE = b"""    async function mergeFiles(fileParts, cacheKey) {
      let cache;
      try {
        cache = await caches.open("pvz-cache");
        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
          const blob = await cachedResponse.blob();
          return URL.createObjectURL(blob);
        }
      } catch (error) {
        console.warn("PVZ cache unavailable; loading without persistent cache.", error);
        cache = undefined;
      }
      const buffers = await Promise.all(
        fileParts.map(part => fetchWithProgress(part))
      );
      const mergedBlob = new Blob(buffers);
      if (cache) {
        try {
          await cache.put(cacheKey, new Response(mergedBlob));
        } catch (error) {
          console.warn("PVZ cache write failed; continuing without cache.", error);
        }
      }
      return URL.createObjectURL(mergedBlob);
    }
"""

AC_SYNC_BLOCK_ORIGINAL = b"""setRomStatus("Saving to browser storage\xe2\x80\xa6"), FS.syncfs(!1, (function(t) {
\t\t\t\t\t\tif (t) {
\t\t\t\t\t\t\tvar n = String(t && t.message || t);
\t\t\t\t\t\t\treturn setRomStatus(n = /quota/i.test(n) ? "Browser storage is full. Clear site data for this page (Settings \xe2\x86\x92 Privacy \xe2\x86\x92 Clear site data) and try again. The compressed ROM is " + formatBytes(s.byteLength) + "." : "Persist failed: " + n, !0), setStartEnabled(!1), void console.error("[rom] FS.syncfs failed", t)
\t\t\t\t\t\t}
\t\t\t\t\t\tsetRomStatus("ROM ready: " + (e.name || "user-rom.iso") + " (" + formatBytes(s.byteLength) + ")", "ok"), setStartEnabled(!0)
\t\t\t\t\t}))"""

AC_SYNC_BLOCK_SANDBOX_SAFE = b"""setRomStatus("Saving to browser storage\xe2\x80\xa6");
\t\t\t\t\tawait new Promise(function(resolve) {
\t\t\t\t\t\tvar settled = false;
\t\t\t\t\t\tvar timer = setTimeout(finish, 2000);
\t\t\t\t\t\tfunction finish() {
\t\t\t\t\t\t\tif (settled) return;
\t\t\t\t\t\tsettled = true;
\t\t\t\t\t\tclearTimeout(timer);
\t\t\t\t\t\tresolve();
\t\t\t\t\t\t}
\t\t\t\t\t\ttry {
\t\t\t\t\t\t\tFS.syncfs(!1, function(error) {
\t\t\t\t\t\t\t\tif (error) console.warn("[rom] Browser storage unavailable; starting without persistence.", error);
\t\t\t\t\t\t\t\tfinish();
\t\t\t\t\t\t\t});
\t\t\t\t\t\t} catch (error) {
\t\t\t\t\t\t\tconsole.warn("[rom] Browser storage unavailable; starting without persistence.", error);
\t\t\t\t\t\t\tfinish();
\t\t\t\t\t\t}
\t\t\t\t\t});
\t\t\t\t\tsetRomStatus("ROM ready: " + (e.name || "user-rom.iso") + " (" + formatBytes(s.byteLength) + ")", "ok"), setStartEnabled(!0)"""

CUPHEAD_MERGE_FUNCTION_ORIGINAL = b"""async function mergeFiles(fileParts, cacheKey) {
      const cache = await caches.open("cuphead-cache");
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        const blob = await cachedResponse.blob();
        return URL.createObjectURL(blob);
      }
      const buffers = await Promise.all(
        fileParts.map(part => fetchWithProgress(part))
      );
      const mergedBlob = new Blob(buffers);
      const response = new Response(mergedBlob);
      await cache.put(cacheKey, response);
      return URL.createObjectURL(mergedBlob);
    }"""

CUPHEAD_MERGE_FUNCTION_SANDBOX_SAFE = b"""async function mergeFiles(fileParts, cacheKey) {
      let cache;
      try {
        cache = await caches.open("cuphead-cache");
        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
          const blob = await cachedResponse.blob();
          return URL.createObjectURL(blob);
        }
      } catch (error) {
        console.warn("Cuphead cache unavailable; loading without persistent cache.", error);
        cache = undefined;
      }
      const buffers = await Promise.all(
        fileParts.map(part => fetchWithProgress(part))
      );
      const mergedBlob = new Blob(buffers);
      if (cache) {
        try {
          await cache.put(cacheKey, new Response(mergedBlob));
        } catch (error) {
          console.warn("Cuphead cache write failed; continuing without cache.", error);
        }
      }
      return URL.createObjectURL(mergedBlob);
    }"""

CLASS09_SERVICE_WORKER_ORIGINAL = b"""navigator.serviceWorker && (navigator.serviceWorker.controller || navigator.serviceWorker.register("./service-worker.js", {
                updateViaCache: "all"
            }))"""
CLASS09_SERVICE_WORKER_SANDBOX_SAFE = b"""/* Offline service workers are unavailable in this sandbox; game files load directly. */"""
CLASS09_RENPY_PRE_URL_ORIGINAL = b'https://cdn.jsdelivr.net/gh/genizy/web-port@725a19f20c3f376529284c9f86299581719e8d19/class-of-09/renpy-pre.js'
CLASS09_RENPY_PRE_URL_SANDBOX_SAFE = b'./renpy-pre.js'
CLASS09_RENPY_URL_ORIGINAL = b'https://cdn.jsdelivr.net/gh/genizy/web-port@725a19f20c3f376529284c9f86299581719e8d19/class-of-09/renpy.js'
CLASS09_RENPY_URL_SANDBOX_SAFE = b'./renpy.js'

RENPY_SERVICE_WORKER_ORIGINAL = b"""// Register the service worker.
      if (navigator.serviceWorker) {
          if (!navigator.serviceWorker.controller) {
              navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'all' });
          }
      }"""
RENPY_SERVICE_WORKER_SANDBOX_SAFE = b"// Service worker disabled in the sandboxed game frame."
MILKBAG_SERVICE_WORKER_ORIGINAL = b"""// Register the service worker.
        if (navigator.serviceWorker) {
            if (!navigator.serviceWorker.controller) {
                navigator.serviceWorker.register('./service-worker.js', {
                    updateViaCache: 'all'
                });
            }
        }"""
MILKBAG_SERVICE_WORKER_SANDBOX_SAFE = b"// Service worker disabled in the sandboxed game frame."
MILKBAG_WASM_URL_ORIGINAL = {
    "inside": b"https://raw.githubusercontent.com/web-ports/milk-bag-games/refs/heads/main/inside/renpy.wasm",
    "outside": b"https://raw.githubusercontent.com/web-ports/milk-bag-games/refs/heads/main/outside/renpy.wasm",
}
MILKBAG_WASM_URL_SANDBOX_SAFE = b"./renpy.wasm"
GEOMETRY_DASH_CDN_PREFIX_ORIGINAL = b"https://cdn.jsdelivr.net/gh/AlexBoops/geo@main/"
GEOMETRY_DASH_CDN_PREFIX_SANDBOX_SAFE = b"./"
GEOMETRY_DASH_CDN_PREFIX_COUNT = 6
GEOMETRY_DASH_SERVICE_WORKER_ORIGINAL = b"""if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.origin.includes('googleusercontent')) {
    window.addEventListener('load', function() {
      try {
        navigator.serviceWorker.register('/sw.js')
          .then(function(reg) { console.log('Service Worker registered! Scope:', reg.scope); })
          .catch(function(err) { console.warn('Service Worker skipped:', err); });
      } catch (e) {}
    });
  }"""
GEOMETRY_DASH_SERVICE_WORKER_SANDBOX_SAFE = b"// Service worker disabled in the sandboxed game frame."

HILL_CLIMB_JSPI_CHECK_ORIGINAL = b"""const supported = 'Suspending' in WebAssembly;
  if (!supported) status('This browser lacks WebAssembly JavaScript Promise Integration: use Chrome or Edge 137 or newer.');"""
HILL_CLIMB_JSPI_CHECK_SANDBOX_SAFE = b"""const supported = 'Suspending' in WebAssembly;
  if (!supported) {
    status('Hill Climb Racing requires a browser with WebAssembly JSPI support (the port specifies Chrome or Edge 137+).');
    const statusEl = $('status');
    statusEl.style.color = '#ffd166';
    statusEl.style.fontWeight = '700';
    statusEl.style.padding = '12px';
    statusEl.style.background = '#4a1c22';
    statusEl.style.borderRadius = '8px';
    document.querySelectorAll('.timing-row').forEach(row => {
      if (row.lastElementChild) row.lastElementChild.textContent = 'Not supported';
    });
  }"""
HILL_CLIMB_STORAGE_SHIM_ORIGINAL = b"  // settings saved before the port's rename (saVsync, saProgs) carry over once"
HILL_CLIMB_STORAGE_SHIM_SANDBOX_SAFE = b"""      const safeLocalStorage = (() => {
        try {
          const storage = window.localStorage;
          return {
            getItem: key => { try { return storage.getItem(key); } catch (_) { return null; } },
            setItem: (key, value) => { try { storage.setItem(key, value); } catch (_) {} },
            removeItem: key => { try { storage.removeItem(key); } catch (_) {} }
          };
        } catch (_) {
          return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        }
      })();
  // settings saved before the port's rename (saVsync, saProgs) carry over once"""
HILL_CLIMB_STORAGE_REF_COUNT = 11

NIGHT_IN_THE_WOODS_CDN_ORIGINAL = b'const CDN = "https://cdn.jsdelivr.net/gh/Reeyuki/NightInTheWoods";'
NIGHT_IN_THE_WOODS_CDN_SANDBOX_SAFE = b'const CDN = ".";'

TATTLETAIL_DATA_URL_SETUP_ORIGINAL = b"var json = {"
TATTLETAIL_DATA_URL_SETUP_SANDBOX_SAFE = b"window.dataUrll = dataUrl;\n        var json = {"
TATTLETAIL_DATA_URL_ORIGINAL = b"dataUrl: dataUrl,"
TATTLETAIL_DATA_URL_SANDBOX_SAFE = b'dataUrl: "WebGL.data.unityweb",'

TABS_MERGE_FUNCTION_ORIGINAL = b"""async function mergeFiles(fileParts, cacheKey) {
      const cache = await caches.open("tabs-cache");
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        const blob = await cachedResponse.blob();
        return URL.createObjectURL(blob);
      }
      const buffers = await Promise.all(
        fileParts.map(part => fetchWithProgress(part))
      );
      const mergedBlob = new Blob(buffers);
      const response = new Response(mergedBlob);
      await cache.put(cacheKey, response);
      return URL.createObjectURL(mergedBlob);
    }"""

TABS_MERGE_FUNCTION_SANDBOX_SAFE = b"""async function mergeFiles(fileParts, cacheKey) {
      let cache;
      try {
        cache = await caches.open("tabs-cache");
        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
          const blob = await cachedResponse.blob();
          return URL.createObjectURL(blob);
        }
      } catch (error) {
        console.warn("TABS cache unavailable; loading without persistent cache.", error);
        cache = undefined;
      }
      const buffers = await Promise.all(
        fileParts.map(part => fetchWithProgress(part))
      );
      const mergedBlob = new Blob(buffers);
      if (cache) {
        try {
          await cache.put(cacheKey, new Response(mergedBlob));
        } catch (error) {
          console.warn("TABS cache write failed; continuing without cache.", error);
        }
      }
      return URL.createObjectURL(mergedBlob);
    }"""


def run_git(repo_dir: Path, *arguments: str) -> str:
    environment = os.environ.copy()
    environment["GIT_TERMINAL_PROMPT"] = "0"
    result = subprocess.run(
        ["git", *arguments],
        cwd=repo_dir,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"git {' '.join(arguments)} failed: {detail}")
    return result.stdout


def source_tree(game: dict) -> list[dict]:
    if game.get("external_files"):
        files = [dict(item) for item in game["external_files"]]
        paths = set()
        for item in files:
            relative_path = PurePosixPath(item["path"])
            if (
                relative_path.is_absolute()
                or ".." in relative_path.parts
                or item["path"] in paths
                or not re.fullmatch(r"[0-9a-f]{40}", item["oid"])
                or not item["url"].startswith("https://")
                or item["bytes"] <= 0
            ):
                raise RuntimeError(f"Invalid pinned external file in {game['id']}")
            paths.add(item["path"])
        if (
            len(files) != game["expected_files"]
            or sum(item["bytes"] for item in files) != game["expected_bytes"]
        ):
            raise RuntimeError(f"External file manifest mismatch for {game['id']}")
        return files

    with tempfile.TemporaryDirectory(prefix="portfolio98-game-tree-") as temporary:
        repo_dir = Path(temporary)
        run_git(repo_dir, "init", "--quiet")
        run_git(
            repo_dir,
            "remote",
            "add",
            "origin",
            f"https://github.com/{game['repo']}.git",
        )
        run_git(
            repo_dir,
            "-c",
            "protocol.version=2",
            "fetch",
            "--quiet",
            "--depth=1",
            "--filter=blob:none",
            "origin",
            game["commit"],
        )
        fetched_commit = run_git(repo_dir, "rev-parse", "FETCH_HEAD").strip()
        if fetched_commit != game["commit"]:
            raise RuntimeError(
                f"Unexpected source revision for {game['id']}: {fetched_commit}"
            )

        arguments = ["ls-tree", "-r", "FETCH_HEAD"]
        if game["path"]:
            arguments.extend(["--", game["path"]])
        output = run_git(repo_dir, *arguments)

    files = []
    prefix = f"{game['path']}/" if game["path"] else ""
    for line in output.splitlines():
        metadata, source_path = line.split("\t", 1)
        mode, object_type, object_id = metadata.split()
        if object_type != "blob":
            raise RuntimeError(f"Unsupported source object in {game['id']}: {source_path}")
        if mode == "120000":
            raise RuntimeError(f"Refusing source symlink in {game['id']}: {source_path}")
        if prefix:
            if not source_path.startswith(prefix):
                raise RuntimeError(f"Unexpected source path in {game['id']}: {source_path}")
            source_path = source_path[len(prefix):]
        relative_path = PurePosixPath(source_path)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise RuntimeError(f"Unsafe source path in {game['id']}: {source_path}")
        files.append({"path": relative_path.as_posix(), "oid": object_id})

    if len(files) != game["expected_files"]:
        raise RuntimeError(
            f"Unexpected file count for {game['id']}: "
            f"expected {game['expected_files']}, found {len(files)}"
        )
    if not files:
        raise RuntimeError(f"No files were found for {game['id']}")
    return files


def expected_local_bytes(game: dict) -> int:
    cache_patch_delta = (
        len(PVZ_CACHE_FUNCTION_SANDBOX_SAFE)
        - len(PVZ_CACHE_FUNCTION_ORIGINAL)
        if game["id"] == "pvz"
        else 0
    )
    ac_storage_patch_delta = (
        len(AC_SYNC_BLOCK_SANDBOX_SAFE) - len(AC_SYNC_BLOCK_ORIGINAL)
        if game["id"] == "ac-gamecube"
        else 0
    )
    cuphead_cache_patch_delta = (
        len(CUPHEAD_MERGE_FUNCTION_SANDBOX_SAFE)
        - len(CUPHEAD_MERGE_FUNCTION_ORIGINAL)
        if game["id"] == "cuphead"
        else 0
    )
    class09_worker_patch_delta = (
        len(CLASS09_SERVICE_WORKER_SANDBOX_SAFE)
        - len(CLASS09_SERVICE_WORKER_ORIGINAL)
        if game["id"] == "class-of-09"
        else 0
    )
    class09_runtime_patch_delta = (
        len(CLASS09_RENPY_PRE_URL_SANDBOX_SAFE)
        - len(CLASS09_RENPY_PRE_URL_ORIGINAL)
        + len(CLASS09_RENPY_URL_SANDBOX_SAFE)
        - len(CLASS09_RENPY_URL_ORIGINAL)
        if game["id"] == "class-of-09"
        else 0
    )
    hill_climb_jspi_patch_delta = (
        len(HILL_CLIMB_JSPI_CHECK_SANDBOX_SAFE)
        - len(HILL_CLIMB_JSPI_CHECK_ORIGINAL)
        if game["id"] == "hill-climb-racing"
        else 0
    )
    hill_climb_storage_patch_delta = (
        len(HILL_CLIMB_STORAGE_SHIM_SANDBOX_SAFE)
        - len(HILL_CLIMB_STORAGE_SHIM_ORIGINAL)
        + HILL_CLIMB_STORAGE_REF_COUNT
        * (len(b"safeLocalStorage") - len(b"localStorage"))
        if game["id"] == "hill-climb-racing"
        else 0
    )
    tabs_cache_patch_delta = (
        len(TABS_MERGE_FUNCTION_SANDBOX_SAFE) - len(TABS_MERGE_FUNCTION_ORIGINAL)
        if game["id"] == "tabs"
        else 0
    )
    nitw_cdn_patch_delta = (
        len(NIGHT_IN_THE_WOODS_CDN_SANDBOX_SAFE)
        - len(NIGHT_IN_THE_WOODS_CDN_ORIGINAL)
        if game["id"] == "night-in-the-woods"
        else 0
    )
    tattletail_data_url_patch_delta = (
        len(TATTLETAIL_DATA_URL_SETUP_SANDBOX_SAFE)
        - len(TATTLETAIL_DATA_URL_SETUP_ORIGINAL)
        + len(TATTLETAIL_DATA_URL_SANDBOX_SAFE)
        - len(TATTLETAIL_DATA_URL_ORIGINAL)
        if game["id"] == "tattletail"
        else 0
    )
    renpy_service_worker_patch_delta = (
        len(RENPY_SERVICE_WORKER_SANDBOX_SAFE)
        - len(RENPY_SERVICE_WORKER_ORIGINAL)
        if game["id"] in {"tfs", "tru"}
        else 0
    )
    milkbag_service_worker_patch_delta = (
        len(MILKBAG_SERVICE_WORKER_SANDBOX_SAFE)
        - len(MILKBAG_SERVICE_WORKER_ORIGINAL)
        if game["id"] in {"inside", "outside"}
        else 0
    )
    milkbag_wasm_url_patch_delta = (
        len(MILKBAG_WASM_URL_SANDBOX_SAFE)
        - len(MILKBAG_WASM_URL_ORIGINAL[game["id"]])
        if game["id"] in MILKBAG_WASM_URL_ORIGINAL
        else 0
    )
    geometry_dash_cdn_patch_delta = (
        GEOMETRY_DASH_CDN_PREFIX_COUNT
        * (
            len(GEOMETRY_DASH_CDN_PREFIX_SANDBOX_SAFE)
            - len(GEOMETRY_DASH_CDN_PREFIX_ORIGINAL)
        )
        if game["id"] == "geometry-dash-webport"
        else 0
    )
    geometry_dash_service_worker_patch_delta = (
        len(GEOMETRY_DASH_SERVICE_WORKER_SANDBOX_SAFE)
        - len(GEOMETRY_DASH_SERVICE_WORKER_ORIGINAL)
        if game["id"] == "geometry-dash-webport"
        else 0
    )
    stardew_opfs_patch_delta = (
        len(STARDEW_OPFS_SETUP_SANDBOX_SAFE)
        - len(STARDEW_OPFS_SETUP_ORIGINAL)
        + len(STARDEW_OPFS_PERSIST_SANDBOX_SAFE)
        - len(STARDEW_OPFS_PERSIST_ORIGINAL)
        + len(STARDEW_OPFS_READ_SANDBOX_SAFE)
        - len(STARDEW_OPFS_READ_ORIGINAL)
        if game["id"] == "stardew-wasm"
        else 0
    )
    if game["remote_base_href"]:
        base_href_delta = (
            -len(game["remote_base_href"].encode("utf-8"))
            + len("./".encode("utf-8"))
        )
    else:
        base_href_delta = 0
    return (
        game["expected_bytes"]
        + base_href_delta
        + (
            -len(b"https://cdn.jsdelivr.net/gh/u-cvlassrom-y/google@main/ruffle.js")
            + len(b"./ruffle/ruffle.js")
            + 2 * (
                -len(b"https://cdn.jsdelivr.net/gh/web-ports/dumb-ways-to-die@main/data/main.swf")
                + len(b"./data/main.swf")
            )
            + RUFFLE_BYTES
            if game.get("ruffle")
            else 0
        )
        + cache_patch_delta
        + ac_storage_patch_delta
        + cuphead_cache_patch_delta
        + class09_worker_patch_delta
        + class09_runtime_patch_delta
        + hill_climb_jspi_patch_delta
        + hill_climb_storage_patch_delta
        + tabs_cache_patch_delta
        + nitw_cdn_patch_delta
        + tattletail_data_url_patch_delta
        + renpy_service_worker_patch_delta
        + milkbag_service_worker_patch_delta
        + milkbag_wasm_url_patch_delta
        + geometry_dash_cdn_patch_delta
        + geometry_dash_service_worker_patch_delta
        + stardew_opfs_patch_delta
    )


def patch_stardew_game_js(game: dict, game_root: Path) -> None:
    if game["id"] != "stardew-wasm":
        return
    game_js = game_root / "game.js"
    source = game_js.read_bytes()
    for original, replacement, label in (
        (STARDEW_OPFS_SETUP_ORIGINAL, STARDEW_OPFS_SETUP_SANDBOX_SAFE, "OPFS setup"),
        (STARDEW_OPFS_PERSIST_ORIGINAL, STARDEW_OPFS_PERSIST_SANDBOX_SAFE, "storage persistence"),
        (STARDEW_OPFS_READ_ORIGINAL, STARDEW_OPFS_READ_SANDBOX_SAFE, "OPFS reads"),
    ):
        if source.count(original) != 1:
            raise RuntimeError(f"Unexpected Stardew {label} code; refusing to patch")
        source = source.replace(original, replacement, 1)
    game_js.write_bytes(source)


def expected_local_files(game: dict) -> int:
    return game["expected_files"] + (len(RUFFLE_FILES) if game.get("ruffle") else 0)


def install_ruffle_assets(staging: Path) -> None:
    request = urllib.request.Request(
        RUFFLE_ARCHIVE_URL,
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        archive_bytes = response.read()
    if hashlib.sha256(archive_bytes).hexdigest() != RUFFLE_ARCHIVE_SHA256:
        raise RuntimeError("Pinned Ruffle archive failed its SHA-256 check")

    ruffle_dir = staging / "ruffle"
    ruffle_dir.mkdir(parents=True, exist_ok=True)
    found: set[str] = set()
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            for info in archive.infolist():
                filename = PurePosixPath(info.filename).name
                if filename not in RUFFLE_FILES:
                    continue
                if info.is_dir() or filename in found:
                    raise RuntimeError(f"Unexpected duplicate Ruffle asset: {filename}")
                content = archive.read(info)
                if len(content) != RUFFLE_FILES[filename]:
                    raise RuntimeError(f"Ruffle asset size check failed: {filename}")
                (ruffle_dir / filename).write_bytes(content)
                found.add(filename)
    except zipfile.BadZipFile as error:
        raise RuntimeError("Pinned Ruffle archive is not a valid ZIP file") from error
    if found != set(RUFFLE_FILES):
        raise RuntimeError("Pinned Ruffle archive is missing required web runtime files")


def localize_base_href(game: dict, index_path: Path) -> None:
    if not game["remote_base_href"] and game["id"] not in {
        "ac-gamecube",
        "hill-climb-racing",
        "night-in-the-woods",
        "tfs",
        "tru",
        "inside",
        "outside",
        "geometry-dash-webport",
    }:
        return
    content = index_path.read_bytes()
    localized = content
    if game["remote_base_href"]:
        pattern = re.compile(
            rb'(<base\b[^>]*\bhref\s*=\s*)(["\'])'
            + re.escape(game["remote_base_href"].encode("ascii"))
            + rb'\2',
            re.IGNORECASE,
        )
        localized, count = pattern.subn(
            lambda match: match.group(1) + match.group(2) + b"./" + match.group(2),
            localized,
            count=1,
        )
        already_localized = re.search(
            rb'<base\b[^>]*\bhref\s*=\s*(["\'])\./\1',
            localized,
            re.IGNORECASE,
        )
        if count != 1 and not already_localized:
            raise RuntimeError(
                f"Expected the pinned CDN base URL in {game['id']}/index.html"
            )

    def apply_patch(original: bytes, patched: bytes, label: str) -> None:
        nonlocal localized
        count = localized.count(original)
        if count == 1:
            localized = localized.replace(original, patched, 1)
        elif count == 0 and localized.count(patched) == 1:
            return
        else:
            raise RuntimeError(f"Expected exactly one {label} patch site in {game['id']}/index.html")

    if game["id"] == "pvz":
        apply_patch(
            PVZ_CACHE_FUNCTION_ORIGINAL,
            PVZ_CACHE_FUNCTION_SANDBOX_SAFE,
            "CacheStorage mergeFiles function",
        )
    if game.get("ruffle"):
        apply_patch(
            b"https://cdn.jsdelivr.net/gh/u-cvlassrom-y/google@main/ruffle.js",
            b"./ruffle/ruffle.js",
            "Dumb Ways to Die Ruffle runtime",
        )
        swf_url = b"https://cdn.jsdelivr.net/gh/web-ports/dumb-ways-to-die@main/data/main.swf"
        if localized.count(swf_url) == 2:
            localized = localized.replace(swf_url, b"./data/main.swf")
        elif localized.count(b"./data/main.swf") != 2:
            raise RuntimeError("Expected both Dumb Ways to Die SWF references")
    if game["id"] == "ac-gamecube":
        apply_patch(
            AC_SYNC_BLOCK_ORIGINAL,
            AC_SYNC_BLOCK_SANDBOX_SAFE,
            "Animal Crossing ROM storage callback",
        )
    if game["id"] == "cuphead":
        apply_patch(
            CUPHEAD_MERGE_FUNCTION_ORIGINAL,
            CUPHEAD_MERGE_FUNCTION_SANDBOX_SAFE,
            "Cuphead CacheStorage merge function",
        )
    if game["id"] == "class-of-09":
        apply_patch(
            CLASS09_RENPY_PRE_URL_ORIGINAL,
            CLASS09_RENPY_PRE_URL_SANDBOX_SAFE,
            "Class of '09 Ren'Py preloader URL",
        )
        apply_patch(
            CLASS09_RENPY_URL_ORIGINAL,
            CLASS09_RENPY_URL_SANDBOX_SAFE,
            "Class of '09 Ren'Py runtime URL",
        )
        apply_patch(
            CLASS09_SERVICE_WORKER_ORIGINAL,
            CLASS09_SERVICE_WORKER_SANDBOX_SAFE,
            "Class of '09 service worker registration",
        )
    if game["id"] in {"tfs", "tru"}:
        apply_patch(
            RENPY_SERVICE_WORKER_ORIGINAL,
            RENPY_SERVICE_WORKER_SANDBOX_SAFE,
            "Ren'Py service worker registration",
        )
    if game["id"] in {"inside", "outside"}:
        apply_patch(
            MILKBAG_SERVICE_WORKER_ORIGINAL,
            MILKBAG_SERVICE_WORKER_SANDBOX_SAFE,
            "Milk Bag game service worker registration",
        )
        apply_patch(
            MILKBAG_WASM_URL_ORIGINAL[game["id"]],
            MILKBAG_WASM_URL_SANDBOX_SAFE,
            "Milk Bag game external WebAssembly URL",
        )
    if game["id"] == "geometry-dash-webport":
        prefix_count = localized.count(GEOMETRY_DASH_CDN_PREFIX_ORIGINAL)
        if prefix_count == GEOMETRY_DASH_CDN_PREFIX_COUNT:
            localized = localized.replace(
                GEOMETRY_DASH_CDN_PREFIX_ORIGINAL,
                GEOMETRY_DASH_CDN_PREFIX_SANDBOX_SAFE,
            )
        elif prefix_count != 0 or localized.count(
            GEOMETRY_DASH_CDN_PREFIX_SANDBOX_SAFE
        ) != GEOMETRY_DASH_CDN_PREFIX_COUNT:
            raise RuntimeError("Expected six pinned Geometry Dash CDN asset URLs")
        apply_patch(
            GEOMETRY_DASH_SERVICE_WORKER_ORIGINAL,
            GEOMETRY_DASH_SERVICE_WORKER_SANDBOX_SAFE,
            "Geometry Dash service worker registration",
        )
    if game["id"] == "hill-climb-racing":
        apply_patch(
            HILL_CLIMB_JSPI_CHECK_ORIGINAL,
            HILL_CLIMB_JSPI_CHECK_SANDBOX_SAFE,
            "Hill Climb Racing JSPI check",
        )
        storage_count = localized.count(b"localStorage")
        if storage_count != HILL_CLIMB_STORAGE_REF_COUNT:
            raise RuntimeError(
                f"Expected {HILL_CLIMB_STORAGE_REF_COUNT} localStorage references in Hill Climb Racing index.html"
            )
        localized = localized.replace(b"localStorage", b"safeLocalStorage")
        apply_patch(
            HILL_CLIMB_STORAGE_SHIM_ORIGINAL,
            HILL_CLIMB_STORAGE_SHIM_SANDBOX_SAFE,
            "Hill Climb Racing storage fallback",
        )
    if game["id"] == "tabs":
        apply_patch(
            TABS_MERGE_FUNCTION_ORIGINAL,
            TABS_MERGE_FUNCTION_SANDBOX_SAFE,
            "TABS CacheStorage merge function",
        )
    if game["id"] == "night-in-the-woods":
        apply_patch(
            NIGHT_IN_THE_WOODS_CDN_ORIGINAL,
            NIGHT_IN_THE_WOODS_CDN_SANDBOX_SAFE,
            "Night in the Woods CDN root",
        )
    if game["id"] == "tattletail":
        apply_patch(
            TATTLETAIL_DATA_URL_SETUP_ORIGINAL,
            TATTLETAIL_DATA_URL_SETUP_SANDBOX_SAFE,
            "Tattletail Unity data URL setup",
        )
        apply_patch(
            TATTLETAIL_DATA_URL_ORIGINAL,
            TATTLETAIL_DATA_URL_SANDBOX_SAFE,
            "Tattletail Unity data URL config",
        )
    index_path.write_bytes(localized)


def raw_file_url(game: dict, relative_path: str) -> str:
    source_path = "/".join(
        part for part in (game["path"], relative_path) if part
    )
    encoded_path = urllib.parse.quote(source_path, safe="/")
    return (
        f"https://raw.githubusercontent.com/{game['repo']}/"
        f"{game['commit']}/{encoded_path}"
    )


def download_file(
    url: str,
    destination: Path,
    expected_oid: str,
    expected_byte_count: int | None = None,
) -> None:
    partial = destination.with_name(destination.name + ".part")
    last_error: Exception | None = None

    for attempt in range(4):
        try:
            downloaded = 0
            with urllib.request.urlopen(
                urllib.request.Request(url, headers={"User-Agent": USER_AGENT}),
                timeout=120,
            ) as response:
                size_header = response.headers.get("Content-Length")
                declared_size = (
                    int(size_header) if size_header and size_header.isdigit() else None
                )
                if (
                    expected_byte_count is not None
                    and declared_size is not None
                    and declared_size != expected_byte_count
                ):
                    raise RuntimeError(f"Unexpected size header for {url}")
                expected_size = expected_byte_count or declared_size
                digest = hashlib.sha1()
                if expected_size is not None:
                    digest.update(f"blob {expected_size}\0".encode("ascii"))
                with partial.open("wb") as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                        downloaded += len(chunk)
                        if expected_size is not None:
                            digest.update(chunk)
                        if expected_size is not None and downloaded > expected_size:
                            raise RuntimeError(f"Unexpectedly large download: {url}")
                if expected_size is not None and downloaded != expected_size:
                    raise RuntimeError(
                        f"Size mismatch for {url}: expected {expected_size}, got {downloaded}"
                    )
            if expected_size is None:
                actual_size = partial.stat().st_size
                digest.update(f"blob {actual_size}\0".encode("ascii"))
                with partial.open("rb") as source:
                    while chunk := source.read(1024 * 1024):
                        digest.update(chunk)
            if digest.hexdigest() != expected_oid:
                raise RuntimeError(
                    f"Git content verification failed for {url}"
                )
            os.replace(partial, destination)
            return
        except (OSError, RuntimeError, urllib.error.URLError) as error:
            last_error = error
            partial.unlink(missing_ok=True)
            if attempt < 3:
                time.sleep(2**attempt)

    raise RuntimeError(f"Could not download {url}: {last_error}")


def read_previous_manifest() -> dict:
    try:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def game_is_installed(game: dict, files: list[dict], previous: dict) -> bool:
    recorded = previous.get("games", {}).get(game["id"], {})
    if game.get("build_vite_site"):
        if (
            recorded.get("commit") != game["commit"]
            or recorded.get("entry") != game.get("entry", "index.html")
        ):
            return False
        game_root = ASSET_ROOT / game["id"]
        installed_files = [path for path in game_root.rglob("*") if path.is_file()]
        actual_bytes = sum(path.stat().st_size for path in installed_files)
        return bool(installed_files) and recorded.get("files") == len(installed_files) and recorded.get("bytes") == actual_bytes and (game_root / "index.html").is_file()
    if (
        recorded.get("commit") != game["commit"]
        or recorded.get("files") != expected_local_files(game)
        or recorded.get("bytes") != expected_local_bytes(game)
    ):
        return False

    game_root = ASSET_ROOT / game["id"]
    for item in files:
        target = game_root.joinpath(*PurePosixPath(item["path"]).parts)
        if not target.is_file() or target.is_symlink():
            return False
    installed_files = [path for path in game_root.rglob("*") if path.is_file()]
    actual_bytes = sum(path.stat().st_size for path in installed_files)
    return len(installed_files) == expected_local_files(game) and actual_bytes == expected_local_bytes(game)


def migrate_installed_game(
    game: dict,
    files: list[dict],
    previous: dict,
    asset_root: Path | None = None,
) -> bool:
    """Apply HTML-only compatibility patches without re-downloading game binaries."""
    recorded = previous.get("games", {}).get(game["id"], {})
    if (
        recorded.get("commit") != game["commit"]
        or recorded.get("files") != game["expected_files"]
    ):
        return False

    root = asset_root or ASSET_ROOT
    game_root = root / game["id"]
    actual_bytes = 0
    for item in files:
        target = game_root.joinpath(*PurePosixPath(item["path"]).parts)
        if not target.is_file() or target.is_symlink():
            return False
        actual_bytes += target.stat().st_size
    if len(files) != game["expected_files"] or actual_bytes != recorded.get("bytes"):
        return False

    index_path = game_root / "index.html"
    temporary = game_root / ".index.html.compat.tmp"
    try:
        temporary.write_bytes(index_path.read_bytes())
        localize_base_href(game, temporary)
        new_total = actual_bytes - index_path.stat().st_size + temporary.stat().st_size
        if new_total != expected_local_bytes(game):
            return False
        os.replace(temporary, index_path)
        return True
    except (OSError, RuntimeError):
        return False
    finally:
        temporary.unlink(missing_ok=True)


def install_game(game: dict, files: list[dict]) -> None:
    ASSET_ROOT.mkdir(parents=True, exist_ok=True)
    staging = ASSET_ROOT / f".{game['id']}.installing"
    target = ASSET_ROOT / game["id"]
    backup = ASSET_ROOT / f".{game['id']}.previous"

    shutil.rmtree(staging, ignore_errors=True)
    shutil.rmtree(backup, ignore_errors=True)
    staging.mkdir(parents=True)

    try:
        def install_one(item: dict) -> None:
            relative_path = PurePosixPath(item["path"])
            destination = staging.joinpath(*relative_path.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            download_file(
                item.get("url") or raw_file_url(game, item["path"]),
                destination,
                item["oid"],
                item.get("bytes"),
            )

        print(
            f"Downloading {game['id']}: {len(files)} files, "
            f"{game['expected_bytes']:,} bytes"
        )
        with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = [pool.submit(install_one, item) for item in files]
            for future in concurrent.futures.as_completed(futures):
                future.result()

        if game.get("build_vite_site"):
            node = subprocess.run(["node", "--version"], cwd=staging, capture_output=True, text=True)
            version = re.match(r"v?(\d+)", node.stdout.strip())
            if node.returncode or not version or int(version.group(1)) < 24:
                raise RuntimeError("Hit & Run requires Node.js 24 or newer to build its browser site.")
            subprocess.run(["npm", "ci", "--no-audit", "--no-fund"], cwd=staging, check=True)
            subprocess.run(
                ["npm", "run", "build", "--", "--base=/ported-games/hit-and-run-web/"],
                cwd=staging,
                check=True,
            )
            subprocess.run(["node", "tools/prepare_site.mjs"], cwd=staging, check=True)
            built = staging.with_name(f".{game['id']}.built")
            shutil.rmtree(built, ignore_errors=True)
            os.replace(staging / "dist", built)
            shutil.rmtree(staging)
            os.replace(built, staging)
            index_path = staging / "index.html"
            if not index_path.is_file():
                raise RuntimeError("Hit & Run build did not produce an index.html.")
            storage_shim = b"""<script>(()=>{const values=new Map();const storage={get length(){return values.size},key:i=>Array.from(values.keys())[i]??null,getItem:k=>values.has(String(k))?values.get(String(k)):null,setItem:(k,v)=>values.set(String(k),String(v)),removeItem:k=>values.delete(String(k)),clear:()=>values.clear()};try{Object.defineProperty(window,"localStorage",{configurable:true,value:storage});Object.defineProperty(window,"sessionStorage",{configurable:true,value:storage})}catch(_){}})();</script>"""
            html = index_path.read_bytes()
            if b"</head>" not in html.lower():
                raise RuntimeError("Hit & Run build has no HTML head for sandbox compatibility setup.")
            html = re.sub(rb"</head>", storage_shim + b"</head>", html, count=1, flags=re.IGNORECASE)
            index_path.write_bytes(html)
        elif (staging / "index.html").is_file():
            localize_base_href(game, staging / "index.html")
        patch_stardew_game_js(game, staging)
        if game.get("ruffle"):
            install_ruffle_assets(staging)
        installed_files = [path for path in staging.rglob("*") if path.is_file()]
        installed_bytes = sum(path.stat().st_size for path in installed_files)
        if game.get("build_vite_site"):
            if not installed_files or not (staging / "index.html").is_file() or installed_bytes > game["expected_bytes"]:
                raise RuntimeError(f"Built files for {game['id']} failed validation")
        elif (
            len(installed_files) != expected_local_files(game)
            or installed_bytes != expected_local_bytes(game)
        ):
            raise RuntimeError(
                f"Installed files for {game['id']} did not match the pinned manifest"
            )

        if target.exists():
            os.replace(target, backup)
        try:
            os.replace(staging, target)
        except OSError:
            if backup.exists() and not target.exists():
                os.replace(backup, target)
            raise
        shutil.rmtree(backup, ignore_errors=True)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def write_manifest(games: list[dict]) -> None:
    ASSET_ROOT.mkdir(parents=True, exist_ok=True)
    document = {
        "version": 1,
        "games": {
            game["id"]: {
                "installed": True,
                "commit": game["commit"],
                "files": sum(1 for path in (ASSET_ROOT / game["id"]).rglob("*") if path.is_file()) if game.get("build_vite_site") else expected_local_files(game),
                "bytes": sum(path.stat().st_size for path in (ASSET_ROOT / game["id"]).rglob("*") if path.is_file()) if game.get("build_vite_site") else expected_local_bytes(game),
                "entry": game.get("entry", "index.html"),
            }
            for game in games
        },
    }
    temporary = MANIFEST_PATH.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, MANIFEST_PATH)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="list the pinned files and disk usage without downloading them",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="redownload all selected game files even if already installed",
    )
    args = parser.parse_args()

    try:
        prepared = []
        total_bytes = 0
        previous = read_previous_manifest()
        for game in GAMES:
            files = source_tree(game)
            game["_files"] = files
            game_bytes = game["expected_bytes"] + (
                RUFFLE_BYTES if game.get("ruffle") else 0
            )
            total_bytes += game_bytes
            prepared.append(game)
            print(
                f"{game['id']}: {len(files)} files, {game_bytes:,} bytes "
                f"from {game['repo']}@{game['commit'][:12]}"
            )

        if total_bytes > MAX_TOTAL_BYTES:
            raise RuntimeError(
                f"Selected files total {total_bytes:,} bytes, exceeding the "
                f"{MAX_TOTAL_BYTES:,}-byte safety limit"
            )
        print(f"Total selected game assets: {total_bytes:,} bytes")
        print(f"Asset directory: {ASSET_ROOT}")
        if args.dry_run:
            print("Dry run complete; no game files were downloaded.")
            return 0

        for game in prepared:
            files = game["_files"]
            if not args.force and game_is_installed(game, files, previous):
                print(f"{game['id']}: already installed; skipping")
                continue
            if not args.force and migrate_installed_game(game, files, previous):
                print(f"{game['id']}: updated compatibility patch in place; game files reused")
                continue
            install_game(game, files)

        write_manifest(prepared)
        print("All selected game assets are installed.")
        return 0
    except Exception as error:
        print(f"Game asset installation failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
