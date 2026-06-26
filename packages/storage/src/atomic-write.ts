import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export interface AtomicTextWriteOptions {
  readonly mode?: number;
  readonly syncFile?: boolean;
  readonly syncParentDirectory?: boolean;
}

export async function writeTextFileAtomic(
  path: string,
  content: string,
  options: AtomicTextWriteOptions = {}
): Promise<void> {
  const syncFile = options.syncFile ?? true;
  const syncParent = options.syncParentDirectory ?? true;
  const tempFile = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

  await mkdir(dirname(path), { recursive: true });

  const handle = await open(tempFile, "w", options.mode ?? 0o600);
  let closed = false;
  try {
    await handle.writeFile(content, "utf8");
    if (syncFile) {
      await handle.sync();
    }
    await handle.close();
    closed = true;
    await rename(tempFile, path);
    if (syncParent) {
      await syncDirectory(dirname(path));
    }
  } catch (error) {
    if (!closed) {
      await handle.close().catch(() => undefined);
    }
    await rm(tempFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    if (isIgnorableDirectorySyncError(error)) {
      return;
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function isIgnorableDirectorySyncError(error: unknown): boolean {
  return (
    isNodeError(error) &&
    (error.code === "EINVAL" || error.code === "ENOTSUP" || error.code === "EISDIR" || error.code === "EPERM")
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
