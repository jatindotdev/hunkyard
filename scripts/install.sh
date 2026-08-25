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
# Empty means the latest release. Pinning a tag here instead would be worse than
# it looks: raw.githubusercontent.com serves this script with a five minute
# cache, so a copy naming a specific release outlives that release being
# replaced, and installs break for reasons nobody can see. `latest` is resolved
# by GitHub at download time, so a stale copy of this script still works.
TAG="${HUNK_VERSION:-}"
INSTALL_DIR="${HUNK_INSTALL_DIR:-$HOME/.local/bin}"
MAN_DIR="${HUNK_MAN_DIR:-$HOME/.local/share/man/man1}"

# Colour, and nothing when this is not a terminal. Matching what the CLI does:
# the URL, the path and the outcome are what you came to read, and the prose
# around them is not. NO_COLOR is the standard opt-out, and a piped install --
# which is how most of these run, through `curl | sh` -- gets plain text.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m')
  CYAN=$(printf '\033[36m'); GREEN=$(printf '\033[32m')
  YELLOW=$(printf '\033[33m'); RED=$(printf '\033[31m')
  OFF=$(printf '\033[0m')
else
  BOLD=''; DIM=''; CYAN=''; GREEN=''; YELLOW=''; RED=''; OFF=''
fi

fail() {
  echo "${RED}install:${OFF} $1" >&2
  exit 1
}

# One shape for every outcome line, the same as the CLI's.
done_line() {
  printf '  %s✓%s %-12s %s\n' "$GREEN" "$OFF" "$1" "$2"
}

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) fail "unsupported operating system: $(uname -s). hunkyard runs on macOS and Linux." ;;
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
if [ -n "$TAG" ]; then
  base="https://github.com/${REPO}/releases/download/${TAG}"
  release="$TAG"
else
  base="https://github.com/${REPO}/releases/latest/download"
  release="the latest release"
fi

command -v curl >/dev/null 2>&1 || fail "curl is required"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Plain curl is the path; gh is a fallback for a release whose assets curl cannot
# reach, and its own message is kept, because "download failed" on its own is
# never enough to act on.
#
# `progress` is set for the binary and empty for the small files. Without it a
# 75MB download prints nothing at all, which reads as a hang. The timeouts matter
# for the same reason in reverse: a stalled transfer should fail with a message
# rather than wait forever.
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
    # shellcheck disable=SC2086
    gh release download $TAG --repo "$REPO" --pattern "$name" \
      --output "$out" --clobber 2>&1
  ) && return 0
  return 1
}

# The binaries are large, 75MB and up, because each embeds the Bun runtime and
# the whole client, and GitHub does not compress release assets in transit. The
# progress bar is the difference between waiting and wondering; the size it
# reports is the real one, which is why none is stated here.
echo "Downloading ${BOLD}${asset}${OFF} ${DIM}from ${release}${OFF}"
download "$asset" "${tmp}/hunk" show-progress || fail "could not download ${asset}.
  ${gh_error:-no error reported}

Check that ${release} has an asset for your platform, or download it by hand
from https://github.com/${REPO}/releases"

if download SHA256SUMS "${tmp}/SHA256SUMS"; then
  expected="$(grep " ${asset}\$" "${tmp}/SHA256SUMS" | awk '{print $1}')"
  if [ -n "$expected" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      actual="$(sha256sum "${tmp}/hunk" | awk '{print $1}')"
    else
      actual="$(shasum -a 256 "${tmp}/hunk" | awk '{print $1}')"
    fi
    [ "$actual" = "$expected" ] || fail "checksum mismatch for ${asset}"
    checksum_verified=yes
  fi
fi

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
  man_installed=yes
fi

echo
done_line "hunk" "${BOLD}${CYAN}${INSTALL_DIR}/hunk${OFF}"
if [ "${checksum_verified:-no}" = yes ]; then
  done_line "checksum" "${DIM}matches the release${OFF}"
fi
if [ "${man_installed:-no}" = yes ]; then
  done_line "git hunk" "${DIM}man page in ${MAN_DIR}${OFF}"
fi

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) on_path=yes ;;
  *) on_path=no ;;
esac

if [ "$on_path" = no ]; then
  echo
  echo "${YELLOW}${INSTALL_DIR} is not on your PATH.${OFF} Add this to your shell profile:"
  echo "  ${CYAN}export PATH=\"${INSTALL_DIR}:\$PATH\"${OFF}"
  exit 0
fi

# An unrelated tool of the same name exists, so an existing hunk on PATH may well
# win and leave this install silently shadowed. Better to name it than to let
# `hunk` run something else.
found="$(command -v hunk 2>/dev/null || true)"
if [ -n "$found" ] && [ "$found" != "${INSTALL_DIR}/hunk" ]; then
  echo
  echo "${YELLOW}Another hunk is earlier on your PATH and will win:${OFF}"
  echo "  ${DIM}${found}${OFF}"
  echo
  echo "${DIM}Run this one as ${INSTALL_DIR}/hunk, put ${INSTALL_DIR} first on PATH,${OFF}"
  echo "${DIM}or remove the other one.${OFF}"
else
  echo
  echo "  ${DIM}hunk${OFF}                  ${DIM}review what you have not committed${OFF}"
  echo "  ${DIM}hunk service install${OFF}  ${DIM}register ${OFF}${CYAN}http://hunkyard.localhost${OFF}${DIM}, once${OFF}"
fi
