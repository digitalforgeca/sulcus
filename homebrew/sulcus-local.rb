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
      sha256 "5b3b2559567c61f49ebce5174cdb223c4b80e2037595a8b89f40ee56f85760a0"
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-darwin-x86_64.tar.gz"
      sha256 "d5619ba4f77b535225ee46cee71718fcd080843825e8db7e0b27e892d8e69490"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-linux-aarch64.tar.gz"
      # sha256 pending — aarch64-linux cross-compile in progress
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-linux-x86_64.tar.gz"
      sha256 "49f87d9888bf32c4c65b196f3cc8c2fb638fd1a2df006d11160f1cb72e527a90"
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
