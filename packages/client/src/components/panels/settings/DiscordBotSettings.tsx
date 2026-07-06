import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { DiscordBridgeStatus } from "@marinara-engine/shared";
import { ApiError, api } from "../../../lib/api-client";
import { SettingsIntro, SettingsSection, ToggleSetting } from "./SettingControls";

const STATUS_QUERY_KEY = ["discord-bridge", "status"] as const;

function statusDotClass(status: DiscordBridgeStatus | undefined) {
  if (!status) return "bg-gray-400";
  if (status.connected) return "bg-green-500";
  if (status.processState === "starting") return "bg-yellow-500";
  if (status.processState === "error") return "bg-red-500";
  return "bg-gray-400";
}

function statusLabel(status: DiscordBridgeStatus | undefined) {
  if (!status) return "Checking status...";
  if (status.connected) return status.botTag ? `Connected as ${status.botTag}` : "Connected";
  if (status.processState === "starting") return "Starting...";
  if (status.processState === "error") return status.processError ?? "Bot exited unexpectedly";
  if (!status.configured) return "Not configured (missing Discord environment variables)";
  return "Stopped";
}

export function DiscordBotSettings() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: () => api.get<DiscordBridgeStatus>("/discord-bridge/status"),
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: false,
  });

  const setAutoStart = useMutation({
    mutationFn: (enabled: boolean) => api.patch<{ enabled: boolean }>("/discord-bridge/auto-start", { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to update auto-start setting");
    },
  });

  const startBot = useMutation({
    mutationFn: () => api.post<{ ok: boolean; state: string }>("/discord-bridge/bot/start"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to start the Discord bot");
    },
  });

  const killBot = useMutation({
    mutationFn: () => api.post<{ ok: boolean; state: string }>("/discord-bridge/bot/stop"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to stop the Discord bot");
    },
  });

  const status = statusQuery.data;
  const canStart = !!status?.configured && status.processState !== "running" && status.processState !== "starting";
  const canKill = !!status?.connected;

  return (
    <div className="flex flex-col gap-3">
      <SettingsIntro>Connect and configure the Marinara Discord bridge bot.</SettingsIntro>

      <SettingsSection
        title="Discord Bot"
        description="Bot configuration will live here."
        icon={<Bot size="0.875rem" />}
      >
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(status)}`} />
          <span className="text-[var(--foreground)]">
            {statusQuery.isLoading ? "Checking status..." : statusLabel(status)}
          </span>
        </div>

        <div className="mt-3 flex flex-col gap-2.5">
          <ToggleSetting
            label="Auto-start bot with Marinara"
            checked={status?.autoStart ?? false}
            onChange={(checked) => setAutoStart.mutate(checked)}
            disabled={setAutoStart.isPending || statusQuery.isLoading}
            help="Automatically starts the Discord bridge bot whenever Marinara starts."
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => startBot.mutate()}
              disabled={!canStart || startBot.isPending}
              className="mari-chrome-control mari-chrome-control--primary flex w-fit items-center gap-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
            >
              {startBot.isPending && <Loader2 size="0.875rem" className="animate-spin" />}
              Start Bot
            </button>

            <button
              type="button"
              onClick={() => killBot.mutate()}
              disabled={!canKill || killBot.isPending}
              className="mari-chrome-control mari-chrome-control--primary mari-chrome-control--danger flex w-fit items-center gap-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
            >
              {killBot.isPending && <Loader2 size="0.875rem" className="animate-spin" />}
              Kill Bot
            </button>
          </div>

          {!status?.configured && (
            <p className="text-xs text-[var(--muted-foreground)]">
              Set DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, and DISCORD_OWNER_ID in your .env file before
              starting the bot.
            </p>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
