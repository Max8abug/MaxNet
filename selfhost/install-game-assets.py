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
MAX_TOTAL_BYTES = 6_000_000_000
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
    if game["remote_base_href"]:
        base_href_delta = (
            -len(game["remote_base_href"].encode("utf-8"))
            + len("./".encode("utf-8"))
        )
    else:
        base_href_delta = 0
    return game["expected_bytes"] + base_href_delta + cache_patch_delta


def localize_base_href(game: dict, index_path: Path) -> None:
    if not game["remote_base_href"]:
        return
    content = index_path.read_bytes()
    pattern = re.compile(
        rb'(<base\b[^>]*\bhref\s*=\s*)(["\'])'
        + re.escape(game["remote_base_href"].encode("ascii"))
        + rb'\2',
        re.IGNORECASE,
    )
    localized, count = pattern.subn(
        lambda match: match.group(1) + match.group(2) + b"./" + match.group(2),
        content,
        count=1,
    )
    if count != 1:
        raise RuntimeError(
            f"Expected the pinned CDN base URL in {game['id']}/index.html"
        )
    if game["id"] == "pvz":
        cache_count = localized.count(PVZ_CACHE_FUNCTION_ORIGINAL)
        if cache_count != 1:
            raise RuntimeError(
                "Expected the pinned CacheStorage mergeFiles function in pvz/index.html"
            )
        localized = localized.replace(
            PVZ_CACHE_FUNCTION_ORIGINAL,
            PVZ_CACHE_FUNCTION_SANDBOX_SAFE,
            1,
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
            install_game(game, files)

        write_manifest(prepared)
        print("All selected game assets are installed.")
        return 0
    except Exception as error:
        print(f"Game asset installation failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
