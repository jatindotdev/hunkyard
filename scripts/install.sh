#!/bin/sh
# Installs hunk. Detects the platform, downloads that binary from the latest
# GitHub release, verifies it against the release checksums, and links git-hunk
# next to it so `git hunk` works too.
#
#   curl -fsSL https://raw.githubusercontent.com/jatindotdev/hunkyard/main/scripts/install.sh | sh
#
# Set HUNK_INSTALL_DIR to install somewhere other than ~/.local/bin.
set -eu

REPO="jatindotdev/hunkyard"
INSTALL_DIR="${HUNK_INSTALL_DIR:-$HOME/.local/bin}"

fail() {
  echo "install: $1" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) fail "unsupported operating system: $(uname -s). Windows needs the .exe from the releases page." ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64) arch="x64" ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

# musl and glibc are different libcs, not variants of one build, so Alpine and
# friends need their own binary. ldd naming it is the reliable tell.
suffix=""
if [ "$os" = "linux" ] && (ldd --version 2>&1 | grep -qi musl); then
  suffix="-musl"
fi

asset="hunk-${os}-${arch}${suffix}"
base="https://github.com/${REPO}/releases/latest/download"

command -v curl >/dev/null 2>&1 || fail "curl is required"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${asset}..."
curl -fsSL "${base}/${asset}" -o "${tmp}/hunk" ||
  fail "could not download ${base}/${asset}"

if curl -fsSL "${base}/SHA256SUMS" -o "${tmp}/SHA256SUMS" 2>/dev/null; then
  expected="$(grep " ${asset}\$" "${tmp}/SHA256SUMS" | awk '{print $1}')"
  if [ -n "$expected" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      actual="$(sha256sum "${tmp}/hunk" | awk '{print $1}')"
    else
      actual="$(shasum -a 256 "${tmp}/hunk" | awk '{print $1}')"
    fi
    [ "$actual" = "$expected" ] || fail "checksum mismatch for ${asset}"
    echo "Checksum verified."
  fi
fi

mkdir -p "$INSTALL_DIR"
chmod +x "${tmp}/hunk"
mv "${tmp}/hunk" "${INSTALL_DIR}/hunk"
# Git runs any git-<name> on PATH as `git <name>`, and does not care that it is
# a link, so one binary serves both names.
ln -sf "${INSTALL_DIR}/hunk" "${INSTALL_DIR}/git-hunk"

echo "Installed hunk to ${INSTALL_DIR}/hunk"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) echo "Run it with: hunk" ;;
  *)
    echo
    echo "${INSTALL_DIR} is not on your PATH. Add this to your shell profile:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac
