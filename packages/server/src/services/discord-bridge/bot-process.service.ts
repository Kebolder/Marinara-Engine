import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import type { DiscordBotProcessState } from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import { getMonorepoRoot, getPort, isEnabledFlag } from "../../config/runtime-config.js";
import { createAppSettingsStorage } from "../storage/app-settings.storage.js";
import type { DB } from "../../db/connection.js";

export const DISCORD_BRIDGE_AUTO_START_KEY = "discordBridge.autoStart";
const REQUIRED_ENV_VARS = ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID", "DISCORD_OWNER_ID"] as const;

function missingEnvVars(): string[] {
  return REQUIRED_ENV_VARS.filter((key) => !(process.env[key] ?? "").trim());
}

class DiscordBotProcessService {
  private child: ChildProcess | null = null;
  private state: DiscordBotProcessState = "stopped";
  private lastError: string | null = null;
  private stoppingIntentionally = false;

  isConfigured(): boolean {
    return missingEnvVars().length === 0;
  }

  getState(): DiscordBotProcessState {
    return this.state;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  start(): { ok: boolean; error?: string } {
    if (this.child) return { ok: true };

    const missing = missingEnvVars();
    if (missing.length > 0) {
      const error = `Missing required Discord environment variables: ${missing.join(", ")}`;
      this.lastError = error;
      this.state = "error";
      return { ok: false, error };
    }

    const scriptPath = resolve(getMonorepoRoot(), "packages/discord-bot/dist/index.js");
    const child = spawn(process.execPath, [scriptPath], {
      cwd: getMonorepoRoot(),
      env: {
        ...process.env,
        DISCORD_BRIDGE_ENABLED: "true",
        DISCORD_BRIDGE_SERVER_URL: `http://127.0.0.1:${getPort()}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    });

    this.child = child;
    this.state = "starting";
    this.lastError = null;
    this.stoppingIntentionally = false;

    child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr?.on("data", (chunk) => process.stderr.write(chunk));

    child.once("spawn", () => {
      if (this.child === child) this.state = "running";
    });

    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      const wasIntentional = this.stoppingIntentionally;
      this.child = null;
      this.stoppingIntentionally = false;
      if (!wasIntentional && code !== 0) {
        this.lastError = `Discord bot exited with code ${code ?? "null"} signal ${signal ?? "null"}`;
        this.state = "error";
        logger.error(this.lastError);
      } else {
        this.state = "stopped";
      }
    });

    child.once("error", (err) => {
      if (this.child !== child) return;
      this.lastError = err.message;
      this.state = "error";
      logger.error(err, "Failed to start Discord bot process");
    });

    logger.info("Starting Discord bot process");
    return { ok: true };
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;

    this.stoppingIntentionally = true;
    child.kill("SIGTERM");

    await new Promise<void>((resolveStop) => {
      const timeout = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolveStop();
      });
    });
  }

  killForProcessExit(): void {
    if (this.child && !this.child.killed) {
      this.stoppingIntentionally = true;
      this.child.kill("SIGTERM");
    }
  }

  async syncAutoStart(db: DB): Promise<void> {
    const storage = createAppSettingsStorage(db);
    const raw = await storage.get(DISCORD_BRIDGE_AUTO_START_KEY);
    const autoStart = raw === null ? isEnabledFlag(process.env.DISCORD_BRIDGE_ENABLED) : raw === "true";
    if (autoStart && this.isConfigured() && !this.child) {
      this.start();
    }
  }
}

export const discordBotProcessService = new DiscordBotProcessService();
