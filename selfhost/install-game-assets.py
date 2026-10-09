#!/usr/bin/env python3
"""Install the selected static game ports into Vite's ignored public asset folder."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath


REPO_ROOT = Path(__file__).resolve().parent.parent
ASSET_ROOT = REPO_ROOT / "selfhost" / "data" / "ported-games"
MANIFEST_PATH = ASSET_ROOT / "asset-manifest.json"
USER_AGENT = "Portfolio98-selfhost-game-assets/1.0"
MAX_TOTAL_BYTES = 1_250_000_000
MAX_WORKERS = 6

# Only the requested game subfolders are fetched. Commits are pinned so a normal
# site update cannot silently change the game files or expand the download.
GAMES = (
    {
        "id": "getting-over-it",
        "repo": "genizy/web-port",
        "commit": "a8bea5fd11f88e5a9192857f434e299c40efe7e6",
        "path": "getting-over-it",
    },
    {
        "id": "web-fishing",
        "repo": "genizy/web-port",
        "commit": "a8bea5fd11f88e5a9192857f434e299c40efe7e6",
        "path": "web-fishing",
    },
    {
        "id": "pvz",
        "repo": "web-ports/pvz",
        "commit": "e3b5ddce5a318df69698d906a6d78313e327f965",
        "path": "",
    },
    {
        "id": "undertale",
        "repo": "bandit968thegamer-ops/undertale",
        "commit": "5a0e1d886142b69eeb21ec6642469757c5fcb307",
        "path": "undertale",
    },
)


def request(url: str, *, accept: str = "*/*", timeout: int = 45):
    return urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": accept},
    )


def get_json(url: str) -> dict:
    with urllib.request.urlopen(
        request(url, accept="application/vnd.github+json"), timeout=45
    ) as response:
        return json.load(response)


def source_tree(game: dict) -> list[dict]:
    api_root = f"https://api.github.com/repos/{game['repo']}"
    if game["path"]:
        root_entries = get_json(
            f"{api_root}/contents?ref={game['commit']}"
        )
        folder = next(
            (entry for entry in root_entries if entry.get("name") == game["path"]),
            None,
        )
        if not folder or folder.get("type") != "dir":
            raise RuntimeError(
                f"Could not find requested source folder {game['repo']}/{game['path']}"
            )
        tree_sha = folder["sha"]
    else:
        commit = get_json(f"{api_root}/git/commits/{game['commit']}")
        tree_sha = commit["tree"]["sha"]

    tree = get_json(f"{api_root}/git/trees/{tree_sha}?recursive=1")
    if tree.get("truncated"):
        raise RuntimeError(
            f"GitHub returned an incomplete file listing for {game['id']}"
        )

    files = []
    for entry in tree.get("tree", []):
        if entry.get("type") != "blob":
            continue
        relative_path = PurePosixPath(entry["path"])
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise RuntimeError(f"Unsafe source path in {game['id']}: {entry['path']}")
        if entry.get("mode") == "120000":
            raise RuntimeError(
                f"Refusing to install symlink from {game['id']}: {entry['path']}"
            )
        files.append(
            {
                "path": relative_path.as_posix(),
                "size": int(entry.get("size", 0)),
            }
        )

    if not files:
        raise RuntimeError(f"No files were found for {game['id']}")
    return files


def raw_file_url(game: dict, relative_path: str) -> str:
    source_path = "/".join(
        part for part in (game["path"], relative_path) if part
    )
    encoded_path = urllib.parse.quote(source_path, safe="/")
    return (
        f"https://raw.githubusercontent.com/{game['repo']}/"
        f"{game['commit']}/{encoded_path}"
    )


def download_file(url: str, destination: Path, expected_size: int) -> None:
    partial = destination.with_name(destination.name + ".part")
    last_error: Exception | None = None

    for attempt in range(4):
        try:
            downloaded = 0
            with urllib.request.urlopen(request(url), timeout=120) as response:
                with partial.open("wb") as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                        downloaded += len(chunk)
                        if downloaded > expected_size:
                            raise RuntimeError(f"Unexpectedly large download: {url}")
            if downloaded != expected_size:
                raise RuntimeError(
                    f"Size mismatch for {url}: expected {expected_size}, got {downloaded}"
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
        or recorded.get("files") != len(files)
        or recorded.get("bytes") != sum(item["size"] for item in files)
    ):
        return False

    game_root = ASSET_ROOT / game["id"]
    for item in files:
        target = game_root.joinpath(*PurePosixPath(item["path"]).parts)
        if not target.is_file() or target.stat().st_size != item["size"]:
            return False
    return True


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
                item["size"],
            )

        print(
            f"Downloading {game['id']}: {len(files)} files, "
            f"{sum(item['size'] for item in files):,} bytes"
        )
        with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = [pool.submit(install_one, item) for item in files]
            for future in concurrent.futures.as_completed(futures):
                future.result()

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
                "files": len(game["_files"]),
                "bytes": sum(item["size"] for item in game["_files"]),
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
            game_bytes = sum(item["size"] for item in files)
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
