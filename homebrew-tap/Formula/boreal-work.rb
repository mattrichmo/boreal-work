class BorealWork < Formula
  desc "Local runtime for evidence-backed work, project memory, and agent handoff"
  homepage "https://github.com/mattrichmo/boreal-work"
  version "0.1.0"
  license :cannot_represent

  url "https://registry.npmjs.org/@boreal/cli/-/cli-0.1.0.tgz"
  sha256 "da0e4e2a3bd272f3402f2a3b3db660929c7d6ef4eb1e5802b42336b5c84dc8b6"

  depends_on "node"

  def install
    package_root = buildpath/"package"
    source_root = package_root.exist? ? package_root : buildpath

    libexec.install source_root/"package.json"
    libexec.install source_root/"README.md" if (source_root/"README.md").exist?
    libexec.install source_root/"dist"

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
