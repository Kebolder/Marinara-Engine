import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  HardDrive,
  Loader2,
  PackageOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  WifiOff,
} from "lucide-react";
import type { CapabilityCatalogPackage } from "@marinara-engine/shared";
import { toast } from "sonner";
import {
  useCapabilityCatalog,
  useInstallCapabilityPackage,
  useInstalledCapabilityPackages,
  useUninstallCapabilityPackage,
} from "../../hooks/use-capability-packages";
import { getPrivilegedActionErrorMessage } from "../../lib/api-client";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { cn } from "../../lib/utils";
import { Modal } from "../ui/Modal";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function kindLabel(kind: CapabilityCatalogPackage["manifest"]["kind"][number]) {
  if (kind === "conversation-calls") return "Conversation Calls";
  if (kind === "turn-game") return "Conversation Game";
  if (kind === "maps") return "Maps";
  return "Agent";
}

export function AgentCatalogView({ open, onClose }: { open: boolean; onClose: () => void }) {
  const catalog = useCapabilityCatalog(open);
  const installed = useInstalledCapabilityPackages(open);
  const install = useInstallCapabilityPackage();
  const uninstall = useUninstallCapabilityPackage();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const installedById = useMemo(() => new Map((installed.data ?? []).map((item) => [item.id, item])), [installed.data]);
  const packages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (catalog.data?.packages ?? []).filter(({ manifest }) =>
      !needle || [manifest.name, manifest.description, manifest.id, ...manifest.kind.map(kindLabel)]
        .join(" ").toLowerCase().includes(needle),
    );
  }, [catalog.data, query]);
  const selected = (catalog.data?.packages ?? []).find((item) => item.manifest.id === selectedId) ?? packages[0] ?? null;

  useEffect(() => {
    if (!selectedId && packages[0]) setSelectedId(packages[0].manifest.id);
    if (selectedId && !packages.some((item) => item.manifest.id === selectedId)) setSelectedId(packages[0]?.manifest.id ?? null);
  }, [packages, selectedId]);

  const handleInstall = async (entry: CapabilityCatalogPackage) => {
    try {
      const result = await install.mutateAsync(entry.manifest.id);
      toast.success(result.status === "restart-required"
        ? "Agent installed. Restart Marinara Engine to finish setup."
        : "Agent installed. It is ready to use.");
    } catch (error) {
      toast.error(getPrivilegedActionErrorMessage(error, "Agent installation failed."));
    }
  };

  const handleUninstall = async (entry: CapabilityCatalogPackage) => {
    const confirmed = await showConfirmDialog({
      title: `Uninstall ${entry.manifest.name}?`,
      message: "The downloaded package and its settings will be removed. Existing chat messages and history will remain.",
      confirmLabel: "Uninstall",
      tone: "destructive",
    });
    if (!confirmed) return;
    try {
      await uninstall.mutateAsync(entry.manifest.id);
      toast.success(`${entry.manifest.name} uninstalled.`);
    } catch (error) {
      toast.error(getPrivilegedActionErrorMessage(error, "Agent uninstall failed."));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Download Agents" width="max-w-[96rem]" mobileFullscreen panelClassName="h-[min(92dvh,64rem)]">
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] pb-4">
          <div className="relative min-w-[12rem] flex-1">
            <Search size="0.9rem" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input className="mari-chrome-field h-10 w-full pl-9 pr-3 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents, maps, calls, and games" aria-label="Search downloadable agents" />
          </div>
          <button type="button" className="mari-chrome-control h-10 px-3" onClick={() => void Promise.all([catalog.refetch(), installed.refetch()])} disabled={catalog.isFetching || installed.isFetching}>
            <RefreshCw size="0.85rem" className={cn((catalog.isFetching || installed.isFetching) && "animate-spin")} /> Refresh
          </button>
        </div>

        {catalog.isLoading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]"><Loader2 className="animate-spin" size="1rem" /> Loading the official catalog…</div>
        ) : catalog.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center"><WifiOff size="2rem" className="text-[var(--muted-foreground)]" /><div><p className="font-semibold">The agent catalog is unavailable.</p><p className="mt-1 max-w-md text-sm text-[var(--muted-foreground)]">Check the server internet connection. Installed agents remain available offline.</p></div><button className="mari-chrome-control mari-chrome-control--primary" onClick={() => void catalog.refetch()}>Try again</button></div>
        ) : packages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center"><PackageOpen size="2rem" className="text-[var(--muted-foreground)]" /><p className="font-semibold">{query ? "No matching agents" : "The official catalog is empty"}</p><p className="text-sm text-[var(--muted-foreground)]">{query ? "Try a different search." : "Published packages will appear here automatically."}</p></div>
        ) : (
          <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(17rem,24rem)_minmax(0,1fr)]">
            <div className={cn("min-h-0 overflow-y-auto md:border-r md:border-[var(--border)] md:pr-3", mobileDetail && "max-md:hidden")}>
              <div className="flex flex-col gap-1">
                {packages.map((entry) => {
                  const active = entry.manifest.id === selected?.manifest.id;
                  const present = installedById.get(entry.manifest.id);
                  return (
                    <button key={entry.manifest.id} type="button" onClick={() => { setSelectedId(entry.manifest.id); setMobileDetail(true); }} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[var(--sidebar-accent)]", active && "bg-[var(--marinara-chat-chrome-highlight-bg)] ring-1 ring-inset ring-[var(--border)]")}>
                      <div className="mari-panel-gradient-surface mari-panel-gradient--agents flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"><PackageOpen size="1.15rem" /></div>
                      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{entry.manifest.name}</span>{present && <span className="rounded-full bg-[var(--marinara-chat-chrome-highlight-bg)] px-1.5 py-0.5 text-[0.6rem] font-semibold text-[var(--marinara-chat-chrome-highlight-text)]">Installed</span>}</div><p className="mt-0.5 line-clamp-2 text-xs text-[var(--muted-foreground)]">{entry.manifest.description}</p></div>
                    </button>
                  );
                })}
              </div>
            </div>
            {selected && (
              <section className={cn("min-h-0 overflow-y-auto px-1 md:px-6", !mobileDetail && "max-md:hidden")}>
                <button type="button" className="mb-3 flex items-center gap-1 text-sm text-[var(--muted-foreground)] md:hidden" onClick={() => setMobileDetail(false)}><ArrowLeft size="0.9rem" /> All agents</button>
                <div className="flex min-h-full flex-col gap-5 pb-6">
                  <div className="flex items-start gap-4"><div className="mari-panel-gradient-surface mari-panel-gradient--agents flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl"><PackageOpen size="1.65rem" /></div><div className="min-w-0"><h3 className="text-xl font-bold">{selected.manifest.name}</h3><p className="mt-1 max-w-[70ch] text-sm leading-6 text-[var(--muted-foreground)]">{selected.manifest.description}</p><div className="mt-2 flex flex-wrap gap-1.5">{selected.manifest.kind.map((kind) => <span key={kind} className="rounded-full border border-[var(--border)] px-2 py-1 text-[0.68rem]">{kindLabel(kind)}</span>)}</div></div></div>
                  <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-[var(--border)] py-3 text-xs text-[var(--muted-foreground)]"><span className="flex items-center gap-1.5"><HardDrive size="0.8rem" /> {formatBytes(selected.artifact.bytes)}</span><span className="flex items-center gap-1.5"><ShieldCheck size="0.8rem" /> Official verified package</span><span>Version {selected.manifest.version}</span><span>Engine {selected.manifest.engine.min} to below {selected.manifest.engine.maxExclusive}</span></div>
                  <div><h4 className="text-sm font-semibold">Permissions</h4><ul className="mt-2 grid gap-2 sm:grid-cols-2">{selected.manifest.permissions.map((permission) => <li key={permission} className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]"><Check size="0.85rem" className="text-[var(--marinara-chat-chrome-highlight-text)]" /> {permission.replaceAll("-", " ")}</li>)}</ul></div>
                  <div className="mt-auto flex flex-wrap justify-end gap-2 pt-3">
                    {installedById.has(selected.manifest.id) ? (
                      <><button type="button" className="mari-chrome-control mari-chrome-control--danger" disabled={uninstall.isPending} onClick={() => void handleUninstall(selected)}>{uninstall.isPending ? <Loader2 size="0.9rem" className="animate-spin" /> : <Trash2 size="0.9rem" />} Uninstall</button>{installedById.get(selected.manifest.id)?.version !== selected.manifest.version && <button type="button" className="mari-chrome-control mari-chrome-control--primary" disabled={install.isPending} onClick={() => void handleInstall(selected)}><Download size="0.9rem" /> Update</button>}</>
                    ) : <button type="button" className="mari-chrome-control mari-chrome-control--primary" disabled={install.isPending} onClick={() => void handleInstall(selected)}>{install.isPending ? <Loader2 size="0.9rem" className="animate-spin" /> : <Download size="0.9rem" />} Install</button>}
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
