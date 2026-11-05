#!/usr/bin/env bash
# Disposable CI container only. Package installation is never run on user PCs.
set -euo pipefail
test "${CI:-}" = true
export DEBIAN_FRONTEND=noninteractive PATH="/opt/node/bin:$PATH"
if command -v apt-get >/dev/null; then
  apt-get update
  # Package names changed with the time64 transition.
  alsa=libasound2; apt-cache show libasound2t64 >/dev/null 2>&1 && alsa=libasound2t64
  gtk=libgtk-3-0; apt-cache show libgtk-3-0t64 >/dev/null 2>&1 && gtk=libgtk-3-0t64
  atk=libatk-bridge2.0-0; apt-cache show libatk-bridge2.0-0t64 >/dev/null 2>&1 && atk=libatk-bridge2.0-0t64
  apt-get install -y xvfb xauth "$gtk" libnss3 "$alsa" libgbm1 libglib2.0-bin dbus-x11 libxss1 "$atk"
elif command -v dnf >/dev/null; then
  dnf install -y xorg-x11-server-Xvfb xorg-x11-xauth gtk3 nss alsa-lib mesa-libgbm glib2 dbus-x11 tar gzip shadow-utils
elif command -v pacman >/dev/null; then
  pacman -Syu --noconfirm xorg-server-xvfb xorg-xauth gtk3 nss alsa-lib mesa glib2 dbus tar gzip shadow
elif command -v zypper >/dev/null; then
  zypper --non-interactive refresh
  zypper --non-interactive install xorg-x11-server-Xvfb xauth gtk3 libnss3 libasound2 libgbm1 glib2-tools dbus-1-x11 tar gzip shadow
else
  echo 'Unsupported CI package manager' >&2; exit 1
fi
mkdir -p dist/linux-unpacked
tar -xzf dist/*linux.tar.gz --strip-components=1 -C dist/linux-unpacked
test -x dist/linux-unpacked/mollystudio
ldd dist/linux-unpacked/mollystudio > dist/linux-libraries.txt
if grep -q 'not found' dist/linux-libraries.txt; then cat dist/linux-libraries.txt; exit 1; fi
chown root:root dist/linux-unpacked/chrome-sandbox
chmod 4755 dist/linux-unpacked/chrome-sandbox
test "${HOST_UID}" -ne 0
getent group "$HOST_GID" >/dev/null || groupadd -g "$HOST_GID" mollyqa
useradd -m -o -u "$HOST_UID" -g "$HOST_GID" mollyqa
runuser -u mollyqa -- xvfb-run -a node scripts/packaged-platform-smoke.cjs
