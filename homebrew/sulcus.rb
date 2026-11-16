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
      sha256 "27961ee9221c3a5b995584745df1b6c5e4d762b5eed14169bc63b6ab2df8f1cf"
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v3.1.0/sulcus-3.1.0-macos-x64.tar.gz"
      sha256 "13e737c0a52d76c700607fedcf3a3333b2b03c5d7912245917e5cdae5d2db112"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/digitalforgeca/sulcus/releases/download/v3.1.0/sulcus-3.1.0-linux-arm64.tar.gz"
      sha256 "0c88749318e8ef05e33eedacd38c0f723aa8a78eb263372978abd7cb3ceb6877"
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v3.1.0/sulcus-3.1.0-linux-x64.tar.gz"
      sha256 "a9e5f49685c2d93b5f0f1b5d7143a5e8978268c1efec06783f024639e3841b09"
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
