# Homebrew formula for sulcus
# Canonical formula repository:
# https://github.com/digitalforgeca/homebrew-sulcus/blob/main/Formula/sulcus.rb
#
# Install: brew tap digitalforgeca/sulcus && brew install sulcus

class Sulcus < Formula
  desc "Thermodynamic memory sidecar and Semantic VMMU for AI agents"
  homepage "https://sulcus.ca"
  version "3.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/digitalforgeca/sulcus/releases/download/v3.1.0/sulcus-3.1.0-macos-arm64.tar.gz"
      sha256 "866f96d8c21412f02de0ec80709d7e22070acf58aa9580a8a0d325887f8aa0c0"
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v3.1.0/sulcus-3.1.0-macos-x64.tar.gz"
      sha256 "ad608477107c2b541a1841c87b88055912574cf097c110cb3ffc4eefc4641c2d"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/digitalforgeca/sulcus/releases/download/v3.1.0/sulcus-3.1.0-linux-arm64.tar.gz"
      sha256 "0fbbbc5b32c53cf232cf79b9e461e117842bac85bfb7e35b18d16da18fea21f0"
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v3.1.0/sulcus-3.1.0-linux-x64.tar.gz"
      sha256 "08d19a676346d47741b167af36213f869a64c5caf275fbbcad41ce4d50e1d820"
    end
  end

  def install
    bin.install "sulcus"
    lib.install Dir["libsulcus_vectors.*"] unless Dir["libsulcus_vectors.*"].empty?
  end

  def caveats
    <<~EOS
      Authenticate and wire zero-secret MCP across your IDEs and CLI agents:

        sulcus login && sulcus connect all

      Or run 100% offline with embedded storage on http://127.0.0.1:4203:

        sulcus serve
        sulcus mcp-proxy

      Documentation: https://sulcus.ca/docs
    EOS
  end

  test do
    assert_match "sulcus", shell_output("#{bin}/sulcus --version 2>&1", 0).strip
  end
end
