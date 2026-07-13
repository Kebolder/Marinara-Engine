import { extensionStoragePatchSchema, type ExtensionStoragePatchInput } from "@marinara-engine/shared";
import type { createAppSettingsStorage } from "../storage/app-settings.storage.js";

const EXTENSION_STORAGE_KEY_PREFIX = "extension-storage:";

type AppSettingsStorage = ReturnType<typeof createAppSettingsStorage>;

function extensionStorageKey(extensionId: string): string {
  return `${EXTENSION_STORAGE_KEY_PREFIX}${extensionId}`;
}

function parseStoredExtensionStorage(raw: string | null): ExtensionStoragePatchInput {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    const validated = extensionStoragePatchSchema.safeParse(parsed);
    return validated.success ? validated.data : {};
  } catch {
    return {};
  }
}

export function createExtensionSettingsStorage(appSettings: AppSettingsStorage) {
  const get = async (extensionId: string): Promise<ExtensionStoragePatchInput> =>
    parseStoredExtensionStorage(await appSettings.get(extensionStorageKey(extensionId)));

  return {
    get,

    async patch(extensionId: string, patch: ExtensionStoragePatchInput): Promise<ExtensionStoragePatchInput> {
      const next = extensionStoragePatchSchema.parse({ ...(await get(extensionId)), ...patch });
      await appSettings.set(extensionStorageKey(extensionId), JSON.stringify(next));
      return next;
    },

    async remove(extensionId: string): Promise<void> {
      await appSettings.remove(extensionStorageKey(extensionId));
    },
  };
}
