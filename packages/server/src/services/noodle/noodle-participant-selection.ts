import type { NoodleAccount, NoodleSettings } from "@marinara-engine/shared";

type RandomSource = () => number;

function shuffleWith<T>(items: readonly T[], random: RandomSource): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const raw = random();
    const normalized = Number.isFinite(raw) ? Math.min(0.999_999, Math.max(0, raw)) : 0.5;
    const selected = Math.floor(normalized * (index + 1));
    [next[index], next[selected]] = [next[selected]!, next[index]!];
  }
  return next;
}

export function chooseNoodleParticipantAccounts(input: {
  accounts: NoodleAccount[];
  settings: NoodleSettings;
  selectedGroupCharacterIds: ReadonlySet<string>;
  followedAccountIds?: ReadonlySet<string>;
  recentlyActiveAccountIds?: ReadonlySet<string>;
  priorityAccountIds?: ReadonlySet<string>;
  random?: RandomSource;
}): NoodleAccount[] {
  const random = input.random ?? Math.random;
  const followedAccountIds = input.followedAccountIds ?? new Set<string>();
  const recentlyActiveAccountIds = input.recentlyActiveAccountIds ?? new Set<string>();
  const priorityAccountIds = input.priorityAccountIds ?? new Set<string>();
  const candidates = input.accounts.filter((account) => {
    if (account.kind === "character") {
      return account.invited || input.selectedGroupCharacterIds.has(account.entityId);
    }
    return account.kind === "random_user" && input.settings.allowRandomUsers;
  });
  if (input.settings.participantSelectionMode === "all") return candidates;

  const min = Math.min(input.settings.participantMin, input.settings.participantMax, candidates.length);
  const max = Math.min(Math.max(input.settings.participantMin, input.settings.participantMax), candidates.length);
  const count =
    input.settings.participantSelectionMode === "exact" ? max : min + Math.floor(random() * Math.max(1, max - min + 1));

  const priority = candidates.filter((account) => priorityAccountIds.has(account.id));
  const ordinary = candidates.filter((account) => !priorityAccountIds.has(account.id));
  const inactiveFollowed = ordinary.filter(
    (account) => followedAccountIds.has(account.id) && !recentlyActiveAccountIds.has(account.id),
  );
  const inactiveOthers = ordinary.filter(
    (account) => !followedAccountIds.has(account.id) && !recentlyActiveAccountIds.has(account.id),
  );
  const recentFollowed = ordinary.filter(
    (account) => followedAccountIds.has(account.id) && recentlyActiveAccountIds.has(account.id),
  );
  const recentOthers = ordinary.filter(
    (account) => !followedAccountIds.has(account.id) && recentlyActiveAccountIds.has(account.id),
  );

  return [
    ...shuffleWith(priority, random),
    ...shuffleWith(inactiveFollowed, random),
    ...shuffleWith(inactiveOthers, random),
    ...shuffleWith(recentFollowed, random),
    ...shuffleWith(recentOthers, random),
  ].slice(0, count);
}
