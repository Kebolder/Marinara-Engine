import { SlashCommandBuilder } from "discord.js";
import type { SlashCommandModule } from "./command.types.js";
import { getBridgeSetupOptions, listThreadBindings } from "../core/marinara-api.js";
import { buildRoleplaySetupComponents } from "../components/roleplay-setup.components.js";
import { buildRoleplaySetupEmbed } from "../embeds/roleplay-setup.embed.js";

export const roleplayCommand: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName("roleplay")
    .setDescription("Set up a Discord thread-backed Marinara roleplay"),
  async execute(interaction, config) {
    await interaction.deferReply();

    const [setup, bindings] = await Promise.all([
      getBridgeSetupOptions(config.serverUrl),
      listThreadBindings(config.serverUrl),
    ]);

    await interaction.editReply({
      embeds: [buildRoleplaySetupEmbed({ setup, bindings })],
      components: buildRoleplaySetupComponents(),
    });
  },
};
