import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ExternalLink, Loader2, SlidersHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type {
  DiscordBridgeConnectionOption,
  DiscordBridgePromptPresetOption,
  DiscordBridgeRoleplayDefaults,
  DiscordBridgeStatus,
  DiscordBridgeThreadBinding,
} from "@marinara-engine/shared";
import { ApiError, api } from "../../../lib/api-client";
import { cn } from "../../../lib/utils";
import { SettingsIntro, SettingsSection, ToggleSetting } from "./SettingControls";

const STATUS_QUERY_KEY = ["discord-bridge", "status"] as const;
const BINDINGS_QUERY_KEY = ["discord-bridge", "thread-bindings"] as const;
const DEFAULTS_QUERY_KEY = ["discord-bridge", "roleplay-defaults"] as const;
const CONNECTIONS_QUERY_KEY = ["discord-bridge", "connections"] as const;
const PROMPT_PRESETS_QUERY_KEY = ["discord-bridge", "prompt-presets"] as const;

const SELECT_CLS =
  "w-full cursor-pointer appearance-none rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]";

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

  const bindingsQuery = useQuery({
    queryKey: BINDINGS_QUERY_KEY,
    queryFn: () => api.get<DiscordBridgeThreadBinding[]>("/discord-bridge/thread-bindings"),
    staleTime: 30_000,
  });

  const unbind = useMutation({
    mutationFn: (bindingId: string) => api.delete<{ ok: boolean }>(`/discord-bridge/thread-bindings/${bindingId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BINDINGS_QUERY_KEY });
      toast.success("Thread binding removed");
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove the thread binding");
    },
  });

  const bindings = bindingsQuery.data ?? [];

  const defaultsQuery = useQuery({
    queryKey: DEFAULTS_QUERY_KEY,
    queryFn: () => api.get<DiscordBridgeRoleplayDefaults>("/discord-bridge/roleplay-defaults"),
    staleTime: 30_000,
  });

  const connectionsQuery = useQuery({
    queryKey: CONNECTIONS_QUERY_KEY,
    queryFn: () =>
      api.get<{ connections: DiscordBridgeConnectionOption[]; defaultConnectionId: string | null }>(
        "/discord-bridge/connections",
      ),
    staleTime: 30_000,
  });

  const promptPresetsQuery = useQuery({
    queryKey: PROMPT_PRESETS_QUERY_KEY,
    queryFn: () =>
      api.get<{ presets: DiscordBridgePromptPresetOption[]; defaultPromptPresetId: string | null }>(
        "/discord-bridge/prompt-presets",
      ),
    staleTime: 30_000,
  });

  // PATCH replaces the whole settings blob, so always send both fields.
  const saveDefaults = useMutation({
    mutationFn: (input: { connectionId: string | null; promptPresetId: string | null }) =>
      api.patch<DiscordBridgeRoleplayDefaults>("/discord-bridge/roleplay-defaults", input),
    onSuccess: (data) => {
      queryClient.setQueryData(DEFAULTS_QUERY_KEY, data);
      toast.success("Roleplay defaults updated");
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to update roleplay defaults");
      void queryClient.invalidateQueries({ queryKey: DEFAULTS_QUERY_KEY });
    },
  });

  const defaults = defaultsQuery.data;
  const selectedConnectionId = defaults?.settings.connectionId ?? "";
  const selectedPromptPresetId = defaults?.settings.promptPresetId ?? "";

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

      <SettingsSection
        title="Roleplay Defaults"
        description="Connection and prompt the bot uses for new roleplays, set here instead of in the bot itself."
        icon={<SlidersHorizontal size="0.875rem" />}
      >
        {defaultsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <Loader2 size="0.875rem" className="animate-spin" />
            Loading defaults...
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--foreground)]">Connection</span>
              <select
                className={cn(SELECT_CLS)}
                value={selectedConnectionId}
                disabled={saveDefaults.isPending || connectionsQuery.isLoading}
                onChange={(e) => {
                  const value = e.target.value || null;
                  saveDefaults.mutate({ connectionId: value, promptPresetId: selectedPromptPresetId || null });
                }}
              >
                <option value="">Automatic (app default)</option>
                <option value="random">Random (random-eligible connections)</option>
                {(connectionsQuery.data?.connections ?? []).map((conn) => (
                  <option key={conn.id} value={conn.id}>
                    {conn.name}
                    {conn.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
              <span className="text-[0.7rem] text-[var(--muted-foreground)]">
                {defaults?.connection ? `Using ${defaults.connection.name} · ${defaults.connection.model}` : "Using app default connection"}
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--foreground)]">Prompt preset</span>
              <select
                className={cn(SELECT_CLS)}
                value={selectedPromptPresetId}
                disabled={saveDefaults.isPending || promptPresetsQuery.isLoading}
                onChange={(e) => {
                  const value = e.target.value || null;
                  saveDefaults.mutate({ connectionId: selectedConnectionId || null, promptPresetId: value });
                }}
              >
                <option value="">Automatic (preset / connection default)</option>
                {(promptPresetsQuery.data?.presets ?? []).map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                    {preset.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
              <span className="text-[0.7rem] text-[var(--muted-foreground)]">
                {defaults?.promptPreset ? `Using ${defaults.promptPreset.name}` : "Using automatic prompt preset"}
              </span>
            </label>

            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-[var(--foreground)]">Chat preset</span>
              <span className="text-[0.7rem] text-[var(--muted-foreground)]">
                {defaults?.chatPreset ? defaults.chatPreset.name : "None"} — follows the active Roleplay chat preset.
              </span>
            </div>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Bound Roleplays"
        description="Roleplay chats linked to Discord threads. Remove a binding to unlink its thread."
        icon={<Bot size="0.875rem" />}
      >
        {bindingsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <Loader2 size="0.875rem" className="animate-spin" />
            Loading bindings...
          </div>
        ) : bindings.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">No roleplays are bound to Discord threads yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {bindings.map((binding) => (
              <li
                key={binding.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-[var(--sidebar)] px-2.5 py-1.5 ring-1 ring-[var(--border)]"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium text-[var(--foreground)]">{binding.chatName}</span>
                  <a
                    href={`https://discord.com/channels/${binding.guildId}/${binding.threadId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 truncate font-mono text-[0.7rem] text-[var(--muted-foreground)] hover:text-[var(--primary)]"
                  >
                    Thread {binding.threadId}
                    <ExternalLink size="0.7rem" className="shrink-0" />
                  </a>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm(`Remove the Discord thread binding for "${binding.chatName}"?`)) return;
                    unbind.mutate(binding.id);
                  }}
                  disabled={unbind.isPending}
                  title="Remove binding"
                  className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[var(--destructive)] transition-opacity active:scale-90 disabled:opacity-45"
                >
                  <Trash2 size="0.75rem" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </div>
  );
}
