import importlib.util
import tempfile
import unittest
from pathlib import Path


INSTALLER_PATH = Path(__file__).resolve().parents[1] / "install-game-assets.py"
SPEC = importlib.util.spec_from_file_location("install_game_assets", INSTALLER_PATH)
assert SPEC and SPEC.loader
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


class PvzSandboxCompatibilityTests(unittest.TestCase):
    def test_localizer_makes_cache_storage_optional(self):
        game = next(game for game in installer.GAMES if game["id"] == "pvz")
        source = (
            b'<base href="'
            + game["remote_base_href"].encode("ascii")
            + b'">\n'
            + installer.PVZ_CACHE_FUNCTION_ORIGINAL
        )

        with tempfile.TemporaryDirectory() as temporary:
            index_path = Path(temporary) / "index.html"
            index_path.write_bytes(source)
            installer.localize_base_href(game, index_path)
            localized = index_path.read_bytes()

        self.assertIn(b'<base href="./">', localized)
        self.assertNotIn(installer.PVZ_CACHE_FUNCTION_ORIGINAL, localized)
        self.assertIn(b"PVZ cache unavailable; loading without persistent cache.", localized)
        self.assertIn(b"PVZ cache write failed; continuing without cache.", localized)
        self.assertEqual(
            len(localized) - len(source),
            installer.expected_local_bytes(game) - game["expected_bytes"],
        )

    def test_localizer_rejects_unrecognized_pvz_cache_code(self):
        game = next(game for game in installer.GAMES if game["id"] == "pvz")
        source = (
            b'<base href="'
            + game["remote_base_href"].encode("ascii")
            + b'">\n'
            + b"async function mergeFiles() {}"
        )

        with tempfile.TemporaryDirectory() as temporary:
            index_path = Path(temporary) / "index.html"
            index_path.write_bytes(source)
            with self.assertRaisesRegex(RuntimeError, "CacheStorage mergeFiles"):
                installer.localize_base_href(game, index_path)

    def test_dumb_ways_localizes_flash_movie_and_ruffle_runtime(self):
        game = next(game for game in installer.GAMES if game["id"] == "dumb-ways-to-die")
        source = (
            b'<base href="' + game["remote_base_href"].encode("ascii") + b'">'
            b'<script src="https://cdn.jsdelivr.net/gh/u-cvlassrom-y/google@main/ruffle.js"></script>'
            b'<param value="https://cdn.jsdelivr.net/gh/web-ports/dumb-ways-to-die@main/data/main.swf">'
            b'<embed src="https://cdn.jsdelivr.net/gh/web-ports/dumb-ways-to-die@main/data/main.swf">'
        )
        with tempfile.TemporaryDirectory() as temporary:
            index_path = Path(temporary) / "index.html"
            index_path.write_bytes(source)
            installer.localize_base_href(game, index_path)
            localized = index_path.read_bytes()

        self.assertIn(b'<base href="./">', localized)
        self.assertIn(b'src="./ruffle/ruffle.js"', localized)
        self.assertNotIn(b"cdn.jsdelivr.net", localized)

