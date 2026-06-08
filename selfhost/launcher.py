#!/usr/bin/env python3
"""
Portfolio98 Launcher — Python/Tkinter GUI for Linux Mint / Ubuntu / Debian.
Requires: python3-tk  (sudo apt install python3-tk)
Run from anywhere: python3 /path/to/selfhost/launcher.py
"""

import os
import re
import sys
import signal
import subprocess
import threading
import webbrowser
import time
from datetime import datetime
from pathlib import Path

try:
    import tkinter as tk
    from tkinter import ttk, scrolledtext, messagebox
except ImportError:
    print("tkinter not found.  Install it with:  sudo apt install python3-tk")
    sys.exit(1)

# ── Paths ─────────────────────────────────────────────────────────────────────
LAUNCHER_DIR    = Path(__file__).resolve().parent
REPO_DIR        = LAUNCHER_DIR.parent
ENV_FILE        = LAUNCHER_DIR / ".env"
RUN_DIR         = LAUNCHER_DIR / "run"
LOG_DIR         = LAUNCHER_DIR / "logs"
API_PID_FILE    = RUN_DIR / "api.pid"
API_LOG_FILE    = LOG_DIR / "api.log"
ERROR_LOG_FILE  = LOG_DIR / "error.log"
UPDATE_LOG_FILE = LOG_DIR / "update.log"
API_BIN         = REPO_DIR / "artifacts" / "api-server" / "dist" / "index.mjs"

RUN_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)

# ── Error-line detection (covers Node stack traces + shell ERRORs) ─────────────
_ERROR_RE = re.compile(
    r"(error|crash|exception|uncaught|fatal|fail|ECONNREFUSED|EADDRINUSE"
    r"|TypeError|ReferenceError|SyntaxError|unhandledRejection|\[CRASH\])",
    re.IGNORECASE,
)
_WARN_RE = re.compile(r"\b(warn|warning|deprecated)\b", re.IGNORECASE)

# ── Colour palette ─────────────────────────────────────────────────────────────
BG       = "#1e1e1e"
FG       = "#d4d4d4"
ERR_FG   = "#ff6b6b"
WARN_FG  = "#ffd93d"
DIM_FG   = "#888888"
GREEN    = "#4caf50"
RED      = "#f44336"
AMBER    = "#ffa726"
HEADER   = "#000080"

# ── Helpers ───────────────────────────────────────────────────────────────────
def load_env() -> dict:
    env: dict = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    return env

def get_pid(pid_file: Path):
    try:
        pid = int(pid_file.read_text().strip())
        os.kill(pid, 0)
        return pid
    except Exception:
        return None

def node_path() -> str:
    nvm_node = Path.home() / ".nvm" / "versions" / "node"
    if nvm_node.exists():
        for v in sorted(nvm_node.iterdir(), reverse=True):
            candidate = v / "bin" / "node"
            if candidate.exists():
                return str(candidate)
    return "node"

def tail_file(path: Path, n: int = 300) -> list[str]:
    try:
        lines = path.read_text(errors="replace").splitlines()
        return lines[-n:]
    except Exception:
        return []

