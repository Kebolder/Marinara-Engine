import { useMemo } from "react";
import type { NoodleAccount } from "@marinara-engine/shared";
import {
  useCharacterGalleryImages,
  usePersonaGalleryImages,
  type CharacterGalleryImage,
  type PersonaGalleryImage,
} from "./use-characters";
import { useCustomEmojis, type CustomEmoji } from "./use-custom-emojis";

type NoodleEmojiGalleryImage = Pick<CharacterGalleryImage | PersonaGalleryImage, "customKind" | "customName" | "url">;

export function mergeNoodleCustomEmojiMap(
  globalEmojis: readonly Pick<CustomEmoji, "name" | "url">[],
  galleries: readonly (readonly NoodleEmojiGalleryImage[])[],
): Map<string, string> {
  const byName = new Map(globalEmojis.map((emoji) => [emoji.name, emoji.url] as const));
  for (const gallery of galleries) {
    for (const image of gallery) {
      if (image.customKind === "emoji" && image.customName) byName.set(image.customName, image.url);
    }
  }
  return byName;
}

export function useNoodleCustomEmojiMap(account: NoodleAccount | null): Map<string, string> {
  const { data: globalEmojis } = useCustomEmojis();
  const { data: characterGallery } = useCharacterGalleryImages(account?.kind === "character" ? account.entityId : null);
  const { data: personaGallery } = usePersonaGalleryImages(account?.kind === "persona" ? account.entityId : null);

  return useMemo(
    () => mergeNoodleCustomEmojiMap(globalEmojis ?? [], [characterGallery ?? [], personaGallery ?? []]),
    [characterGallery, globalEmojis, personaGallery],
  );
}
