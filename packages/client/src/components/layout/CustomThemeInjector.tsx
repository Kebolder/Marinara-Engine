// ──────────────────────────────────────────────
// CustomThemeInjector: Injects active custom theme
// CSS and enabled extension CSS/JS into the DOM
// ──────────────────────────────────────────────
import { useEffect, useMemo } from "react";
import { useThemes } from "../../hooks/use-themes";
import { useExtensions } from "../../hooks/use-extensions";
import { sanitizeAppCss } from "../../lib/theme-css";
import { useUIStore } from "../../stores/ui.store";

type ExtensionGlobal = typeof globalThis & {
  __marinaraExtensionApis?: Map<string, unknown>;
};

const EXTENSION_STYLE_PREFIX = "marinara-ext-";
const EXTENSION_JS_STYLE_PREFIX = "marinara-ext-js-style-";

type InjectableExtension = {
  id: string;
  name: string;
  css?: string | null;
  js?: string | null;
  enabled: boolean;
};

function getExtensionGlobal() {
  return globalThis as ExtensionGlobal;
}

function sanitizeExtensionSourceName(name: string) {
  return (
    name
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "extension"
  );
}

function buildExtensionModuleSource(apiKey: string, extensionName: string, js: string) {
  const sourceName = sanitizeExtensionSourceName(extensionName);
  return [
    `const marinara = globalThis.__marinaraExtensionApis?.get(${JSON.stringify(apiKey)});`,
    `if (!marinara) throw new Error("Extension API is no longer available.");`,
    `const executeExtension = function(marinara) {`,
    js,
    `};`,
    // Bind `this` to globalThis so classic-script-style extensions that rely on
    // `this === window` (e.g. for top-level `this.foo = bar` global assignment)
    // still work under module strict mode.
    `executeExtension.call(globalThis, marinara);`,
    `export {};`,
    `//# sourceURL=marinara-extension-${sourceName}.js`,
  ].join("\n");
}

function ExtensionCssInjector({ ext }: { ext: InjectableExtension }) {
  useEffect(() => {
    const id = `${EXTENSION_STYLE_PREFIX}${ext.id}`;
    const existing = document.getElementById(id);

    if (!ext.enabled || !ext.css) {
      existing?.remove();
      return;
    }

    const style = (existing as HTMLStyleElement | null) ?? document.createElement("style");
    style.id = id;
    style.textContent = sanitizeAppCss(ext.css);
    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  }, [ext.css, ext.enabled, ext.id]);

  return null;
}

