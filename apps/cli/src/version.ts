import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOREAL_SCHEMA_VERSION,
  PROJECT_REGISTRY_SCHEMA_VERSION,
  PROJECT_SCHEMA_CONTRACTS,
  PUBLISHED_SCHEMA_CONTRACTS,
  RUNTIME_SCHEMA_CONTRACTS
} from "@boreal/core";
import { DAEMON_STATUS_SCHEMA_VERSION, DAEMON_WATCH_SCHEMA_VERSION } from "@boreal/daemon";
import { SEARCH_INDEX_SCHEMA_VERSION } from "@boreal/search";
import { FILE_STORE_SCHEMA_VERSION } from "@boreal/storage";

import { EXPORT_SCHEMA_VERSION, LEDGER_DELETION_SCHEMA_VERSION, LEDGER_SCHEMA_VERSION } from "./import-export.js";
import { detectInstallChannel, type InstallChannel } from "./install-channel.js";
import { PROJECT_SETUP_SCHEMA_VERSION } from "./project-setup.js";
import { VAULT_SCHEMA_VERSION } from "./vault.js";
import {
  BWRK_DELEGATED_BIN_ENV,
  BWRK_LAUNCHER_CHANNEL_ENV,
  BWRK_LAUNCHER_EXECUTABLE_ENV,
  BWRK_LAUNCHER_NAME_ENV,
  BWRK_LAUNCHER_VERSION_ENV
} from "./delegation-env.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

declare const BOREAL_BUILD_PACKAGE_NAME: string | undefined;
declare const BOREAL_BUILD_PACKAGE_VERSION: string | undefined;
declare const BOREAL_BUILD_PACKAGE_MANAGER: string | undefined;
declare const BOREAL_BUILD_CLI_PACKAGE_NAME: string | undefined;
declare const BOREAL_BUILD_CLI_PACKAGE_VERSION: string | undefined;

export const VERSION_INFO_SCHEMA_VERSION = "boreal.cli.version.v1";
export const RUNTIME_MIGRATION_POLICY_VERSION = "boreal.runtime-migration-policy.v1";
export const SQLITE_CACHE_SCHEMA_VERSION = "boreal.sqlite-cache.retired";

export interface VersionInfo {
  readonly schemaVersion: typeof VERSION_INFO_SCHEMA_VERSION;
  readonly name: string;
  readonly version: string;
  readonly packageManager?: string;
  readonly installChannel: InstallChannel;
  readonly node: string;
  readonly cli: {
    readonly packageName: string;
    readonly packageVersion: string;
  };
  readonly runtime: {
    readonly recordSchemaVersion: typeof BOREAL_SCHEMA_VERSION;
    readonly fileStoreSchemaVersion: typeof FILE_STORE_SCHEMA_VERSION;
  };
  readonly schemas: {
    readonly runtimeRecord: typeof BOREAL_SCHEMA_VERSION;
    readonly fileStore: typeof FILE_STORE_SCHEMA_VERSION;
    readonly export: typeof EXPORT_SCHEMA_VERSION;
    readonly ledgerManifest: typeof LEDGER_SCHEMA_VERSION;
    readonly ledgerDeletion: typeof LEDGER_DELETION_SCHEMA_VERSION;
    readonly searchIndex: typeof SEARCH_INDEX_SCHEMA_VERSION;
    readonly sqliteCache: typeof SQLITE_CACHE_SCHEMA_VERSION;
    readonly projectSetup: typeof PROJECT_SETUP_SCHEMA_VERSION;
    readonly projectRegistry: typeof PROJECT_REGISTRY_SCHEMA_VERSION;
    readonly vault: typeof VAULT_SCHEMA_VERSION;
    readonly daemonStatus: typeof DAEMON_STATUS_SCHEMA_VERSION;
    readonly daemonWatch: typeof DAEMON_WATCH_SCHEMA_VERSION;
  };
  readonly publishedSchemas: {
    readonly runtimeCount: number;
    readonly projectCount: number;
    readonly totalCount: number;
    readonly ids: readonly string[];
  };
  readonly migrationPolicy: {
    readonly version: typeof RUNTIME_MIGRATION_POLICY_VERSION;
    readonly currentRuntimeSchemaVersion: typeof BOREAL_SCHEMA_VERSION;
    readonly snapshotSchemaVersion: typeof EXPORT_SCHEMA_VERSION;
    readonly rules: readonly string[];
  };
  readonly compatibility: {
    readonly semver: {
      readonly releaseLine: "0.x";
      readonly patch: "backward-compatible";
      readonly minor: "may-change-contracts-with-migration-notes";
      readonly major: "reserved-for-stable-contract-breaks";
    };
    readonly launcher: {
      readonly patchSkew: "supported";
      readonly majorOrMinorSkew: "doctor-warning-and-repo-pin-delegation";
      readonly repoPinPrecedence: true;
    };
    readonly runtime: {
      readonly recordSchema: typeof BOREAL_SCHEMA_VERSION;
      readonly mode: "read-write";
    };
    readonly storage: readonly {
      readonly kind: "objects-v1" | "file-v2" | "file-v1";
      readonly mode: "default-read-write" | "legacy-read-write" | "import-only";
    }[];
    readonly installedSkills: {
      readonly schema: "boreal.skill.v1";
      readonly policy: "reinstall-on-repo-update";
    };
  };
  readonly delegation?: VersionDelegationInfo;
}

