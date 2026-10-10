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

class GamePortInventoryTests(unittest.TestCase):
    def test_new_ports_are_pinned_with_expected_sizes(self):
        expected = {
            "among-us": (70, 864_877_715),
            "ac-gamecube": (22, 37_280_261),
            "class-of-09": (111, 245_830_265),
            "cuphead": (125, 2_208_353_037),
            "deltatraveler": (17, 256_912_659),
            "gang-beasts": (43, 489_357_360),
            "hill-climb-racing": (15, 186_445_517),
            "untitled-goose-game": (20, 100_800_959),
            "oneshot": (378, 83_446_381),
        }
        games = {game["id"]: game for game in installer.GAMES}
        for game_id, (files, size) in expected.items():
            with self.subTest(game=game_id):
                self.assertEqual(games[game_id]["expected_files"], files)
                self.assertEqual(games[game_id]["expected_bytes"], size)
                self.assertTrue(games[game_id]["commit"])
        self.assertGreater(sum(game["expected_bytes"] for game in installer.GAMES), 5_000_000_000)

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
