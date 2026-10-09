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
    is_expected_api_exit,
    is_error_log_line,
    unseen_log_lines,
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

    def test_existing_crash_lines_are_not_treated_as_new(self):
        lines = ["old startup", "[CRASH] historical event", ""]

        new_lines, next_offset = unseen_log_lines(lines, len(lines))

        self.assertEqual(new_lines, [])
        self.assertEqual(next_offset, len(lines))

    def test_only_appended_lines_are_new(self):
        lines = ["old startup", "[CRASH] historical event", "[CRASH] new event"]

        new_lines, next_offset = unseen_log_lines(lines, 2)

        self.assertEqual(new_lines, ["[CRASH] new event"])
        self.assertEqual(next_offset, 3)

    def test_truncated_log_resets_offset_without_replaying_old_alert(self):
        new_lines, next_offset = unseen_log_lines(["new file contents"], 8)

        self.assertEqual(new_lines, [])
        self.assertEqual(next_offset, 1)

    def test_gui_marked_stop_is_expected(self):
        self.assertTrue(is_expected_api_exit(1234, -15, True, 1234))

    def test_update_sigterm_with_removed_pid_file_is_expected(self):
        self.assertTrue(is_expected_api_exit(1234, -15, False, None))

    def test_unexpected_sigterm_with_unchanged_pid_file_is_reported(self):
        self.assertFalse(is_expected_api_exit(1234, -15, False, 1234))

    def test_nonzero_exit_is_not_hidden_by_removed_pid_file(self):
        self.assertFalse(is_expected_api_exit(1234, 1, False, None))

    def test_launcher_status_lines_are_not_errors(self):
        self.assertFalse(
            is_error_log_line("[2026-10-09 15:44:04] [launcher] Crash monitor v2 attached to API PID 954822")
        )
        self.assertFalse(
            is_error_log_line("[2026-10-09 15:33:35] [launcher] Starting API server")
        )

    def test_actual_api_error_remains_an_error(self):
        self.assertTrue(
            is_error_log_line("Error: database connection failed")
        )


if __name__ == "__main__":
    unittest.main()
