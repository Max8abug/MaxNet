"""Crash-report helpers shared by the launcher and its non-GUI tests."""

import re
import signal


DIAGNOSTICS_VERSION = "v2"

_ERROR_LOG_RE = re.compile(
    r"(error|crash|exception|uncaught|fatal|fail|ECONNREFUSED|EADDRINUSE"
    r"|TypeError|ReferenceError|SyntaxError|unhandledRejection|\[CRASH\])",
    re.IGNORECASE,
)
_INFO_LOG_RE = re.compile(
    r"\[launcher\]\s+(?:Crash monitor\b|Starting API server\b)",
    re.IGNORECASE,
)


def unseen_log_lines(lines: list[str], previous_line_count: int) -> tuple[list[str], int]:
    if previous_line_count < 0 or previous_line_count > len(lines):
        return [], len(lines)
    return lines[previous_line_count:], len(lines)


def is_error_log_line(line: str) -> bool:
    return not _INFO_LOG_RE.search(line) and bool(_ERROR_LOG_RE.search(line))


def is_expected_api_exit(
    pid: int,
    return_code: int,
    explicitly_marked: bool,
    pid_file_pid: int | None,
) -> bool:
    if explicitly_marked:
        return True
    return pid_file_pid != pid and return_code in (0, -signal.SIGTERM)


def format_uptime(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}h{minutes:02d}m{seconds:02d}s"
    if minutes:
        return f"{minutes}m{seconds:02d}s"
    return f"{seconds}s"


def describe_exit(return_code: int) -> tuple[str, str]:
    if return_code < 0:
        signal_number = -return_code
        try:
            signal_name = signal.Signals(signal_number).name
        except ValueError:
            signal_name = f"signal {signal_number}"
        detail = f"was terminated by {signal_name} ({signal_number})"

        if signal_number == signal.SIGKILL:
            hint = (
                "Forced termination; possible causes include OOM, a manual kill, "
                "or a supervisor. Check kernel and cgroup logs to distinguish them."
            )
        elif signal_number == signal.SIGTERM:
            hint = (
                "Received SIGTERM; check launcher stop/restart activity and any "
                "service supervisor logs."
            )
        elif signal_number in (signal.SIGABRT, signal.SIGSEGV):
            hint = (
                "Node or a native module aborted; inspect preceding stderr and "
                "check coredumpctl for a saved dump."
            )
        else:
            hint = (
                "The process received an external signal; inspect system and "
                "supervisor logs for its sender."
            )
        return detail, hint

    detail = f"exited with code {return_code}"
    if return_code == 0:
        hint = (
            "The process exited cleanly without a launcher stop being recorded; "
            "check preceding output and any external automation."
        )
    else:
        hint = "Inspect the stderr output immediately before this report in error.log."
    return detail, hint


def build_crash_report(pid: int, return_code: int, uptime_seconds: float) -> str:
    detail, hint = describe_exit(return_code)
    oom_note = (
        " SIGKILL alone cannot prove an OOM kill."
        if return_code == -signal.SIGKILL
        else ""
    )
    return (
        f"[CRASH] [monitor={DIAGNOSTICS_VERSION}] API process (PID {pid}) "
        f"{detail} after {format_uptime(uptime_seconds)}. {hint}{oom_note}"
    )
