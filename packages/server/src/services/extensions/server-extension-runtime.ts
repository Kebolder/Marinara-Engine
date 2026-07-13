import vm from "node:vm";
import type { FastifyInstance } from "fastify";
import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { createAppSettingsStorage } from "../storage/app-settings.storage.js";
import { createExtensionsStorage } from "../storage/extensions.storage.js";
import { createExtensionSettingsStorage } from "./extension-storage.service.js";
import { safeFetch } from "../../utils/security.js";
import type { InstalledExtension } from "@marinara-engine/shared";

type CleanupFn = () => void | Promise<void>;
type ActiveServerExtension = {
  id: string;
  name: string;
  cleanupFns: CleanupFn[];
};
type ServerExtensionStatus = {
  status: "running" | "stopped" | "error";
  error: string | null;
};

const SERVER_EXTENSION_INIT_TIMEOUT_MS = 5_000;
const SERVER_EXTENSION_VM_TIMEOUT_MS = 1_000;
const SERVER_EXTENSION_FETCH_MAX_BYTES = 25 * 1024 * 1024;
const SERVER_EXTENSION_CLEANUP_TIMEOUT_MS = 5_000;

function normalizeTimerMs(ms: unknown): number {
  const parsed = typeof ms === "number" && Number.isFinite(ms) ? ms : 0;
  return Math.max(0, Math.min(2 ** 31 - 1, Math.trunc(parsed)));
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function normalizeLogArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (arg instanceof Error) return { name: arg.name, message: arg.message, stack: arg.stack };
    if (typeof arg === "string" || typeof arg === "number" || typeof arg === "boolean" || arg == null) return arg;
    try {
      return JSON.parse(JSON.stringify(arg)) as unknown;
    } catch {
      return String(arg);
    }
  });
}

function buildExtensionFilename(extension: InstalledExtension): string {
  return `marinara-server-extension-${extension.id}.js`;
}

class ServerExtensionRuntime {
  private db: DB | null = null;
  private active = new Map<string, ActiveServerExtension>();
  private statuses = new Map<string, ServerExtensionStatus>();
  private reloadQueue: Promise<void> = Promise.resolve();

  async start(_app: FastifyInstance, db: DB): Promise<void> {
    this.db = db;
    await this.reload();
  }

  async stop(): Promise<void> {
    await this.stopAll();
    this.db = null;
  }

  withRuntimeStatus(extension: InstalledExtension): InstalledExtension {
    if (extension.runtime !== "server") return extension;
    const status = this.statuses.get(extension.id);
    return {
      ...extension,
      serverStatus: extension.enabled ? (status?.status ?? "stopped") : "stopped",
      serverError: status?.error ?? null,
    };
  }

  async reload(): Promise<void> {
    this.reloadQueue = this.reloadQueue
      .then(() => this.reloadNow())
      .catch((error) => {
        logger.error(error, "[server-extensions] Reload failed");
      });
    return this.reloadQueue;
  }

  async reloadExtension(id: string): Promise<void> {
    this.reloadQueue = this.reloadQueue
      .then(() => this.reloadExtensionNow(id))
      .catch((error) => {
        logger.error(error, "[server-extensions] Reload failed for %s", id);
      });
    return this.reloadQueue;
  }

  async unloadExtension(id: string): Promise<void> {
    this.reloadQueue = this.reloadQueue
      .then(() => this.unloadExtensionNow(id))
      .catch((error) => {
        logger.error(error, "[server-extensions] Unload failed for %s", id);
      });
    return this.reloadQueue;
  }

  private async reloadNow(): Promise<void> {
    if (!this.db) return;
    await this.stopAll();
    this.statuses.clear();

    const extensions = await createExtensionsStorage(this.db).list();
    const serverExtensions = extensions.filter((extension) => extension.runtime === "server");
    for (const extension of serverExtensions) {
      if (!extension.enabled) {
        this.statuses.set(extension.id, { status: "stopped", error: null });
        continue;
      }
      if (!extension.serverJs?.trim()) {
        this.statuses.set(extension.id, { status: "error", error: "No server JavaScript payload" });
        continue;
      }
      try {
        await this.load(extension);
        this.statuses.set(extension.id, { status: "running", error: null });
      } catch (error) {
        const message = describeError(error);
        this.statuses.set(extension.id, { status: "error", error: message });
        logger.error(error, "[server-extensions] Failed to load %s (%s)", extension.name, extension.id);
      }
    }
  }

  private async reloadExtensionNow(id: string): Promise<void> {
    if (!this.db) return;
    await this.unloadExtensionNow(id);

    const extension = await createExtensionsStorage(this.db).getById(id);
    if (!extension || extension.runtime !== "server") {
      this.statuses.delete(id);
      return;
    }
    if (!extension.enabled) {
      this.statuses.set(extension.id, { status: "stopped", error: null });
      return;
    }
    if (!extension.serverJs?.trim()) {
      this.statuses.set(extension.id, { status: "error", error: "No server JavaScript payload" });
      return;
    }
    try {
      await this.load(extension);
      this.statuses.set(extension.id, { status: "running", error: null });
    } catch (error) {
      const message = describeError(error);
      this.statuses.set(extension.id, { status: "error", error: message });
      logger.error(error, "[server-extensions] Failed to load %s (%s)", extension.name, extension.id);
    }
  }

  private async unloadExtensionNow(id: string): Promise<void> {
    const active = this.active.get(id);
    this.active.delete(id);
    this.statuses.delete(id);
    if (active) {
      await this.stopExtension(active);
    }
  }

