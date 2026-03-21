# Homebrew formula for sulcus-local
# This is the source copy — the canonical formula lives at:
# https://github.com/digitalforgeca/homebrew-sulcus/blob/main/Formula/sulcus-local.rb
#
# Install: brew tap digitalforgeca/sulcus && brew install sulcus-local

class SulcusLocal < Formula
  desc "Thermodynamic memory sidecar for AI agents — MCP server with heat-based decay"
  homepage "https://sulcus.ca"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-darwin-arm64.tar.gz"
      # sha256 will be filled by CI after first successful release build
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-darwin-x86_64.tar.gz"
      # sha256 will be filled by CI after first successful release build
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-linux-aarch64.tar.gz"
      # sha256 will be filled by CI after first successful release build
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-linux-x86_64.tar.gz"
      # sha256 will be filled by CI after first successful release build
    end
  end

  def install
    bin.install "sulcus-local"
  end

  def caveats
    <<~EOS
      To use with Claude Code, add to your MCP config:

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
    assert_match version.to_s, shell_output("#{bin}/sulcus-local --version 2>&1", 0).strip
  end
end
