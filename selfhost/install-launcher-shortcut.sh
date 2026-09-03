#!/usr/bin/env bash
# Creates a desktop shortcut so the launcher appears in your applications menu
# and on the desktop. Run once after setup.sh.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER="$REPO_DIR/selfhost/launcher.py"
DESKTOP_FILE="$HOME/.local/share/applications/portfolio98-launcher.desktop"
DESKTOP_SHORTCUT="$HOME/Desktop/portfolio98-launcher.desktop"

# Ensure python3-tk is installed
if ! python3 -c "import tkinter" 2>/dev/null; then
  echo "Installing python3-tk..."
  sudo apt-get install -y python3-tk
fi

chmod +x "$LAUNCHER"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Portfolio98 Launcher
Comment=Start and manage your Portfolio98 website
Exec=python3 $LAUNCHER
Icon=applications-internet
Terminal=false
Categories=Network;WebBrowser;
EOF

chmod +x "$DESKTOP_FILE"
cp "$DESKTOP_FILE" "$DESKTOP_SHORTCUT" 2>/dev/null && chmod +x "$DESKTOP_SHORTCUT" || true

echo "✓ Launcher shortcut created:"
echo "  Applications menu: Portfolio98 Launcher"
echo "  Desktop: $DESKTOP_SHORTCUT"
echo ""
echo "You can also run it directly: python3 $LAUNCHER"