export interface VersionIdentity {
  readonly name: string;
  readonly version: string;
  readonly installChannel: string;
  readonly executable?: string;
}

export interface VersionDelegationInfo {
  readonly launcher: VersionIdentity;
  readonly delegated: VersionIdentity;
}

interface PackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly packageManager?: string;
}

let cachedVersionInfo: VersionInfo | undefined;

export function getVersionInfo(): VersionInfo {
  if (cachedVersionInfo) {
    return cachedVersionInfo;
  }
  const parsed = readPackageJson("package.json");
  const cliPackage = readPackageJson("apps/cli/package.json");
  cachedVersionInfo = {
    schemaVersion: VERSION_INFO_SCHEMA_VERSION,
    name: parsed.name ?? "boreal-work",
    version: parsed.version ?? "0.0.0",
    packageManager: parsed.packageManager,
    installChannel: detectInstallChannel(),
    node: process.version,
    cli: {
      packageName: cliPackage.name ?? "@boreal/cli",
      packageVersion: cliPackage.version ?? parsed.version ?? "0.0.0"
    },
    runtime: {
      recordSchemaVersion: BOREAL_SCHEMA_VERSION,
      fileStoreSchemaVersion: FILE_STORE_SCHEMA_VERSION
    },
    schemas: {
      runtimeRecord: BOREAL_SCHEMA_VERSION,
      fileStore: FILE_STORE_SCHEMA_VERSION,
      export: EXPORT_SCHEMA_VERSION,
      ledgerManifest: LEDGER_SCHEMA_VERSION,
      ledgerDeletion: LEDGER_DELETION_SCHEMA_VERSION,
      searchIndex: SEARCH_INDEX_SCHEMA_VERSION,
      sqliteCache: SQLITE_CACHE_SCHEMA_VERSION,
      projectSetup: PROJECT_SETUP_SCHEMA_VERSION,
      projectRegistry: PROJECT_REGISTRY_SCHEMA_VERSION,
      vault: VAULT_SCHEMA_VERSION,
      daemonStatus: DAEMON_STATUS_SCHEMA_VERSION,
      daemonWatch: DAEMON_WATCH_SCHEMA_VERSION
    },
    publishedSchemas: {
      runtimeCount: RUNTIME_SCHEMA_CONTRACTS.length,
      projectCount: PROJECT_SCHEMA_CONTRACTS.length,
      totalCount: PUBLISHED_SCHEMA_CONTRACTS.length,
      ids: PUBLISHED_SCHEMA_CONTRACTS.map((contract) => contract.schemaId)
    },
    migrationPolicy: {
      version: RUNTIME_MIGRATION_POLICY_VERSION,
      currentRuntimeSchemaVersion: BOREAL_SCHEMA_VERSION,
      snapshotSchemaVersion: EXPORT_SCHEMA_VERSION,
      rules: [
        "Existing v1 records must continue to validate unless a new runtime schema version is introduced.",
        "Optional additive v1 fields are allowed only when import/export remains forward-compatible.",
        "Reversible migrations must be idempotent and document the inverse or rollback command.",
        "Non-reversible migrations must create a boreal.export.v1 recovery snapshot before mutation."
      ]
    },
    compatibility: {
      semver: {
        releaseLine: "0.x",
        patch: "backward-compatible",
        minor: "may-change-contracts-with-migration-notes",
        major: "reserved-for-stable-contract-breaks"
      },
      launcher: {
        patchSkew: "supported",
        majorOrMinorSkew: "doctor-warning-and-repo-pin-delegation",
        repoPinPrecedence: true
      },
      runtime: {
        recordSchema: BOREAL_SCHEMA_VERSION,
        mode: "read-write"
      },
      storage: [
        { kind: "objects-v1", mode: "default-read-write" },
        { kind: "file-v2", mode: "legacy-read-write" },
        { kind: "file-v1", mode: "import-only" }
      ],
      installedSkills: {
        schema: "boreal.skill.v1",
        policy: "reinstall-on-repo-update"
      }
    },
    delegation: delegatedVersionInfo()
  };
  return cachedVersionInfo;
}

