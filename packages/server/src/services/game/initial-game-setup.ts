export function resolveInitialGameGmConnectionId(
  explicitConnectionId: string | null | undefined,
  chatConnectionId: string | null | undefined,
): string | null {
  return explicitConnectionId || chatConnectionId || null;
}
