#!/bin/bash
# Installs the print-news web service (control panel + scheduler) as a macOS
# LaunchAgent so it starts at login and stays running. Re-run after moving the
# repo or to reinstall. Uninstall:
#   launchctl bootout gui/$(id -u)/com.printnews.web
#   rm ~/Library/LaunchAgents/com.printnews.web.plist
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(pwd)"
LABEL="com.printnews.web"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"

[ -x "$BUN" ] || { echo "error: bun not found — install it from https://bun.sh"; exit 1; }
[ -f .env ] || { echo "error: no .env file — copy .env.example and add your OpenAI API key"; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" out/logs

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN</string>
    <string>run</string>
    <string>src/web/server.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$REPO/out/logs/web.log</string>
  <key>StandardErrorPath</key>
  <string>$REPO/out/logs/web.err.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✓ $LABEL installed and running"
echo "  control panel: http://localhost:4711  (LAN: http://$(scutil --get LocalHostName 2>/dev/null || hostname).local:4711)"
