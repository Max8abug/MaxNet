#!/usr/bin/env python3
"""
Portfolio98 Launcher — Python/Tkinter GUI for Linux Mint / Ubuntu / Debian.
Requires: python3-tk (sudo apt install python3-tk)
Run from anywhere: python3 /path/to/selfhost/launcher.py
"""

import os
import sys
import signal
import subprocess
import threading
import webbrowser
import time
from pathlib import Path
try:
    import tkinter as tk
    from tkinter import ttk, scrolledtext, messagebox, filedialog
except ImportError:
    print("tkinter not found. Install it with: sudo apt install python3-tk")
    sys.exit(1)

# ── Paths ────────────────────────────────────────────────────────────────────
LAUNCHER_DIR = Path(__file__).resolve().parent
REPO_DIR     = LAUNCHER_DIR.parent
ENV_FILE     = LAUNCHER_DIR / ".env"
RUN_DIR      = LAUNCHER_DIR / "run"
LOG_DIR      = LAUNCHER_DIR / "logs"
API_PID_FILE = RUN_DIR / "api.pid"
API_LOG_FILE = LOG_DIR / "api.log"
API_BIN      = REPO_DIR / "artifacts" / "api-server" / "dist" / "index.mjs"

RUN_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)

# ── Helpers ───────────────────────────────────────────────────────────────────
def load_env():
    env = {}
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
        os.kill(pid, 0)   # raises if not running
        return pid
    except Exception:
        return None

def node_path():
    """Resolve node via nvm or PATH."""
    nvm_node = Path.home() / ".nvm" / "versions" / "node"
    if nvm_node.exists():
        # pick the highest version installed
        versions = sorted(nvm_node.iterdir(), reverse=True)
        for v in versions:
            candidate = v / "bin" / "node"
            if candidate.exists():
                return str(candidate)
    return "node"

