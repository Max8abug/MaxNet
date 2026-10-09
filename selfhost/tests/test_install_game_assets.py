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


if __name__ == "__main__":
    unittest.main()
