class BorealWork < Formula
  desc "Local runtime for evidence-backed work, project memory, and agent handoff"
  homepage "https://github.com/mattrichmo/boreal-work"
  version "0.1.0"
  license :cannot_represent

  url "https://github.com/mattrichmo/boreal-work/releases/download/v0.1.0/bwrk-upgrade.tar.gz"
  sha256 "52bb653dcc03c49ebc040968d58096d91408e401e53e51a07b69e4801ef4f9eb"

  depends_on "node"

  def install
    libexec.install buildpath/"apps/cli/dist"

    (bin/"bwrk").write <<~SH
      #!/bin/sh
      export BOREAL_INSTALL_CHANNEL=brew
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/dist/index.js" "$@"
    SH
  end

  test do
    assert_match "boreal-work #{version} (brew)", shell_output("#{bin}/bwrk --version")
    system bin/"bwrk", "help"
  end
end
