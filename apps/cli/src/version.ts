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
import { FILE_STORE_SCHEMA_VERSION, SQLITE_CACHE_SCHEMA_VERSION } from "@boreal/storage";

import { EXPORT_SCHEMA_VERSION, LEDGER_DELETION_SCHEMA_VERSION, LEDGER_SCHEMA_VERSION } from "./import-export.js";
import { PROJECT_SETUP_SCHEMA_VERSION } from "./project-setup.js";
import { VAULT_SCHEMA_VERSION } from "./vault.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

export const VERSION_INFO_SCHEMA_VERSION = "boreal.cli.version.v1";
export const RUNTIME_MIGRATION_POLICY_VERSION = "boreal.runtime-migration-policy.v1";

export interface VersionInfo {
  readonly schemaVersion: typeof VERSION_INFO_SCHEMA_VERSION;
  readonly name: string;
  readonly version: string;
  readonly packageManager?: string;
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
    }
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
    `runtimeRecord: ${info.runtime.recordSchemaVersion}`,
    `fileStore: ${info.runtime.fileStoreSchemaVersion}`,
    `export: ${info.schemas.export}`,
    `ledgerManifest: ${info.schemas.ledgerManifest}`,
    `searchIndex: ${info.schemas.searchIndex}`,
    `sqliteCache: ${info.schemas.sqliteCache}`,
    `projectSetup: ${info.schemas.projectSetup}`,
    `projectRegistry: ${info.schemas.projectRegistry}`,
    `vault: ${info.schemas.vault}`,
    `daemonStatus: ${info.schemas.daemonStatus}`,
    `publishedSchemas: ${info.publishedSchemas.totalCount}`,
    `migrationPolicy: ${info.migrationPolicy.version}`
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
    .concat("\n");
}

export function formatVersionProbe(info = getVersionInfo()): string {
  return `${info.name} ${info.version}\n`;
}

function readPackageJson(relativePath: string): PackageJson {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as PackageJson;
}