function ExtensionScriptRunner({ ext }: { ext: InjectableExtension }) {
  useEffect(() => {
    if (!ext.enabled || !ext.js) return;

    const extensionCleanups: Array<() => void> = [];
    const extensionGlobal = getExtensionGlobal();
    const apiKey = `${ext.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let disposed = false;
    let objectUrl: string | null = null;

    const logExtensionError = (label: string, error: unknown) => {
      console.error(`[Extension:${ext.name}] ${label}:`, error);
    };

    const runExtensionCleanups = () => {
      const cleanups = extensionCleanups.splice(0);
      cleanups.forEach((cleanup) => {
        try {
          cleanup();
        } catch (e) {
          console.warn(`[Extension:${ext.name}] Cleanup error:`, e);
        }
      });
    };

    const revokeObjectUrl = () => {
      if (!objectUrl) return;
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };

    const cleanupExtension = () => {
      disposed = true;
      revokeObjectUrl();
      extensionGlobal.__marinaraExtensionApis?.delete(apiKey);
      runExtensionCleanups();
    };

    const wrapCallback = <Args extends unknown[]>(label: string, fn: (...args: Args) => void) => {
      return (...args: Args) => {
        try {
          fn(...args);
        } catch (e) {
          logExtensionError(label, e);
        }
      };
    };

    try {
      // Extension API passed to JS extensions
      const extensionAPI = {
        extensionId: ext.id,
        extensionName: ext.name,

        // Inject CSS with auto-cleanup
        addStyle: (css: string) => {
          const style = document.createElement("style");
          style.id = `${EXTENSION_JS_STYLE_PREFIX}${ext.id}-${Date.now()}`;
          style.textContent = sanitizeAppCss(css);
          document.head.appendChild(style);
          extensionCleanups.push(() => style.remove());
          return style;
        },

        // Inject DOM element with auto-cleanup
        addElement: (parent: Element | string, tag: string, attrs?: Record<string, string>) => {
          const target = typeof parent === "string" ? document.querySelector(parent) : parent;
          if (!target) return null;
          const el = document.createElement(tag);
          if (attrs) {
            Object.entries(attrs).forEach(([k, v]) => {
              if (k === "innerHTML") el.innerHTML = v;
              else if (k === "textContent") el.textContent = v;
              else el.setAttribute(k, v);
            });
          }
          target.appendChild(el);
          extensionCleanups.push(() => el.remove());
          return el;
        },

        // Fetch from Marinara API
        // Deny extensions from calling sensitive endpoints. Without this,
        // a malicious extension could `apiFetch("/extensions", { method: "POST", ... })`
        // to re-install itself after the user deletes it, or hit `/admin/*`
        // privileged routes. The denylist runs on the *canonical* pathname
        // produced by the WHATWG URL parser, so `%2e%2e/admin` and other
        // dot-segment / encoded-traversal payloads can't sneak past.
        apiFetch: async (path: string, options?: RequestInit) => {
          const normalized = path.startsWith("/") ? path : `/${path}`;
          const url = new URL(`/api${normalized}`, window.location.origin);
          const apiPath = url.pathname.replace(/^\/api(?=\/|$)/, "");
          const denied =
            apiPath === "/extensions" ||
            apiPath.startsWith("/extensions/") ||
            apiPath === "/admin" ||
            apiPath.startsWith("/admin/");
          if (denied) {
            const message = `apiFetch denied: extensions cannot reach ${apiPath}`;
            console.warn(`[Extension:${ext.name}] ${message}`);
            return Promise.reject(new Error(message));
          }
          const res = await fetch(`${url.pathname}${url.search}`, {
            headers: { "Content-Type": "application/json" },
            ...options,
          });
          return res.json();
        },

        // addEventListener with auto-cleanup
        on: (target: EventTarget, event: string, handler: EventListenerOrEventListenerObject) => {
          const wrapped =
            typeof handler === "function"
              ? wrapCallback<[Event]>(`Event handler "${event}" error`, (eventObject) => {
                  handler.call(target, eventObject);
                })
              : {
                  handleEvent: wrapCallback<[Event]>(`Event handler "${event}" error`, (eventObject) => {
                    handler.handleEvent(eventObject);
                  }),
                };
          target.addEventListener(event, wrapped);
          extensionCleanups.push(() => target.removeEventListener(event, wrapped));
        },

        // setInterval with auto-cleanup
        setInterval: (fn: () => void, ms: number) => {
          const wrapped = wrapCallback("Interval handler error", fn);
          const id = window.setInterval(wrapped, ms);
          extensionCleanups.push(() => window.clearInterval(id));
          return id;
        },

        // setTimeout with auto-cleanup
        setTimeout: (fn: () => void, ms: number) => {
          const wrapped = wrapCallback("Timeout handler error", fn);
          const id = window.setTimeout(wrapped, ms);
          extensionCleanups.push(() => window.clearTimeout(id));
          return id;
        },

        // MutationObserver with auto-cleanup
        observe: (target: Element | string, callback: MutationCallback, options?: MutationObserverInit) => {
          const el = typeof target === "string" ? document.querySelector(target) : target;
          if (!el) return null;
          const wrapped = wrapCallback<[MutationRecord[], MutationObserver]>("Mutation observer error", callback);
          const observer = new MutationObserver(wrapped);
          observer.observe(el, options || { childList: true, subtree: true });
          extensionCleanups.push(() => observer.disconnect());
          return observer;
        },

        // Register a cleanup function manually
        onCleanup: (fn: () => void) => {
          if (disposed) {
            try {
              fn();
            } catch (e) {
              logExtensionError("Cleanup error", e);
            }
            return;
          }
          extensionCleanups.push(fn);
        },
      };

      extensionGlobal.__marinaraExtensionApis ??= new Map();
      extensionGlobal.__marinaraExtensionApis.set(apiKey, extensionAPI);

      const moduleSource = buildExtensionModuleSource(apiKey, ext.name, ext.js);
      const blob = new Blob([moduleSource], { type: "text/javascript" });
      objectUrl = URL.createObjectURL(blob);

      void import(/* @vite-ignore */ objectUrl)
        .catch((e) => {
          if (!disposed) {
            logExtensionError("Failed to execute", e);
            runExtensionCleanups();
          }
        })
        .finally(() => {
          revokeObjectUrl();
          extensionGlobal.__marinaraExtensionApis?.delete(apiKey);
        });
    } catch (e) {
      logExtensionError("Failed to execute", e);
      runExtensionCleanups();
      extensionGlobal.__marinaraExtensionApis?.delete(apiKey);
    }

    return cleanupExtension;
  }, [ext.enabled, ext.id, ext.js, ext.name]);

  return null;
}

export function CustomThemeInjector() {
  const { data: serverExtensions = [] } = useExtensions();
  const legacyExtensions = useUIStore((s) => s.installedExtensions);
  const hasMigrated = useUIStore((s) => s.hasMigratedExtensionsToServer);
  // Until the legacy localStorage list has been migrated, fall back to it so
  // users with pre-PR extensions don't see them vanish during the brief window
  // between app boot and `useLegacyExtensionMigration` finishing.
  const installedExtensions = useMemo(
    () => (hasMigrated ? serverExtensions : legacyExtensions),
    [hasMigrated, serverExtensions, legacyExtensions],
  );
  const { data: syncedThemes = [] } = useThemes();
  const activeTheme = syncedThemes.find((theme) => theme.isActive) ?? null;

  // Inject active custom theme CSS
  useEffect(() => {
    const id = "marinara-custom-theme";
    let style = document.getElementById(id) as HTMLStyleElement | null;

    if (!activeTheme) {
      style?.remove();
      return;
    }

    if (!style) {
      style = document.createElement("style");
      style.id = id;
      document.head.appendChild(style);
    }
    style.textContent = sanitizeAppCss(activeTheme.css);

    return () => {
      style?.remove();
    };
  }, [activeTheme]);

  return (
    <>
      {installedExtensions.map((ext) => (
        <ExtensionCssInjector key={`css-${ext.id}`} ext={ext} />
      ))}
      {installedExtensions.map((ext) => (
        <ExtensionScriptRunner key={`js-${ext.id}`} ext={ext} />
      ))}
    </>
  );
}
