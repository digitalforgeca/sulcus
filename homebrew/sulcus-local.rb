# Homebrew formula for sulcus-local
# Install: brew tap digitalforgeca/sulcus && brew install sulcus-local
#
# This formula downloads the prebuilt binary from GitHub Releases.
# To build from source instead: brew install --build-from-source sulcus-local

class SulcusLocal < Formula
  desc "Thermodynamic memory sidecar for AI agents — MCP server with heat-based decay"
  homepage "https://sulcus.ca"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-darwin-arm64.tar.gz"
      # sha256 "PLACEHOLDER" # Update after building release binaries
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-darwin-x86_64.tar.gz"
      # sha256 "PLACEHOLDER" # Update after building release binaries
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-linux-aarch64.tar.gz"
      # sha256 "PLACEHOLDER" # Update after building release binaries
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-linux-x86_64.tar.gz"
      # sha256 "PLACEHOLDER" # Update after building release binaries
    end
  end

  def install
    bin.install "sulcus-local"
  end

  def caveats
    <<~EOS
      To use with Claude Code, add to ~/.claude/claude_desktop_config.json:

        {
          "mcpServers": {
            "sulcus": {
              "command": "#{bin}/sulcus-local",
              "args": ["stdio"]
            }
          }
        }

      For cloud sync, create ~/.sulcus/sulcus.ini with your API key.
      Subscribe at https://sulcus.ca
    EOS
  end

  test do
    assert_match "Available commands", shell_output("#{bin}/sulcus-local 2>&1", 1)
  end
end