class GamePortInventoryTests(unittest.TestCase):
    def test_new_ports_are_pinned_with_expected_sizes(self):
        expected = {
            "among-us": (70, 864_877_715),
            "ac-gamecube": (22, 37_280_261),
            "class-of-09": (111, 245_830_265),
            "cuphead": (125, 2_208_353_037),
            "deltatraveler": (17, 256_912_659),
            "deltarune": (510, 933_226_913),
            "gang-beasts": (43, 489_357_360),
            "hill-climb-racing": (15, 186_445_517),
            "untitled-goose-game": (20, 100_800_959),
            "oneshot": (378, 83_446_381),
            "minesweeperplus": (17, 91_807_534),
            "night-in-the-woods": (33, 438_750_872),
            "tattletail": (9, 70_170_858),
            "tabs": (153, 1_840_088_490),
            "daddygame": (15, 126_653_214),
            "web-balatro": (21, 18_727_836),
            "quake3": (11, 50_937_513),
            "hit-and-run-web": (12_568, 1_228_679_250),
            "dumb-ways-to-die": (3, 25_836_728),
        }
        games = {game["id"]: game for game in installer.GAMES}
        for game_id, (files, size) in expected.items():
            with self.subTest(game=game_id):
                self.assertEqual(games[game_id]["expected_files"], files)
                self.assertEqual(games[game_id]["expected_bytes"], size)
                self.assertTrue(games[game_id]["commit"])
        self.assertGreater(sum(game["expected_bytes"] for game in installer.GAMES), 8_000_000_000)

    def test_nonstandard_game_entry_is_recorded_in_manifest(self):
        game = next(game for game in installer.GAMES if game["id"] == "minesweeperplus")
        self.assertEqual(game["entry"], "MinesweeperPlus.html")
        quake3 = next(game for game in installer.GAMES if game["id"] == "quake3")
        self.assertEqual(quake3["entry"], "Quake3.htm?demo")
        hit_and_run = next(game for game in installer.GAMES if game["id"] == "hit-and-run-web")
        self.assertTrue(hit_and_run["build_vite_site"])
        self.assertEqual(hit_and_run["entry"], "index.html")
        dumb_ways = next(game for game in installer.GAMES if game["id"] == "dumb-ways-to-die")
        self.assertEqual(installer.expected_local_files(dumb_ways), 10)
        self.assertEqual(installer.expected_local_bytes(dumb_ways), 55_066_917)

    def test_animal_crossing_waits_for_rom_storage_or_falls_back_to_memory(self):
        game = next(game for game in installer.GAMES if game["id"] == "ac-gamecube")
        with tempfile.TemporaryDirectory() as temporary:
            index_path = Path(temporary) / "index.html"
            index_path.write_bytes(installer.AC_SYNC_BLOCK_ORIGINAL)
            installer.localize_base_href(game, index_path)
            localized = index_path.read_bytes()

        self.assertNotIn(installer.AC_SYNC_BLOCK_ORIGINAL, localized)
        self.assertIn(b"await new Promise(function(resolve)", localized)
        self.assertIn(b"setTimeout(finish, 2000)", localized)
        self.assertIn(b"setStartEnabled(!0)", localized)
        self.assertEqual(
            len(localized) - len(installer.AC_SYNC_BLOCK_ORIGINAL),
            installer.expected_local_bytes(game) - game["expected_bytes"],
        )

    def test_cuphead_cache_storage_failure_does_not_abort_startup(self):
        game = next(game for game in installer.GAMES if game["id"] == "cuphead")
        source = (
            b'<base href="'
            + game["remote_base_href"].encode("ascii")
            + b'">\n'
            + installer.CUPHEAD_MERGE_FUNCTION_ORIGINAL
        )
        with tempfile.TemporaryDirectory() as temporary:
            index_path = Path(temporary) / "index.html"
            index_path.write_bytes(source)
            installer.localize_base_href(game, index_path)
            localized = index_path.read_bytes()

        self.assertNotIn(installer.CUPHEAD_MERGE_FUNCTION_ORIGINAL, localized)
        self.assertIn(b"Cuphead cache unavailable", localized)
        self.assertIn(b"return URL.createObjectURL(mergedBlob)", localized)

    def test_class09_does_not_register_service_worker_in_sandbox(self):
        game = next(game for game in installer.GAMES if game["id"] == "class-of-09")
        source = (
            b'<base href="'
            + game["remote_base_href"].encode("ascii")
            + b'">\n'
            + b'renpypre.src = "'
            + installer.CLASS09_RENPY_PRE_URL_ORIGINAL
            + b'"; renpy.src = "'
            + installer.CLASS09_RENPY_URL_ORIGINAL
            + b'";\n'
            + installer.CLASS09_SERVICE_WORKER_ORIGINAL
        )
        with tempfile.TemporaryDirectory() as temporary:
            index_path = Path(temporary) / "index.html"
            index_path.write_bytes(source)
            installer.localize_base_href(game, index_path)
            localized = index_path.read_bytes()

        self.assertNotIn(installer.CLASS09_SERVICE_WORKER_ORIGINAL, localized)
        self.assertIn(b"Offline service workers are unavailable", localized)
        self.assertIn(b'renpypre.src = "./renpy-pre.js"', localized)
        self.assertIn(b'renpy.src = "./renpy.js"', localized)
        self.assertNotIn(b"cdn.jsdelivr.net", localized)

    def test_hill_climb_explains_required_browser_feature(self):
        game = next(game for game in installer.GAMES if game["id"] == "hill-climb-racing")
        source = (
            installer.HILL_CLIMB_STORAGE_SHIM_ORIGINAL
            + b"\n"
            + b"localStorage.getItem('setting');\n" * installer.HILL_CLIMB_STORAGE_REF_COUNT
            + installer.HILL_CLIMB_JSPI_CHECK_ORIGINAL
        )
        with tempfile.TemporaryDirectory() as temporary:
            index_path = Path(temporary) / "index.html"
            index_path.write_bytes(source)
            installer.localize_base_href(game, index_path)
            localized = index_path.read_bytes()

        self.assertNotIn(installer.HILL_CLIMB_JSPI_CHECK_ORIGINAL, localized)
        self.assertIn(b"WebAssembly JSPI support", localized)
        self.assertIn(b"Not supported", localized)

    def test_hill_climb_storage_unavailable_does_not_abort_startup(self):
        game = next(game for game in installer.GAMES if game["id"] == "hill-climb-racing")
        source = (
            installer.HILL_CLIMB_STORAGE_SHIM_ORIGINAL
            + b"\n"
            + b"localStorage.getItem('setting');\n" * installer.HILL_CLIMB_STORAGE_REF_COUNT
            + installer.HILL_CLIMB_JSPI_CHECK_ORIGINAL
        )
        with tempfile.TemporaryDirectory() as temporary:
            index_path = Path(temporary) / "index.html"
            index_path.write_bytes(source)
            installer.localize_base_href(game, index_path)
            localized = index_path.read_bytes()

        self.assertIn(b"const safeLocalStorage = (() =>", localized)
        self.assertEqual(
            localized.count(b"safeLocalStorage.getItem('setting')"),
            installer.HILL_CLIMB_STORAGE_REF_COUNT,
        )
        self.assertIn(b"storage.getItem(key)", localized)
        self.assertEqual(
            len(localized) - len(source),
            installer.expected_local_bytes(game) - game["expected_bytes"],
        )

    def test_existing_game_patch_migration_reuses_large_game_files(self):
        game = next(game for game in installer.GAMES if game["id"] == "cuphead")
        base = (
            b'<base href="'
            + game["remote_base_href"].encode("ascii")
            + b'">\n'
        )
        raw_index = base + installer.CUPHEAD_MERGE_FUNCTION_ORIGINAL
        installed_old_index = raw_index.replace(
            game["remote_base_href"].encode("ascii"),
            b"./",
            1,
        )
        migration_game = dict(game)
        migration_game["expected_files"] = 1
        migration_game["expected_bytes"] = len(raw_index)
        previous = {
            "games": {
                "cuphead": {
                    "commit": game["commit"],
                    "files": 1,
                    "bytes": len(installed_old_index),
                }
            }
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            game_root = root / "cuphead"
            game_root.mkdir()
            (game_root / "index.html").write_bytes(installed_old_index)
            migrated = installer.migrate_installed_game(
                migration_game,
                [{"path": "index.html"}],
                previous,
                asset_root=root,
            )
            localized = (game_root / "index.html").read_bytes()

        self.assertTrue(migrated)
        self.assertIn(b"Cuphead cache unavailable", localized)
        self.assertEqual(
            len(localized),
            installer.expected_local_bytes(migration_game),
        )

    def test_tabs_localizes_assets_and_loads_without_cache_storage(self):
        game = next(game for game in installer.GAMES if game["id"] == "tabs")
        source = (
            b'<base href="'
            + game["remote_base_href"].encode("ascii")
            + b'">\n'
            + installer.TABS_MERGE_FUNCTION_ORIGINAL
        )
        with tempfile.TemporaryDirectory() as temporary:
            index_path = Path(temporary) / "index.html"
            index_path.write_bytes(source)
            installer.localize_base_href(game, index_path)
            localized = index_path.read_bytes()

        self.assertIn(b'<base href="./">', localized)
        self.assertNotIn(game["remote_base_href"].encode("ascii"), localized)
        self.assertNotIn(installer.TABS_MERGE_FUNCTION_ORIGINAL, localized)
        self.assertIn(b"TABS cache unavailable", localized)
        self.assertEqual(
            len(localized) - len(source),
            installer.expected_local_bytes(game) - game["expected_bytes"],
        )

    def test_tattletail_assets_are_served_from_the_self_hosted_path(self):
        game = next(game for game in installer.GAMES if game["id"] == "tattletail")
        source = (
            b'<base href="'
            + game["remote_base_href"].encode("ascii")
            + b'">\n'
            + b'<script src="Build/UnityLoader.js"></script>\n'
            + b'var json = {\n          dataUrl: dataUrl,'
        )
        with tempfile.TemporaryDirectory() as temporary:
            index_path = Path(temporary) / "index.html"
            index_path.write_bytes(source)
            installer.localize_base_href(game, index_path)
            localized = index_path.read_bytes()

        self.assertIn(b'<base href="./">', localized)
        self.assertNotIn(game["remote_base_href"].encode("ascii"), localized)
        self.assertIn(b"window.dataUrll = dataUrl;", localized)
        self.assertIn(b'dataUrl: "WebGL.data.unityweb",', localized)
        self.assertEqual(
            len(localized) - len(source),
            installer.expected_local_bytes(game) - game["expected_bytes"],
        )

    def test_night_in_the_woods_loads_from_self_hosted_path(self):
        game = next(game for game in installer.GAMES if game["id"] == "night-in-the-woods")
        with tempfile.TemporaryDirectory() as temporary:
            index_path = Path(temporary) / "index.html"
            index_path.write_bytes(installer.NIGHT_IN_THE_WOODS_CDN_ORIGINAL)
            installer.localize_base_href(game, index_path)
            localized = index_path.read_bytes()

        self.assertEqual(localized, installer.NIGHT_IN_THE_WOODS_CDN_SANDBOX_SAFE)
        self.assertNotIn(b"cdn.jsdelivr.net", localized)
        self.assertEqual(
            len(localized) - len(installer.NIGHT_IN_THE_WOODS_CDN_ORIGINAL),
            installer.expected_local_bytes(game) - game["expected_bytes"],
        )

    def test_localizer_skips_games_with_relative_asset_paths(self):
        game = next(game for game in installer.GAMES if game["id"] == "among-us")
        with tempfile.TemporaryDirectory() as temporary:
            index_path = Path(temporary) / "index.html"
            source = b'<script src="Build/game.js"></script>'
            index_path.write_bytes(source)
            installer.localize_base_href(game, index_path)
            self.assertEqual(index_path.read_bytes(), source)


if __name__ == "__main__":
    unittest.main()
