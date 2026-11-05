#!/usr/bin/env bash
set -euo pipefail
test "${CI:-}" = true
test "${HOST_UID:-0}" -ne 0
export PATH="/opt/node/bin:$PATH"
dnf -y --setopt=install_weak_deps=False install xorg-x11-server-Xvfb xorg-x11-xauth gtk3 nss alsa-lib mesa-libgbm glib2 dbus-x11 shadow-utils
dnf -y --setopt=install_weak_deps=False install /work/dist/*linux.rpm
exe=$(command -v mollystudio)
runtime=$(dirname "$(readlink -f "$exe")")
test -f "$runtime/resources/app.asar"
chown root:root "$runtime/chrome-sandbox"
chmod 4755 "$runtime/chrome-sandbox"
getent group "$HOST_GID" >/dev/null || groupadd -g "$HOST_GID" mollyqa
useradd -m -o -u "$HOST_UID" -g "$HOST_GID" mollyqa
runuser -u mollyqa -- xvfb-run -a node scripts/packaged-platform-smoke.cjs "$exe" rpm