def ts_now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# ── Main application ───────────────────────────────────────────────────────────
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Portfolio98 Launcher")
        self.geometry("820x680")
        self.minsize(700, 520)
        self._crash_alerted = False
        self._last_error_count = 0
        self._build_ui()
        self._poll()

    # ── Build UI ──────────────────────────────────────────────────────────────
    def _build_ui(self):
        # Header bar
        hdr = tk.Frame(self, bg=HEADER, padx=10, pady=7)
        hdr.pack(fill="x")
        tk.Label(hdr, text="📷  Portfolio98 Launcher",
                 bg=HEADER, fg="white", font=("Courier", 14, "bold")).pack(side="left")

        # Crash alert banner (hidden until needed)
        self._alert_frame = tk.Frame(self, bg="#b71c1c", padx=8, pady=4)
        self._alert_label = tk.Label(self._alert_frame, bg="#b71c1c", fg="white",
                                     font=("Arial", 9, "bold"), anchor="w")
        self._alert_label.pack(side="left", fill="x", expand=True)
        tk.Button(self._alert_frame, text="✕ Dismiss", bg="#b71c1c", fg="white",
                  relief="flat", font=("Arial", 8),
                  command=self._dismiss_alert).pack(side="right")
        # Not packed yet — shown on demand

        # Top control panel
        ctrl = tk.Frame(self, relief="groove", bd=2)
        ctrl.pack(fill="x", padx=6, pady=(6, 0))

        self._build_service_rows(ctrl)
        self._build_info_row(ctrl)
        self._build_action_bar(ctrl)

        # Log notebook (tabbed)
        nb_frame = tk.Frame(self, relief="groove", bd=2)
        nb_frame.pack(fill="both", expand=True, padx=6, pady=6)

        self._nb = ttk.Notebook(nb_frame)
        self._nb.pack(fill="both", expand=True)

        self._all_log   = self._make_log_tab("All Logs",    BG,      FG)
        self._err_log   = self._make_log_tab("⚠ Errors",    "#1a0a0a", ERR_FG)
        self._upd_log   = self._make_log_tab("Update Log",  BG,      FG)

        # Bottom toolbar for log pane
        log_bar = tk.Frame(nb_frame)
        log_bar.pack(fill="x", padx=4, pady=(0, 4))
        tk.Button(log_bar, text="Refresh", command=self._refresh_all_logs).pack(side="left", padx=2)
        tk.Button(log_bar, text="Clear current tab", command=self._clear_current_log).pack(side="left", padx=2)
        self._autoscroll = tk.BooleanVar(value=True)
        tk.Checkbutton(log_bar, text="Auto-scroll", variable=self._autoscroll).pack(side="left")
        self._error_count_label = tk.Label(log_bar, text="", fg=RED, font=("Arial", 9, "bold"))
        self._error_count_label.pack(side="right", padx=6)

    def _make_log_tab(self, title: str, bg: str, fg: str) -> scrolledtext.ScrolledText:
        frame = tk.Frame(self._nb)
        self._nb.add(frame, text=title)
        widget = scrolledtext.ScrolledText(frame, font=("Courier", 9),
                                           state="disabled", bg=bg, fg=fg,
                                           wrap="word", relief="flat")
        widget.pack(fill="both", expand=True)
        # Colour tags
        widget.tag_config("error",   foreground=ERR_FG)
        widget.tag_config("warning", foreground=WARN_FG)
        widget.tag_config("dim",     foreground=DIM_FG)
        widget.tag_config("normal",  foreground=FG if bg == BG else ERR_FG)
        return widget

    def _build_service_rows(self, parent):
        tk.Label(parent, text="Services", font=("Arial", 10, "bold"),
                 anchor="w").pack(fill="x", padx=6, pady=(4, 0))
        self._svc_rows: dict = {}
        services = [
            ("PostgreSQL (system)", None),
            ("API + Frontend",      API_PID_FILE),
        ]
        for name, pid_file in services:
            row = tk.Frame(parent)
            row.pack(fill="x", padx=10, pady=3)
            dot    = tk.Label(row, text="●", font=("Arial", 14), width=2)
            dot.pack(side="left")
            tk.Label(row, text=name, font=("Arial", 10),
                     width=22, anchor="w").pack(side="left")
            status = tk.Label(row, text="...", font=("Arial", 9), width=14, anchor="w")
            status.pack(side="left")
            for label, cb in [("Start",   lambda n=name: self._start(n)),
                               ("Stop",    lambda n=name: self._stop(n)),
                               ("Restart", lambda n=name: self._restart(n))]:
                tk.Button(row, text=label, width=8, command=cb).pack(side="left", padx=2)
            self._svc_rows[name] = {"dot": dot, "status": status}

    def _build_info_row(self, parent):
        row = tk.Frame(parent)
        row.pack(fill="x", padx=10, pady=(4, 2))
        tk.Label(row, text="URL:", font=("Arial", 9)).pack(side="left")
        env  = load_env()
        port = env.get("PORT", "3000")
        self._url_var = tk.StringVar(value=f"http://localhost:{port}")
        tk.Entry(row, textvariable=self._url_var, width=32,
                 font=("Courier", 9)).pack(side="left", padx=4)
        tk.Button(row, text="Open in Browser",
                  command=lambda: webbrowser.open(self._url_var.get())).pack(side="left")

    def _build_action_bar(self, parent):
        row = tk.Frame(parent)
        row.pack(fill="x", padx=10, pady=(2, 8))
        buttons = [
            ("🔧 Setup",   self._run_setup),
            ("🔨 Rebuild", self._run_rebuild),
            ("⬆ Update",  self._run_update),
            ("✏ Edit .env", self._edit_env),
            ("🔄 Refresh", self._update_status),
        ]
        for label, cmd in buttons:
            tk.Button(row, text=label, bg="#c0c0c0", command=cmd).pack(side="left", padx=2)

    # ── Polling ────────────────────────────────────────────────────────────────
    def _poll(self):
        self._update_status()
        self._refresh_all_logs()
        self.after(4000, self._poll)

    def _update_status(self):
        # PostgreSQL
        pg_ok = False
        try:
            r = subprocess.run(["systemctl", "is-active", "postgresql"],
                               capture_output=True, text=True)
            pg_ok = r.stdout.strip() == "active"
        except Exception:
            try:
                subprocess.run(["pg_isready", "-q"], check=True, capture_output=True)
                pg_ok = True
            except Exception:
                pg_ok = False
        self._set_svc_status("PostgreSQL (system)", pg_ok)

        # API
        pid = get_pid(API_PID_FILE)
        self._set_svc_status("API + Frontend", pid is not None,
                              f"PID {pid}" if pid else "")

        # Check for new errors and update badge
        self._check_error_count()

    def _set_svc_status(self, name: str, running: bool, extra: str = ""):
        row = self._svc_rows[name]
        if running:
            row["dot"].config(fg=GREEN)
            row["status"].config(text=("running " + extra).strip(), fg=GREEN)
        else:
            row["dot"].config(fg=RED)
            row["status"].config(text="stopped", fg=RED)

    def _check_error_count(self):
        count = 0
        try:
            if ERROR_LOG_FILE.exists():
                lines = ERROR_LOG_FILE.read_text(errors="replace").splitlines()
                count = sum(1 for l in lines if l.strip())
        except Exception:
            pass

        if count > 0:
            self._error_count_label.config(
                text=f"⚠ {count} error line{'s' if count != 1 else ''} in error.log")
        else:
            self._error_count_label.config(text="")

        # Crash alert: new crash entry since last check
        if count > self._last_error_count:
            new_lines = []
            try:
                all_lines = ERROR_LOG_FILE.read_text(errors="replace").splitlines()
                new_lines = all_lines[self._last_error_count:]
            except Exception:
                pass
            crashes = [l for l in new_lines if "[CRASH]" in l]
            if crashes and not self._crash_alerted:
                self._show_alert(f"💥  Crash detected: {crashes[-1].strip()}")
        self._last_error_count = count

    # ── Alert banner ──────────────────────────────────────────────────────────
    def _show_alert(self, msg: str):
        self._crash_alerted = True
        self._alert_label.config(text=msg)
        self._alert_frame.pack(fill="x", after=self.winfo_children()[0])
        # Switch to Errors tab automatically
        self._nb.select(1)

    def _dismiss_alert(self):
        self._alert_frame.pack_forget()
        self._crash_alerted = False

    # ── Log rendering ──────────────────────────────────────────────────────────
    def _refresh_all_logs(self):
        self._render_log(self._all_log, tail_file(API_LOG_FILE), colourise=True)
        self._render_log(self._err_log, tail_file(ERROR_LOG_FILE), colourise=True)
        self._render_log(self._upd_log, tail_file(UPDATE_LOG_FILE), colourise=False)

    def _render_log(self, widget: scrolledtext.ScrolledText, lines: list[str],
                    colourise: bool = True):
        widget.config(state="normal")
        widget.delete("1.0", "end")
        for line in lines:
            if not colourise:
                widget.insert("end", line + "\n", "normal")
            elif _ERROR_RE.search(line):
                widget.insert("end", line + "\n", "error")
            elif _WARN_RE.search(line):
                widget.insert("end", line + "\n", "warning")
            elif line.startswith("[launcher]") or line.startswith("#"):
                widget.insert("end", line + "\n", "dim")
            else:
                widget.insert("end", line + "\n", "normal")
        widget.config(state="disabled")
        if self._autoscroll.get():
            widget.see("end")

    def _append_log(self, widget: scrolledtext.ScrolledText, msg: str,
                    tag: str = "dim"):
        widget.config(state="normal")
        widget.insert("end", msg, tag)
        widget.config(state="disabled")
        if self._autoscroll.get():
            widget.see("end")

    def _clear_current_log(self):
        idx  = self._nb.index("current")
        tabs = [self._all_log, self._err_log, self._upd_log]
        files = [API_LOG_FILE, ERROR_LOG_FILE, UPDATE_LOG_FILE]
        if not messagebox.askyesno("Clear log?", f"Clear {files[idx].name}?"):
            return
        try:
            files[idx].write_text("")
            tabs[idx].config(state="normal")
            tabs[idx].delete("1.0", "end")
            tabs[idx].config(state="disabled")
            self._last_error_count = 0
            self._error_count_label.config(text="")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    # ── Service control ────────────────────────────────────────────────────────
    def _start(self, name: str):
        if name == "PostgreSQL (system)":
            self._shell_bg(["sudo", "systemctl", "start", "postgresql"],
                           "Starting PostgreSQL…")
        elif name == "API + Frontend":
            self._start_api()

    def _stop(self, name: str):
        if name == "PostgreSQL (system)":
            if messagebox.askyesno("Stop PostgreSQL?",
                                   "This stops the database — the site will go offline."):
                self._shell_bg(["sudo", "systemctl", "stop", "postgresql"],
                               "Stopping PostgreSQL…")
        elif name == "API + Frontend":
            self._stop_api()

    def _restart(self, name: str):
        if name == "PostgreSQL (system)":
            self._shell_bg(["sudo", "systemctl", "restart", "postgresql"],
                           "Restarting PostgreSQL…")
        elif name == "API + Frontend":
            self._stop_api()
            self.after(1500, self._start_api)

    def _start_api(self):
        if get_pid(API_PID_FILE):
            self._launcher_log("[launcher] API is already running\n")
            return
        if not API_BIN.exists():
            messagebox.showerror("Not built",
                                 "API bundle not found.\nClick 'Rebuild' first.")
            return
        env = load_env()
        if not env.get("DATABASE_URL"):
            messagebox.showerror("No .env",
                                 f"DATABASE_URL missing in {ENV_FILE}.\n"
                                 "Run Setup or edit .env.")
            return
        full_env = {**os.environ, **env}
        port = full_env.get("PORT", "3000")
        try:
            node  = node_path()
            out_f = open(API_LOG_FILE,   "a")
            err_f = open(ERROR_LOG_FILE, "a")
            # Write separator so restarts are visible in the logs
            stamp = f"\n{'─'*60}\n[{ts_now()}] [launcher] Starting API server\n{'─'*60}\n"
            out_f.write(stamp); err_f.write(stamp)
            proc = subprocess.Popen(
                [node, "--enable-source-maps", str(API_BIN)],
                env=full_env, stdout=out_f, stderr=err_f,
                start_new_session=True,
            )
            API_PID_FILE.write_text(str(proc.pid))
            self._launcher_log(
                f"[launcher] Started API (PID {proc.pid}) → port {port}\n")
            self._url_var.set(f"http://localhost:{port}")
            # Background crash-watcher
            threading.Thread(target=self._watch_api, args=(proc.pid,),
                             daemon=True).start()
        except Exception as exc:
            messagebox.showerror("Start failed", str(exc))

    def _watch_api(self, expected_pid: int):
        """Background thread: detect unexpected exit and surface it in the UI."""
        try:
            pid = expected_pid
            while True:
                time.sleep(2)
                try:
                    os.kill(pid, 0)   # still alive?
                except ProcessLookupError:
                    # Check if it was a controlled stop
                    stored = get_pid(API_PID_FILE)
                    if stored is None:
                        return   # clean stop
                    # Unexpected exit
                    msg = f"[{ts_now()}] [CRASH] API process (PID {pid}) exited unexpectedly"
                    try:
                        with open(ERROR_LOG_FILE, "a") as f:
                            f.write(msg + "\n")
                        API_PID_FILE.unlink(missing_ok=True)
                    except Exception:
                        pass
                    self.after(0, lambda m=msg: self._show_alert(f"💥 {m}"))
                    return
        except Exception:
            pass

    def _stop_api(self):
        pid = get_pid(API_PID_FILE)
        if pid:
            try:
                os.kill(pid, signal.SIGTERM)
                time.sleep(0.8)
                try: os.kill(pid, signal.SIGKILL)
                except ProcessLookupError: pass
            except ProcessLookupError:
                pass
            API_PID_FILE.unlink(missing_ok=True)
            self._launcher_log(f"[launcher] Stopped API (PID {pid})\n")
        else:
            self._launcher_log("[launcher] API was not running\n")

    def _launcher_log(self, msg: str):
        """Append a launcher-internal message to the All Logs tab + file."""
        self._append_log(self._all_log, msg, tag="dim")
        try:
            with open(API_LOG_FILE, "a") as f:
                f.write(msg)
        except Exception:
            pass

    def _shell_bg(self, cmd: list, msg: str):
        self._launcher_log(f"[launcher] {msg}\n")
        def run():
            try:
                r = subprocess.run(cmd, capture_output=True, text=True)
                out = (r.stdout + r.stderr).strip()
                if out:
                    self.after(0, lambda: self._launcher_log(out + "\n"))
            except Exception as exc:
                self.after(0, lambda: self._launcher_log(f"  error: {exc}\n"))
        threading.Thread(target=run, daemon=True).start()

    # ── Script launchers ───────────────────────────────────────────────────────
    def _run_setup(self):
        self._open_script(LAUNCHER_DIR / "setup.sh")

    def _run_rebuild(self):
        self._open_script(LAUNCHER_DIR / "rebuild.sh")

    def _run_update(self):
        update_sh = LAUNCHER_DIR / "update.sh"
        if not update_sh.exists():
            messagebox.showerror("Not found", f"{update_sh} not found")
            return
        if not messagebox.askyesno(
                "Run Update?",
                "This will:\n"
                "  1. git pull the latest code\n"
                "  2. Stop the running server\n"
                "  3. Rebuild everything\n"
                "  4. Restart the server\n\n"
                "Continue?"):
            return
        self._open_script(update_sh)

    def _open_script(self, script: Path):
        if not script.exists():
            messagebox.showerror("Not found", f"{script} not found")
            return
        os.chmod(script, 0o755)
        path = str(script)
        wait = "echo; echo '--- done --- press Enter to close'; read _"
        terminals = [
            ["x-terminal-emulator", "-e", f"bash '{path}'; {wait}"],
            ["xterm",               "-e", f"bash '{path}'; {wait}"],
            ["gnome-terminal", "--", "bash", "-c", f"bash '{path}'; {wait}"],
            ["xfce4-terminal",      "-e", f"bash '{path}'; {wait}"],
            ["konsole",             "-e", f"bash '{path}'; {wait}"],
            ["lxterminal",          "-e", f"bash '{path}'; {wait}"],
            ["mate-terminal",       "-e", f"bash '{path}'; {wait}"],
        ]
        for cmd in terminals:
            try:
                subprocess.Popen(cmd)
                return
            except FileNotFoundError:
                continue
        # Fallback: run silently in background, tail to Update Log tab
        self._launcher_log(f"[launcher] No terminal found — running {script.name} in background\n")
        def run_bg():
            try:
                r = subprocess.run(["bash", path], capture_output=True, text=True)
                out = r.stdout + r.stderr
                try:
                    with open(UPDATE_LOG_FILE, "a") as f:
                        f.write(out)
                except Exception:
                    pass
                self.after(0, self._refresh_all_logs)
            except Exception as exc:
                self.after(0, lambda: self._launcher_log(f"  error: {exc}\n"))
        threading.Thread(target=run_bg, daemon=True).start()

    # ── .env editor ───────────────────────────────────────────────────────────
    def _edit_env(self):
        if not ENV_FILE.exists():
            if messagebox.askyesno("Create .env?",
                                   f"{ENV_FILE} doesn't exist.\nCreate from template?"):
                example = LAUNCHER_DIR / ".env.example"
                src = example.read_text() if example.exists() else (
                    "DATABASE_URL=\nSESSION_SECRET=\nPORT=3000\n"
                    "SERVE_STATIC=1\nNODE_ENV=production\n"
                )
                ENV_FILE.write_text(src)
        for ed in ["xdg-open", "gedit", "kate", "mousepad", "xed", "pluma"]:
            try:
                subprocess.Popen([ed, str(ENV_FILE)])
                return
            except FileNotFoundError:
                continue
        self._inline_edit_env()

    def _inline_edit_env(self):
        win = tk.Toplevel(self)
        win.title("Edit .env")
        win.geometry("520x360")
        txt = scrolledtext.ScrolledText(win, font=("Courier", 10))
        txt.pack(fill="both", expand=True, padx=6, pady=6)
        if ENV_FILE.exists():
            txt.insert("1.0", ENV_FILE.read_text())
        def save():
            ENV_FILE.write_text(txt.get("1.0", "end-1c"))
            win.destroy()
            messagebox.showinfo("Saved", "Restart the API server for changes to take effect.")
        tk.Button(win, text="💾 Save", command=save).pack(pady=4)


if __name__ == "__main__":
    app = App()
    app.mainloop()