  private async stopAll(): Promise<void> {
    const active = Array.from(this.active.values());
    this.active.clear();
    for (const extension of active) {
      await this.stopExtension(extension);
    }
  }

  private async stopExtension(extension: ActiveServerExtension): Promise<void> {
    for (const cleanup of [...extension.cleanupFns].reverse()) {
      try {
        await Promise.race([
          Promise.resolve(cleanup()),
          new Promise((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Server extension cleanup timed out")),
              SERVER_EXTENSION_CLEANUP_TIMEOUT_MS,
            );
            timer.unref?.();
          }),
        ]);
      } catch (error) {
        logger.warn(error, "[server-extensions] Cleanup failed for %s (%s)", extension.name, extension.id);
      }
    }
  }

  private async load(extension: InstalledExtension): Promise<void> {
    if (!this.db) throw new Error("Server extension runtime is not connected to storage");
    const cleanupFns: CleanupFn[] = [];
    const activeExtension: ActiveServerExtension = {
      id: extension.id,
      name: extension.name,
      cleanupFns,
    };
    const addCleanup = (fn: CleanupFn) => cleanupFns.push(fn);
    const safeCall = (label: string, fn: () => void) => {
      try {
        fn();
      } catch (error) {
        logger.warn(error, "[server-extensions] %s failed for %s (%s)", label, extension.name, extension.id);
      }
    };
    const makeTimerApi = () => {
      const setManagedTimeout = (fn: () => void, ms: unknown) => {
        if (typeof fn !== "function") throw new Error("setTimeout requires a function");
        const timer = setTimeout(() => safeCall("timeout callback", fn), normalizeTimerMs(ms));
        addCleanup(() => clearTimeout(timer));
        return timer;
      };
      const setManagedInterval = (fn: () => void, ms: unknown) => {
        if (typeof fn !== "function") throw new Error("setInterval requires a function");
        const timer = setInterval(() => safeCall("interval callback", fn), normalizeTimerMs(ms));
        addCleanup(() => clearInterval(timer));
        return timer;
      };
      return { setManagedTimeout, setManagedInterval };
    };
    const timers = makeTimerApi();
    const log = (level: "debug" | "info" | "warn" | "error", args: unknown[]) => {
      const payload = { extensionId: extension.id, extensionName: extension.name, args: normalizeLogArgs(args) };
      logger[level](payload, "[server-extension] %s", extension.name);
    };
    const extensionSettings = createExtensionSettingsStorage(createAppSettingsStorage(this.db));
    const marinara = Object.freeze({
      runtime: "server" as const,
      version: 1,
      extensionId: extension.id,
      extensionName: extension.name,
      log: Object.freeze({
        debug: (...args: unknown[]) => log("debug", args),
        info: (...args: unknown[]) => log("info", args),
        warn: (...args: unknown[]) => log("warn", args),
        error: (...args: unknown[]) => log("error", args),
      }),
      fetch: (url: string | URL, init?: RequestInit) =>
        safeFetch(url, {
          ...(init ?? {}),
          policy: { allowedProtocols: ["https:", "http:"] },
          maxResponseBytes: SERVER_EXTENSION_FETCH_MAX_BYTES,
          bufferResponse: false,
        }),
      storage: Object.freeze({
        get: () => extensionSettings.get(extension.id),
        patch: (patch: Record<string, unknown>) => extensionSettings.patch(extension.id, patch),
        delete: () => extensionSettings.remove(extension.id),
      }),
      setTimeout: timers.setManagedTimeout,
      setInterval: timers.setManagedInterval,
      clearTimeout,
      clearInterval,
      onCleanup: (fn: CleanupFn) => {
        if (typeof fn !== "function") throw new Error("onCleanup requires a function");
        addCleanup(fn);
      },
    });
    const sandbox = {
      marinara,
      console: Object.freeze({
        debug: (...args: unknown[]) => log("debug", args),
        info: (...args: unknown[]) => log("info", args),
        log: (...args: unknown[]) => log("info", args),
        warn: (...args: unknown[]) => log("warn", args),
        error: (...args: unknown[]) => log("error", args),
      }),
      setTimeout: timers.setManagedTimeout,
      setInterval: timers.setManagedInterval,
      clearTimeout,
      clearInterval,
      URL,
      URLSearchParams,
      TextDecoder,
      TextEncoder,
      AbortController,
      AbortSignal,
    };
    const context = vm.createContext(sandbox, { name: `MarinaraServerExtension:${extension.name}` });
    const source = `"use strict";\n(async () => {\n${extension.serverJs ?? ""}\n})()`;
    const script = new vm.Script(source, {
      filename: buildExtensionFilename(extension),
    });

    try {
      const result = script.runInContext(context, {
        timeout: SERVER_EXTENSION_VM_TIMEOUT_MS,
        displayErrors: true,
      }) as Promise<unknown> | unknown;
      await Promise.race([
        Promise.resolve(result),
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Server extension startup timed out")),
            SERVER_EXTENSION_INIT_TIMEOUT_MS,
          );
          timer.unref?.();
        }),
      ]);
      this.active.set(extension.id, activeExtension);
      logger.info("[server-extensions] Loaded %s (%s)", extension.name, extension.id);
    } catch (error) {
      await this.stopExtension(activeExtension);
      throw error;
    }
  }
}

export const serverExtensionRuntime = new ServerExtensionRuntime();