# ── Main App ──────────────────────────────────────────────────────────────────
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Portfolio98 Launcher")
        self.resizable(True, True)
        self.minsize(640, 500)
        self._build_ui()
        self._poll()

    # ─ UI ─────────────────────────────────────────────────────────────────────
    def _build_ui(self):
        # Title bar
        header = tk.Frame(self, bg="#000080", padx=8, pady=6)
        header.pack(fill="x")
        tk.Label(header, text="📷 Portfolio98 Launcher", bg="#000080", fg="white",
                 font=("Courier", 14, "bold")).pack(side="left")

        # Main panes
        pane = tk.PanedWindow(self, orient="vertical", sashrelief="raised", sashwidth=5)
        pane.pack(fill="both", expand=True, padx=6, pady=6)

        top = tk.Frame(pane, relief="groove", bd=2)
        pane.add(top, stretch="never")

        bottom = tk.Frame(pane, relief="groove", bd=2)
        pane.add(bottom, stretch="always")

        # ── Service rows ──
        tk.Label(top, text="Services", font=("Arial", 10, "bold"), anchor="w").pack(fill="x", padx=4, pady=(4,0))
        self._svc_rows = {}
        for name, pid_file in [("PostgreSQL (system)", None), ("API + Frontend", API_PID_FILE)]:
            row = tk.Frame(top)
            row.pack(fill="x", padx=8, pady=3)
            dot = tk.Label(row, text="●", font=("Arial", 14), width=2)
            dot.pack(side="left")
            tk.Label(row, text=name, font=("Arial", 10), width=22, anchor="w").pack(side="left")
            status = tk.Label(row, text="...", font=("Arial", 9), width=10, anchor="w")
            status.pack(side="left")
            btn_start  = tk.Button(row, text="Start",   width=7, command=lambda n=name: self._start(n))
            btn_stop   = tk.Button(row, text="Stop",    width=7, command=lambda n=name: self._stop(n))
            btn_restart= tk.Button(row, text="Restart", width=7, command=lambda n=name: self._restart(n))
            for b in (btn_start, btn_stop, btn_restart): b.pack(side="left", padx=2)
            self._svc_rows[name] = {"dot": dot, "status": status, "start": btn_start, "stop": btn_stop, "restart": btn_restart}

        # ── Port + open button ──
        info_row = tk.Frame(top)
        info_row.pack(fill="x", padx=8, pady=(4,6))
        tk.Label(info_row, text="URL:", font=("Arial", 9)).pack(side="left")
        env = load_env()
        port = env.get("PORT", "3000")
        self._url_var = tk.StringVar(value=f"http://localhost:{port}")
        url_entry = tk.Entry(info_row, textvariable=self._url_var, width=30, font=("Courier", 9))
        url_entry.pack(side="left", padx=4)
        tk.Button(info_row, text="Open in Browser", command=lambda: webbrowser.open(self._url_var.get())).pack(side="left")

        # ── Action bar ──
        actions = tk.Frame(top)
        actions.pack(fill="x", padx=8, pady=(0,6))
        tk.Button(actions, text="🔧 Run Setup", bg="#c0c0c0", command=self._run_setup).pack(side="left", padx=2)
        tk.Button(actions, text="🔨 Rebuild", bg="#c0c0c0", command=self._run_rebuild).pack(side="left", padx=2)
        tk.Button(actions, text="✏ Edit .env", bg="#c0c0c0", command=self._edit_env).pack(side="left", padx=2)
        tk.Button(actions, text="🔄 Refresh", bg="#c0c0c0", command=self._update_status).pack(side="left", padx=2)

        # ── Log viewer ──
        tk.Label(bottom, text="Logs (API server)", font=("Arial", 9, "bold"), anchor="w").pack(fill="x", padx=4)
        self._log_text = scrolledtext.ScrolledText(bottom, font=("Courier", 9), state="disabled",
                                                    bg="#1e1e1e", fg="#d4d4d4", wrap="word")
        self._log_text.pack(fill="both", expand=True, padx=4, pady=(0,4))
        log_btn = tk.Frame(bottom)
        log_btn.pack(fill="x", padx=4, pady=(0,4))
        tk.Button(log_btn, text="Refresh Log", command=self._load_log).pack(side="left", padx=2)
        tk.Button(log_btn, text="Clear Log", command=self._clear_log_file).pack(side="left", padx=2)
        self._autoscroll_var = tk.BooleanVar(value=True)
        tk.Checkbutton(log_btn, text="Auto-scroll", variable=self._autoscroll_var).pack(side="left")

    # ─ Status polling ──────────────────────────────────────────────────────────
    def _poll(self):
        self._update_status()
        self._load_log()
        self.after(3000, self._poll)

    def _update_status(self):
        # PostgreSQL
        pg_running = False
        try:
            r = subprocess.run(["systemctl", "is-active", "postgresql"], capture_output=True, text=True)
            pg_running = r.stdout.strip() == "active"
        except Exception:
            try:
                subprocess.run(["pg_isready", "-q"], check=True, capture_output=True)
                pg_running = True
            except Exception:
                pg_running = False
        self._set_status("PostgreSQL (system)", pg_running)

        # API
        api_pid = get_pid(API_PID_FILE)
        self._set_status("API + Frontend", api_pid is not None, str(api_pid) if api_pid else "")

    def _set_status(self, name, running, extra=""):
        row = self._svc_rows[name]
        if running:
            row["dot"].config(fg="green")
            row["status"].config(text=f"running {extra}".strip(), fg="green")
        else:
            row["dot"].config(fg="red")
            row["status"].config(text="stopped", fg="red")

    # ─ Actions ────────────────────────────────────────────────────────────────
    def _start(self, name):
        if name == "PostgreSQL (system)":
            self._shell_bg(["sudo", "systemctl", "start", "postgresql"], "Starting PostgreSQL…")
        elif name == "API + Frontend":
            self._start_api()

    def _stop(self, name):
        if name == "PostgreSQL (system)":
            if messagebox.askyesno("Stop PostgreSQL?", "This will stop the database. The site will go offline."):
                self._shell_bg(["sudo", "systemctl", "stop", "postgresql"], "Stopping PostgreSQL…")
        elif name == "API + Frontend":
            self._stop_api()

    def _restart(self, name):
        if name == "PostgreSQL (system)":
            self._shell_bg(["sudo", "systemctl", "restart", "postgresql"], "Restarting PostgreSQL…")
        elif name == "API + Frontend":
            self._stop_api()
            self.after(1500, self._start_api)

    def _start_api(self):
        if get_pid(API_PID_FILE):
            self._log_append("[launcher] API is already running\n")
            return
        if not API_BIN.exists():
            messagebox.showerror("Not built", "API bundle not found.\nRun 'Rebuild' first to build the project.")
            return
        env = load_env()
        if not env.get("DATABASE_URL"):
            messagebox.showerror("No .env", f".env not found or DATABASE_URL missing.\nExpected: {ENV_FILE}")
            return
        full_env = {**os.environ, **env}
        full_env["PORT"] = env.get("PORT", "3000")
        try:
            node = node_path()
            log_f = open(API_LOG_FILE, "a")
            proc = subprocess.Popen(
                [node, "--enable-source-maps", str(API_BIN)],
                env=full_env, stdout=log_f, stderr=log_f,
                start_new_session=True,
            )
            API_PID_FILE.write_text(str(proc.pid))
            self._log_append(f"[launcher] Started API (PID {proc.pid}) on port {full_env['PORT']}\n")
            self._url_var.set(f"http://localhost:{full_env['PORT']}")
        except Exception as e:
            messagebox.showerror("Start failed", str(e))

    def _stop_api(self):
        pid = get_pid(API_PID_FILE)
        if pid:
            try:
                os.kill(pid, signal.SIGTERM)
                time.sleep(0.5)
                try: os.kill(pid, signal.SIGKILL)
                except ProcessLookupError: pass
            except ProcessLookupError:
                pass
            API_PID_FILE.unlink(missing_ok=True)
            self._log_append(f"[launcher] Stopped API (PID {pid})\n")
        else:
            self._log_append("[launcher] API was not running\n")

    def _shell_bg(self, cmd, msg):
        self._log_append(f"[launcher] {msg}\n")
        def run():
            try:
                r = subprocess.run(cmd, capture_output=True, text=True)
                self._log_append(r.stdout + r.stderr)
            except Exception as e:
                self._log_append(f"  error: {e}\n")
        threading.Thread(target=run, daemon=True).start()

    def _run_setup(self):
        setup_sh = LAUNCHER_DIR / "setup.sh"
        if not setup_sh.exists():
            messagebox.showerror("Not found", f"{setup_sh} not found")
            return
        self._open_terminal_script(str(setup_sh))

    def _run_rebuild(self):
        rebuild_sh = LAUNCHER_DIR / "rebuild.sh"
        if not rebuild_sh.exists():
            messagebox.showerror("Not found", f"{rebuild_sh} not found")
            return
        self._open_terminal_script(str(rebuild_sh))

    def _open_terminal_script(self, script_path):
        """Open a terminal window to run a script interactively."""
        os.chmod(script_path, 0o755)
        terminals = [
            ["x-terminal-emulator", "-e", f"bash {script_path}; echo; echo 'Press Enter to close'; read"],
            ["xterm", "-e", f"bash {script_path}; echo; echo 'Press Enter to close'; read"],
            ["gnome-terminal", "--", "bash", "-c", f"{script_path}; echo; echo 'Press Enter to close'; read"],
            ["xfce4-terminal", "-e", f"bash {script_path}; echo; echo 'Press Enter to close'; read"],
            ["konsole", "-e", f"bash {script_path}; echo; echo 'Press Enter to close'; read"],
        ]
        for cmd in terminals:
            try:
                subprocess.Popen(cmd)
                return
            except FileNotFoundError:
                continue
        # Fallback: run in thread and stream to log
        self._log_append(f"[launcher] No GUI terminal found. Running {script_path} in background...\n")
        self._shell_bg(["bash", script_path], f"Running {Path(script_path).name}...")

    def _edit_env(self):
        if not ENV_FILE.exists():
            if messagebox.askyesno("Create .env?", f"{ENV_FILE} doesn't exist. Create from template?"):
                example = LAUNCHER_DIR / ".env.example"
                if example.exists():
                    ENV_FILE.write_text(example.read_text())
                else:
                    ENV_FILE.write_text("DATABASE_URL=\nSESSION_SECRET=\nPORT=3000\nSERVE_STATIC=1\nNODE_ENV=production\n")
        # Try to open in a text editor
        editors = ["xdg-open", "gedit", "kate", "mousepad", "xed", "nano"]
        for ed in editors:
            try:
                subprocess.Popen([ed, str(ENV_FILE)])
                return
            except FileNotFoundError:
                continue
        # Fallback: inline editor
        self._inline_edit_env()

    def _inline_edit_env(self):
        win = tk.Toplevel(self)
        win.title("Edit .env")
        win.geometry("500x350")
        text = scrolledtext.ScrolledText(win, font=("Courier", 10))
        text.pack(fill="both", expand=True, padx=6, pady=6)
        if ENV_FILE.exists():
            text.insert("1.0", ENV_FILE.read_text())
        def save():
            ENV_FILE.write_text(text.get("1.0", "end-1c"))
            win.destroy()
            messagebox.showinfo("Saved", "Restart the API server for changes to take effect.")
        tk.Button(win, text="Save", command=save).pack(pady=4)

    # ─ Log viewer ─────────────────────────────────────────────────────────────
    def _load_log(self):
        try:
            if API_LOG_FILE.exists():
                lines = API_LOG_FILE.read_text(errors="replace").splitlines()
                tail = "\n".join(lines[-200:]) + ("\n" if lines else "")
                self._log_text.config(state="normal")
                self._log_text.delete("1.0", "end")
                self._log_text.insert("end", tail)
                self._log_text.config(state="disabled")
                if self._autoscroll_var.get():
                    self._log_text.see("end")
        except Exception:
            pass

    def _log_append(self, msg):
        self._log_text.config(state="normal")
        self._log_text.insert("end", msg)
        self._log_text.config(state="disabled")
        if self._autoscroll_var.get():
            self._log_text.see("end")
        # also write to file
        try:
            with open(API_LOG_FILE, "a") as f:
                f.write(msg)
        except Exception:
            pass

    def _clear_log_file(self):
        if messagebox.askyesno("Clear log?", f"Clear {API_LOG_FILE}?"):
            try:
                API_LOG_FILE.write_text("")
                self._log_text.config(state="normal")
                self._log_text.delete("1.0", "end")
                self._log_text.config(state="disabled")
            except Exception as e:
                messagebox.showerror("Error", str(e))


if __name__ == "__main__":
    app = App()
    app.mainloop()
