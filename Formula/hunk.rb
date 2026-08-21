# Homebrew formula for hunk. This repository is the tap, so there is no second
# one to keep in step: a release bumps the version and the checksums here.
#
#   brew tap jatindotdev/hunkyard https://github.com/jatindotdev/hunkyard
#   brew install hunk
#
# The two-argument form of `brew tap` takes an explicit URL and so does not
# require the homebrew- repository prefix. Homebrew looks for formulae in
# Formula/, HomebrewFormula/ or the repository root (Homebrew's tap.rb,
# potential_formula_dirs), which is why this sits in Formula/.
#
# The binaries are prebuilt and self-contained (each embeds the Bun runtime and
# the whole client), so there is nothing to compile and no dependency to declare.
class Hunk < Formula
  desc "Code review for a pull request, a local branch, or uncommitted work"
  homepage "https://github.com/jatindotdev/hunkyard"
  version "0.1.0"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/jatindotdev/hunkyard/releases/download/v#{version}/hunk-darwin-arm64"
      sha256 "7979864951ff2026d7607d18aa9b714a58cc2160bf9cc3d691ff5a799d2de654"
    end
    on_intel do
      url "https://github.com/jatindotdev/hunkyard/releases/download/v#{version}/hunk-darwin-x64"
      sha256 "cb411614bc61d097d48c92230698fd8b6ea6375ee63bffb1cf2eaf27a5ca29cc"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/jatindotdev/hunkyard/releases/download/v#{version}/hunk-linux-arm64"
      sha256 "512d5035efc2ed1bf483117012aeb85ce9c5d73d5a5be0a7f732c90c35dc4d09"
    end
    on_intel do
      url "https://github.com/jatindotdev/hunkyard/releases/download/v#{version}/hunk-linux-x64"
      sha256 "24b77fd14ae2afaf06636bc68d70296ec0945f40c7aeab641b39959521e52f55"
    end
  end

  resource "man" do
    url "https://github.com/jatindotdev/hunkyard/releases/download/v#{version}/git-hunk.1"
    sha256 "79778fd2b0a9247e175733cd1dfdcb21be36acf315e68679d965c2240ade7602"
  end

  def install
    bin.install Dir["hunk-*"].first => "hunk"
    # Git runs any git-<name> on PATH as `git <name>`, so one binary serves both.
    bin.install_symlink bin/"hunk" => "git-hunk"
    # `git hunk --help` is resolved by git as `git help hunk`, which looks for a
    # man page rather than running the binary.
    resource("man").stage { man1.install "git-hunk.1" }
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/hunk --version")
    assert_match "review code changes", shell_output("#{bin}/hunk --help")
  end
end
