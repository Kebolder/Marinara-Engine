import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { mkdir, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { registerTurnGameEngine, type AnyTurnGameEngine, type InstalledCapabilityPackage } from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import { DATA_DIR } from "../../utils/data-dir.js";
import { capabilityPackageManager } from "./package-manager.service.js";
import {
  registerCapabilityConversationCommand,
  type CapabilityConversationCommandRegistration,
} from "./capability-command-registry.service.js";
import { registerCapabilityService } from "./capability-service-registry.service.js";

type Cleanup = () => void | Promise<void>;
type CapabilityModule = {
  activate?: (context: {
    app: FastifyInstance;
    dataDir: string;
    package: InstalledCapabilityPackage;
    api: {
      registerTurnGameEngine(engine: AnyTurnGameEngine): Cleanup;
      registerConversationCommand(registration: CapabilityConversationCommandRegistration): Cleanup;
      registerService<T>(key: string, service: T): Cleanup;
    };
  }) => void | Cleanup | Promise<void | Cleanup>;
};

class CapabilityModuleRuntime {
  private cleanup: Cleanup[] = [];

  async start(app: FastifyInstance): Promise<void> {
    await this.ensureModuleResolution();
    for (const runtimePackage of await capabilityPackageManager.runtimePackages()) {
      await this.activateOne(app, runtimePackage, true);
    }
  }

  private async ensureModuleResolution(): Promise<void> {
    const packageRoot = join(DATA_DIR, "capability-packages");
    const link = join(packageRoot, "node_modules");
    if (existsSync(link)) return;
    const serverNodeModules = resolve(dirname(fileURLToPath(import.meta.url)), "../../../node_modules");
    if (!existsSync(serverNodeModules)) return;
    await mkdir(packageRoot, { recursive: true });
    try {
      await symlink(serverNodeModules, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (!existsSync(link)) logger.warn(error, "Could not link package runtime dependencies");
    }
  }

  private async activateOne(
    app: FastifyInstance,
    runtimePackage: Awaited<ReturnType<typeof capabilityPackageManager.runtimePackages>>[number],
    allowRollback: boolean,
  ): Promise<void> {
    const { installed, serverEntrypoint } = runtimePackage;
    try {
      const module = (await import(pathToFileURL(serverEntrypoint).href)) as CapabilityModule;
      if (typeof module.activate !== "function") throw new Error("Server entrypoint must export activate(context)");
      const cleanup = await module.activate({
        app,
        dataDir: DATA_DIR,
        package: installed,
        api: {
          registerTurnGameEngine,
          registerConversationCommand: registerCapabilityConversationCommand,
          registerService: registerCapabilityService,
        },
      });
      if (typeof cleanup === "function") this.cleanup.push(cleanup);
      await capabilityPackageManager.markRuntimeStatus(installed.id, "active");
      logger.info("Activated capability package %s@%s", installed.id, installed.version);
    } catch (error) {
      logger.error(error, "Failed to activate capability package %s@%s", installed.id, installed.version);
      const previous = allowRollback ? await capabilityPackageManager.rollbackRuntime(installed.id) : null;
      if (previous) {
        logger.warn("Rolling capability package %s back to %s", installed.id, previous.installed.version);
        await this.activateOne(app, previous, false);
        return;
      }
      await capabilityPackageManager.markRuntimeStatus(
        installed.id,
        "error",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async stop(): Promise<void> {
    for (const cleanup of this.cleanup.splice(0).reverse()) {
      try {
        await cleanup();
      } catch (error) {
        logger.warn(error, "Capability package cleanup failed");
      }
    }
  }
}

export const capabilityModuleRuntime = new CapabilityModuleRuntime();
