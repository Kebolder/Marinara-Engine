export type LocalNotificationPermission = NotificationPermission | "unsupported";
export type NativeNotificationPermission = "default" | "denied" | "granted" | "unsupported";

type MarinaraAndroidNotificationBridge = {
  getNotificationPermission?: () => string;
  requestNotificationPermission?: () => void;
  showNotification?: (title: string, body: string, tag: string) => void;
};

export type ConversationLocalNotificationOptions = {
  enabled: boolean;
  characterName?: string | null;
  tag?: string;
};

function getBrowserNotificationPermission(): LocalNotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return window.Notification.permission;
}

function getAndroidNotificationBridge(): MarinaraAndroidNotificationBridge | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { MarinaraAndroid?: MarinaraAndroidNotificationBridge }).MarinaraAndroid ?? null;
}

export function hasNativeNotificationBridge(): boolean {
  const bridge = getAndroidNotificationBridge();
  return (
    typeof bridge?.getNotificationPermission === "function" &&
    typeof bridge.requestNotificationPermission === "function" &&
    typeof bridge.showNotification === "function"
  );
}

function normalizeNativePermission(value: string | undefined): NativeNotificationPermission {
  return value === "default" || value === "denied" || value === "granted" ? value : "unsupported";
}

export function getNativeNotificationPermission(): NativeNotificationPermission {
  const bridge = getAndroidNotificationBridge();
  if (typeof bridge?.getNotificationPermission !== "function") return "unsupported";
  return normalizeNativePermission(bridge.getNotificationPermission());
}

export async function requestNativeNotificationPermission(): Promise<NativeNotificationPermission> {
  const bridge = getAndroidNotificationBridge();
  if (typeof bridge?.requestNotificationPermission !== "function") return "unsupported";
  const current = getNativeNotificationPermission();
  if (current === "granted") return current;

  return new Promise((resolve) => {
    const finish = (permission: NativeNotificationPermission) => {
      window.removeEventListener("marinara:native-notification-permission", handlePermission);
      window.clearTimeout(timeoutId);
      resolve(permission);
    };
    const handlePermission = (event: Event) => {
      finish(normalizeNativePermission((event as CustomEvent<string>).detail));
    };
    // Resolve a slow bridge request for the current caller, but leave the one-shot
    // listener installed so a late Android result is still consumed and cleaned up.
    const timeoutId = window.setTimeout(() => resolve(getNativeNotificationPermission()), 30_000);
    window.addEventListener("marinara:native-notification-permission", handlePermission, { once: true });
    bridge.requestNotificationPermission?.();
  });
}

async function requestBrowserNotificationPermission(): Promise<LocalNotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (window.Notification.permission !== "default") return window.Notification.permission;
  return window.Notification.requestPermission();
}

export async function getLocalNotificationPermission(): Promise<LocalNotificationPermission> {
  return getBrowserNotificationPermission();
}

export async function requestLocalNotificationPermission(): Promise<LocalNotificationPermission> {
  return requestBrowserNotificationPermission();
}

function isAppFocusedForNotifications(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && document.hasFocus();
}

export async function showConversationLocalNotification({
  enabled,
  characterName,
  tag,
}: ConversationLocalNotificationOptions): Promise<boolean> {
  if (!enabled || isAppFocusedForNotifications()) return false;
  if (getBrowserNotificationPermission() !== "granted") return false;
  if (typeof window === "undefined" || !("Notification" in window)) return false;

  const name = typeof characterName === "string" && characterName.trim() ? characterName.trim() : "Character";
  const notification = new window.Notification(`New message from ${name.slice(0, 80)}`, {
    body: "Open Marinara to read it.",
    icon: "/icon-192.png",
    tag,
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };

  return true;
}

export function showConversationNativeNotification({
  enabled,
  characterName,
  tag,
}: ConversationLocalNotificationOptions): boolean {
  if (!enabled || isAppFocusedForNotifications()) return false;
  const bridge = getAndroidNotificationBridge();
  if (typeof bridge?.showNotification !== "function" || getNativeNotificationPermission() !== "granted") {
    return false;
  }
  const name = typeof characterName === "string" && characterName.trim() ? characterName.trim() : "Character";
  bridge.showNotification(`New message from ${name.slice(0, 80)}`, "Open Marinara to read it.", tag ?? "message");
  return true;
}