export function formatVersionInfo(info = getVersionInfo()): string {
  return [
    `${info.name} ${info.version}`,
    `schemaVersion: ${info.schemaVersion}`,
    `cliPackage: ${info.cli.packageName} ${info.cli.packageVersion}`,
    `node: ${info.node}`,
    info.packageManager ? `packageManager: ${info.packageManager}` : undefined,
    `installChannel: ${info.installChannel}`,
    `runtimeRecord: ${info.runtime.recordSchemaVersion}`,
    `fileStore: ${info.runtime.fileStoreSchemaVersion}`,
    info.delegation
      ? `launcher: ${formatVersionIdentity(info.delegation.launcher)}\ndelegated: ${formatVersionIdentity(info.delegation.delegated)}`
      : undefined,
    `export: ${info.schemas.export}`,
    `ledgerManifest: ${info.schemas.ledgerManifest}`,
    `searchIndex: ${info.schemas.searchIndex}`,
    `sqliteCache: ${info.schemas.sqliteCache}`,
    `projectSetup: ${info.schemas.projectSetup}`,
    `projectRegistry: ${info.schemas.projectRegistry}`,
    `vault: ${info.schemas.vault}`,
    `daemonStatus: ${info.schemas.daemonStatus}`,
    `publishedSchemas: ${info.publishedSchemas.totalCount}`,
    `migrationPolicy: ${info.migrationPolicy.version}`,
    `compatibility: ${info.compatibility.semver.releaseLine} (${info.compatibility.launcher.patchSkew} patch skew)`
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
    .concat("\n");
}

export function formatVersionProbe(info = getVersionInfo()): string {
  if (info.delegation) {
    return [
      `launcher: ${formatVersionIdentity(info.delegation.launcher)}`,
      `delegated: ${formatVersionIdentity(info.delegation.delegated)}`
    ].join("\n").concat("\n");
  }
  return `${info.name} ${info.version} (${info.installChannel})\n`;
}

function readPackageJson(relativePath: string): PackageJson {
  try {
    return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as PackageJson;
  } catch (error) {
    const fallback = buildPackageJson(relativePath);
    if (fallback) {
      return fallback;
    }
    throw error;
  }
}

function delegatedVersionInfo(info?: Pick<VersionInfo, "name" | "version" | "installChannel">): VersionDelegationInfo | undefined {
  const launcherName = process.env[BWRK_LAUNCHER_NAME_ENV];
  const launcherVersion = process.env[BWRK_LAUNCHER_VERSION_ENV];
  const launcherChannel = process.env[BWRK_LAUNCHER_CHANNEL_ENV];
  if (!launcherName || !launcherVersion || !launcherChannel) {
    return undefined;
  }
  const delegated = info ?? {
    name: readPackageJson("package.json").name ?? "boreal-work",
    version: readPackageJson("package.json").version ?? "0.0.0",
    installChannel: detectInstallChannel()
  };
  return {
    launcher: {
      name: launcherName,
      version: launcherVersion,
      installChannel: launcherChannel,
      executable: process.env[BWRK_LAUNCHER_EXECUTABLE_ENV] || undefined
    },
    delegated: {
      name: delegated.name,
      version: delegated.version,
      installChannel: delegated.installChannel,
      executable: process.env[BWRK_DELEGATED_BIN_ENV] || process.argv[1]
    }
  };
}

function formatVersionIdentity(identity: VersionIdentity): string {
  return `${identity.name} ${identity.version} (${identity.installChannel})`;
}

function buildPackageJson(relativePath: string): PackageJson | undefined {
  if (relativePath === "package.json") {
    return {
      name: buildConstantString("BOREAL_BUILD_PACKAGE_NAME"),
      version: buildConstantString("BOREAL_BUILD_PACKAGE_VERSION"),
      packageManager: buildConstantString("BOREAL_BUILD_PACKAGE_MANAGER")
    };
  }
  if (relativePath === "apps/cli/package.json") {
    return {
      name: buildConstantString("BOREAL_BUILD_CLI_PACKAGE_NAME"),
      version: buildConstantString("BOREAL_BUILD_CLI_PACKAGE_VERSION")
    };
  }
  return undefined;
}

function buildConstantString(name: string): string | undefined {
  switch (name) {
    case "BOREAL_BUILD_PACKAGE_NAME":
      return typeof BOREAL_BUILD_PACKAGE_NAME === "string" && BOREAL_BUILD_PACKAGE_NAME.length > 0 ? BOREAL_BUILD_PACKAGE_NAME : undefined;
    case "BOREAL_BUILD_PACKAGE_VERSION":
      return typeof BOREAL_BUILD_PACKAGE_VERSION === "string" && BOREAL_BUILD_PACKAGE_VERSION.length > 0
        ? BOREAL_BUILD_PACKAGE_VERSION
        : undefined;
    case "BOREAL_BUILD_PACKAGE_MANAGER":
      return typeof BOREAL_BUILD_PACKAGE_MANAGER === "string" && BOREAL_BUILD_PACKAGE_MANAGER.length > 0
        ? BOREAL_BUILD_PACKAGE_MANAGER
        : undefined;
    case "BOREAL_BUILD_CLI_PACKAGE_NAME":
      return typeof BOREAL_BUILD_CLI_PACKAGE_NAME === "string" && BOREAL_BUILD_CLI_PACKAGE_NAME.length > 0
        ? BOREAL_BUILD_CLI_PACKAGE_NAME
        : undefined;
    case "BOREAL_BUILD_CLI_PACKAGE_VERSION":
      return typeof BOREAL_BUILD_CLI_PACKAGE_VERSION === "string" && BOREAL_BUILD_CLI_PACKAGE_VERSION.length > 0
        ? BOREAL_BUILD_CLI_PACKAGE_VERSION
        : undefined;
    default:
      return undefined;
  }
}
