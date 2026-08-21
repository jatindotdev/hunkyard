# Homebrew formula for hunk. Lives here for reference; the tap that serves it is
# jatindotdev/homebrew-tap, where this file is copied to Formula/hunk.rb.
#
# The binaries are prebuilt and self-contained (each embeds the Bun runtime and
# the whole client), so there is nothing to compile and no dependency to declare.
class Hunk < Formula
  desc "Code review for a pull request, a local branch, or uncommitted work"
  homepage "https://github.com/jatindotdev/hunkyard"
  version "0.0.0"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/jatindotdev/hunkyard/releases/download/v#{version}/hunk-darwin-arm64"
      sha256 "REPLACE_WITH_SHA256SUMS_ENTRY"
    end
    on_intel do
      url "https://github.com/jatindotdev/hunkyard/releases/download/v#{version}/hunk-darwin-x64"
      sha256 "REPLACE_WITH_SHA256SUMS_ENTRY"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/jatindotdev/hunkyard/releases/download/v#{version}/hunk-linux-arm64"
      sha256 "REPLACE_WITH_SHA256SUMS_ENTRY"
    end
    on_intel do
      url "https://github.com/jatindotdev/hunkyard/releases/download/v#{version}/hunk-linux-x64"
      sha256 "REPLACE_WITH_SHA256SUMS_ENTRY"
    end
  end

  def install
    bin.install Dir["hunk-*"].first => "hunk"
    # Git runs any git-<name> on PATH as `git <name>`, so one binary serves both.
    bin.install_symlink bin/"hunk" => "git-hunk"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/hunk --version")
    assert_match "review code changes", shell_output("#{bin}/hunk --help")
  end
end
