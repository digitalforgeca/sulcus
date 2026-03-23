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
      sha256 "f36061a70d430035e224e43271678d5fc75476fdb585c331ed40ca64826aac1c"
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-darwin-x86_64.tar.gz"
      sha256 "7d84b3ddef5f307bcebf31dc2b0797108c67a8f3f35e50665045979eafc8d7bb"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-linux-aarch64.tar.gz"
      # sha256 pending — aarch64-linux cross-compile in progress
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v#{version}/sulcus-local-linux-x86_64.tar.gz"
      sha256 "96563dc19481d024df93be6529a9463e5dcd5a6db06dd5615477ee9a534d94c7"
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
