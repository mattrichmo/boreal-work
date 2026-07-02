export const INSTALL_CHANNELS = ["source", "npm", "brew"] as const;

export type InstallChannel = (typeof INSTALL_CHANNELS)[number];

declare const BOREAL_BUILD_INSTALL_CHANNEL: string | undefined;

export interface InstallUpgradeStatus {
  readonly channel: InstallChannel;
  readonly command: string;
  readonly guidance: string;
}

export interface InstallChannelDetectionOptions {
  readonly argv1?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export function detectInstallChannel(options: InstallChannelDetectionOptions = {}): InstallChannel {
  const env = options.env ?? process.env;
  const envChannel = normalizeInstallChannel(env.BOREAL_INSTALL_CHANNEL);
  if (envChannel) {
    return envChannel;
  }

  const buildChannel = buildInstallChannel();
  if (buildChannel) {
    return buildChannel;
  }

  const executable = options.argv1 ?? process.argv[1] ?? "";
  const normalizedExecutable = executable.replaceAll("\\", "/").toLowerCase();
  if (normalizedExecutable.includes("/homebrew/") || normalizedExecutable.includes("/cellar/")) {
    return "brew";
  }
  return "source";
}

export function installUpgradeStatus(channel: InstallChannel): InstallUpgradeStatus {
  switch (channel) {
    case "brew":
      return {
        channel,
        command: "brew upgrade boreal-work",
        guidance: "Upgrade with Homebrew so the formula and linked binary stay in sync."
      };
    case "npm":
      return {
        channel,
        command: "npm install -g @boreal/cli@latest",
        guidance: "Upgrade the global npm package that provides the bwrk binary."
      };
    case "source":
      return {
        channel,
        command: "git pull && pnpm install && pnpm install:local",
        guidance: "Update the source checkout, refresh dependencies, then reinstall the local source shim."
      };
  }
}

export function normalizeInstallChannel(value: string | undefined): InstallChannel | undefined {
  if (value === "source" || value === "npm" || value === "brew") {
    return value;
  }
  return undefined;
}

function buildInstallChannel(): InstallChannel | undefined {
  return typeof BOREAL_BUILD_INSTALL_CHANNEL === "string"
    ? normalizeInstallChannel(BOREAL_BUILD_INSTALL_CHANNEL)
    : undefined;
}
