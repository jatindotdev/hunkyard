#!/bin/sh
# Installs hunk. Detects the platform, downloads that binary from the latest
# GitHub release, verifies it against the release checksums, and links git-hunk
# next to it so `git hunk` works too.
#
#   curl -fsSL https://raw.githubusercontent.com/jatindotdev/hunkyard/main/scripts/install.sh | sh
#
# Set HUNK_INSTALL_DIR to install somewhere other than ~/.local/bin, and
# HUNK_MAN_DIR for the man page. HUNK_VERSION pins an older release.
set -eu

REPO="jatindotdev/hunkyard"
# Which release to install. Override to pin an older one.
TAG="${HUNK_VERSION:-v0.1.1}"
INSTALL_DIR="${HUNK_INSTALL_DIR:-$HOME/.local/bin}"
MAN_DIR="${HUNK_MAN_DIR:-$HOME/.local/share/man/man1}"

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
base="https://github.com/${REPO}/releases/download/${TAG}"

command -v curl >/dev/null 2>&1 || fail "curl is required"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Plain curl is the path; gh is a fallback for a release whose assets curl cannot
# reach, and its own message is kept, because "download failed" on its own is
# never enough to act on.
#
# `progress` is set for the binary and empty for the small files. Without it a
# 28MB download prints nothing for half a minute, which reads as a hang. The
# timeouts matter for the same reason in reverse: a stalled transfer should fail
# with a message rather than wait forever.
download() {
  name="$1"
  out="$2"
  # Third argument, any value, asks for the progress bar.
  if [ -n "${3:-}" ]; then
    noise="--progress-bar"
  else
    noise="-s"
  fi
  if curl -fL "$noise" \
    --connect-timeout 20 --retry 2 --retry-delay 1 \
    --speed-limit 1024 --speed-time 60 \
    "${base}/${name}" -o "$out"; then
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    gh_error="gh is not installed"
    return 1
  fi
  # An explicit tag rather than the default "latest": a draft release is not
  # latest, so omitting it fails on a release that is still being assembled.
  gh_error=$(
    gh release download "$TAG" --repo "$REPO" --pattern "$name" \
      --output "$out" --clobber 2>&1
  ) && return 0
  return 1
}

echo "Downloading ${asset}.gz (about 28MB)..."
download "${asset}.gz" "${tmp}/hunk.gz" show-progress || fail "could not download ${asset}.gz.
  ${gh_error:-no error reported}

Check that ${TAG} has an asset for your platform, or download it by hand from
https://github.com/${REPO}/releases/tag/${TAG}"

if download SHA256SUMS "${tmp}/SHA256SUMS"; then
  # The checksum covers what was downloaded, so it is checked before unpacking.
  expected="$(grep " ${asset}.gz\$" "${tmp}/SHA256SUMS" | awk '{print $1}')"
  if [ -n "$expected" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      actual="$(sha256sum "${tmp}/hunk.gz" | awk '{print $1}')"
    else
      actual="$(shasum -a 256 "${tmp}/hunk.gz" | awk '{print $1}')"
    fi
    [ "$actual" = "$expected" ] || fail "checksum mismatch for ${asset}.gz"
    echo "Checksum verified."
  fi
fi

gzip -d "${tmp}/hunk.gz" || fail "could not unpack ${asset}.gz"

mkdir -p "$INSTALL_DIR"
chmod +x "${tmp}/hunk"
mv "${tmp}/hunk" "${INSTALL_DIR}/hunk"
# Git runs any git-<name> on PATH as `git <name>`, and does not care that it is
# a link, so one binary serves both names.
ln -sf "${INSTALL_DIR}/hunk" "${INSTALL_DIR}/git-hunk"

# `git hunk --help` is resolved by git as `git help hunk`, which looks for a man
# page and never runs the binary. Installing one is what makes that form work.
if download git-hunk.1 "${tmp}/git-hunk.1"; then
  mkdir -p "$MAN_DIR"
  mv "${tmp}/git-hunk.1" "${MAN_DIR}/git-hunk.1"
  echo "Installed the man page to ${MAN_DIR}/git-hunk.1"
fi

echo "Installed hunk to ${INSTALL_DIR}/hunk"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) on_path=yes ;;
  *) on_path=no ;;
esac

if [ "$on_path" = no ]; then
  echo
  echo "${INSTALL_DIR} is not on your PATH. Add this to your shell profile:"
  echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
  exit 0
fi

# An unrelated tool of the same name exists, so an existing hunk on PATH may well
# win and leave this install silently shadowed. Better to name it than to let
# `hunk` run something else.
found="$(command -v hunk 2>/dev/null || true)"
if [ -n "$found" ] && [ "$found" != "${INSTALL_DIR}/hunk" ]; then
  echo
  echo "Another hunk is earlier on your PATH and will win:"
  echo "  $found"
  echo
  echo "Run this one as ${INSTALL_DIR}/hunk, put ${INSTALL_DIR} first on PATH,"
  echo "or remove the other one."
else
  echo "Run it with: hunk"
fi
