#!/usr/bin/env python3
"""Install the selected static game ports into the self-hosted asset directory."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
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
from pathlib import Path, PurePosixPath


REPO_ROOT = Path(__file__).resolve().parent.parent
ASSET_ROOT = REPO_ROOT / "selfhost" / "data" / "ported-games"
MANIFEST_PATH = ASSET_ROOT / "asset-manifest.json"
USER_AGENT = "Portfolio98-selfhost-game-assets/1.0"
MAX_TOTAL_BYTES = 9_100_000_000
MAX_WORKERS = 6

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
)

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
    )


def localize_base_href(game: dict, index_path: Path) -> None:
    if not game["remote_base_href"] and game["id"] not in {
        "ac-gamecube",
        "hill-climb-racing",
        "night-in-the-woods",
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


def download_file(url: str, destination: Path, expected_oid: str) -> None:
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
                expected_size = int(size_header) if size_header and size_header.isdigit() else None
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
    if (
        recorded.get("commit") != game["commit"]
        or recorded.get("files") != game["expected_files"]
        or recorded.get("bytes") != expected_local_bytes(game)
    ):
        return False

    game_root = ASSET_ROOT / game["id"]
    actual_bytes = 0
    for item in files:
        target = game_root.joinpath(*PurePosixPath(item["path"]).parts)
        if not target.is_file() or target.is_symlink():
            return False
        actual_bytes += target.stat().st_size
    return len(files) == game["expected_files"] and actual_bytes == expected_local_bytes(game)


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
                raw_file_url(game, item["path"]),
                destination,
                item["oid"],
            )

        print(
            f"Downloading {game['id']}: {len(files)} files, "
            f"{game['expected_bytes']:,} bytes"
        )
        with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = [pool.submit(install_one, item) for item in files]
            for future in concurrent.futures.as_completed(futures):
                future.result()

        localize_base_href(game, staging / "index.html")
        installed_files = [path for path in staging.rglob("*") if path.is_file()]
        installed_bytes = sum(path.stat().st_size for path in installed_files)
        if (
            len(installed_files) != game["expected_files"]
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
                "files": game["expected_files"],
                "bytes": expected_local_bytes(game),
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
            game_bytes = game["expected_bytes"]
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
