#!/usr/bin/env node
import { serveBorealMcpStdio } from "./server.js";

export * from "./server.js";
export * from "./tools.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  await serveBorealMcpStdio({
    workspaceRoot: flagValue(process.argv.slice(2), "workspace") ?? flagValue(process.argv.slice(2), "project-root")
  });
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.findIndex((arg) => arg === `--${name}`);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
}
