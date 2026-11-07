#!/bin/bash
# Builds dist/gnome-codex-usage_<version>_all.deb
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:-1.0.0}"
MAINTAINER="${MAINTAINER:-Codex Usage contributors <noreply@users.noreply.github.com>}"
BUILD=build
rm -rf "$BUILD" && mkdir -p "$BUILD" dist
P="$BUILD/gnome-codex-usage"
install -Dm755 codex_usage.py "$P/usr/bin/codex-usage"
mkdir -p "$P/usr/share/gnome-shell/extensions"
cp -r codex-usage@local "$P/usr/share/gnome-shell/extensions/"
mkdir -p "$P/DEBIAN"
cat > "$P/DEBIAN/control" <<EOF
Package: gnome-codex-usage
Version: $VERSION
Architecture: all
Maintainer: $MAINTAINER
Depends: python3, gnome-shell (>= 45)
Section: gnome
Priority: optional
Description: Codex plan usage (5-hour and weekly) in the GNOME top bar
 Shows the percentage used of Codex's 5-hour and weekly limits, with colors
 and notifications from 80% and 90%. Reads the limits Codex records in its
 local session logs (~/.codex/sessions): no login or network needed.
EOF
cat > "$P/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
echo "Enable with: gnome-extensions enable codex-usage@local  (then restart GNOME Shell)"
EOF
chmod 755 "$P/DEBIAN/postinst"

# Standard package permissions: 755 dirs/executables, 644 other files
chmod -R u=rwX,go=rX "$BUILD"

dpkg-deb --root-owner-group --build "$BUILD/gnome-codex-usage" "dist/gnome-codex-usage_${VERSION}_all.deb"
rm -rf "$BUILD"
