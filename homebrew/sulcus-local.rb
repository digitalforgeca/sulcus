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
      sha256 "7d15a4bc158bcd104bd20c6d6303771a63be536d0cf7279579858acb9bb01ccb"
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-darwin-x86_64.tar.gz"
      sha256 "5332381689b53105e14451aa41476da6e701e85139342fad5b2662de6f6f6a61"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-linux-aarch64.tar.gz"
      # sha256 pending — aarch64-linux cross-compile in progress
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-linux-x86_64.tar.gz"
      sha256 "3fa0f52b37799c8083fc23b9a35dda1e08d1546634313ce661f92258bc815221"
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
