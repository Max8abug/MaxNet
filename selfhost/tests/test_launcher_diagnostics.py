import sys
import unittest
from pathlib import Path


SELFHOST_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SELFHOST_DIR))

from launcher_diagnostics import (  # noqa: E402
    DIAGNOSTICS_VERSION,
    build_crash_report,
    describe_exit,
    format_uptime,
)


class LauncherCrashDiagnosticsTests(unittest.TestCase):
    def test_formats_process_uptime(self):
        self.assertEqual(format_uptime(0), "0s")
        self.assertEqual(format_uptime(125), "2m05s")
        self.assertEqual(format_uptime(3723), "1h02m03s")

    def test_signal_report_distinguishes_sigkill_without_claiming_oom(self):
        report = build_crash_report(950807, -9, 1239)

        self.assertIn(f"[monitor={DIAGNOSTICS_VERSION}]", report)
        self.assertIn("PID 950807", report)
        self.assertIn("SIGKILL (9)", report)
        self.assertIn("after 20m39s", report)
        self.assertIn("possible causes include OOM", report)
        self.assertIn("cannot prove an OOM kill", report)

    def test_sigterm_report_points_to_launcher_lifecycle(self):
        detail, hint = describe_exit(-15)

        self.assertEqual(detail, "was terminated by SIGTERM (15)")
        self.assertIn("stop/restart activity", hint)

    def test_nonzero_exit_points_to_stderr(self):
        detail, hint = describe_exit(1)

        self.assertEqual(detail, "exited with code 1")
        self.assertIn("stderr output", hint)

    def test_clean_exit_is_not_misreported_as_an_error_code(self):
        detail, hint = describe_exit(0)

        self.assertEqual(detail, "exited with code 0")
        self.assertIn("exited cleanly", hint)


if __name__ == "__main__":
    unittest.main()
