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
      url "https://github.com/digitalforgeca/sulcus/releases/download/bin-v7.3.1/sulcus-macos-arm64.tar.gz"
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/v2.25.3/sulcus-x86_64-apple-darwin.tar.gz"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/digitalforgeca/sulcus/releases/download/bin-v7.3.1/sulcus-linux-arm64.tar.gz"
    else
      url "https://github.com/digitalforgeca/sulcus/releases/download/bin-v7.3.1/sulcus-linux-x64.tar.gz"
    end
  end

  def install
    bin.install "sulcus"
    lib.install Dir["libsulcus_vectors.*"] unless Dir["libsulcus_vectors.*"].empty?
  end

  def caveats
    <<~EOS
      Authenticate and wire zero-secret MCP across your IDEs and CLI agents:

        sulcus login && sulcus connect

      Or run 100% offline with embedded storage:

        sulcus serve
        sulcus stdio

      Documentation: https://sulcus.ca/docs
    EOS
  end

  test do
    assert_match "sulcus", shell_output("#{bin}/sulcus --version 2>&1", 0).strip
  end
end
