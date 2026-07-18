export const CAPABILITY_CLIENT_EVENT = "marinara-capability-server-event";

export interface CapabilityClientEventDetail {
  packageId: string;
  type: string;
  chatId: string;
  data: unknown;
}

export function dispatchCapabilityClientEvent(detail: CapabilityClientEventDetail) {
  window.dispatchEvent(new CustomEvent<CapabilityClientEventDetail>(CAPABILITY_CLIENT_EVENT, { detail }));
}
