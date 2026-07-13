# Agents: AI Helpers for Your Chats

This guide explains what agents are in Marinara Engine, when they run, and how to turn them on for a chat. It covers the **Agents** panel, the per-chat settings, and how to tell when an agent has run. For the full list of built-in agents, see the Related guides at the end.

## What agents are

Agents are small AI helpers that run automatically around your main chat reply. They do focused jobs while you talk to a character. For example, an agent can track the time and weather or pick a character expression. Another agent can rewrite the reply to remove repeated words. Others can generate an image for an important moment.

Agents are turned on per chat, not per character. There is no agent toggle on a character card. Two chats with the same character can run completely different agents. You choose which agents run in each chat's settings.

Marinara Engine ships many built-in agents, and you can also build your own. This guide is the overview. For the per-agent list of what each one does, see [Built-in Agents Reference](built-in-agents.md). To make your own, see [Creating Custom Agents](custom-agents.md).

## The three phases

Every agent runs at one of three points around your reply. This point is called the agent's **pipeline phase**. You set it in the agent editor, and each built-in agent already has a sensible default.

- **Pre-Generation**: runs before the AI writes its reply. It can add helpful context to the prompt first. Knowledge lookup agents run here.
- **Parallel**: runs at the same time as the reply. It does not wait for the reply and cannot change it. A live audience reaction agent runs here.
- **Post-Processing**: runs after the reply is finished. It can read the reply and, for rewrite agents, edit it. Most trackers, the prose cleanup agent, and the image agent run here.

## The Agents panel

Open the **Agents** panel from the right-side panel tabs (the Sparkles icon). Here you browse, create, and organize agents. This is your library. It is not the on or off switch for a single chat.

The panel groups built-in agents into **Writer Agents**, **Tracker Agents**, and **Misc Agents**, plus a **Custom Agents** section for ones you make. Each agent card shows its name, a short description, and its category. You can search agents, sort them, make folders, and import or export agent packages.

Deleting a built-in agent only hides it from the library and the chat pickers. It does not remove the feature from the app. Deleting a custom agent removes it for good.

## Enabling agents for a chat

You turn agents on inside each chat, in the **Chat Settings** drawer.

1. Open the chat you want.
2. Open **Chat Settings** (the gear).
3. Find the **Agents** section.
4. Turn on **Enable Agents**. This is the master switch. When it is off, no agent runs for this chat.
5. Add the agents you want from the lists below the switch, or remove ones you do not want.

You should see the agents you added listed as active, each with a small remove button.

The **Agents** section has a few more controls:

- **Review Agent Outputs**: when on, lorebook, summary, and character card changes wait for your approval before they save. When off, lorebook and summary changes can save on their own, but character card edits still ask you first. See [Agent Approvals and the Agent Suite](approvals-and-agent-suite.md).
- **Manual Trackers** (Roleplay chats only): when on, tracker agents do not run after every reply. You trigger them by hand from a button in the HUD. HUD means heads-up display, the on-screen status overlay in Roleplay.
- **Agent Suite**: opens a viewer where you can read and edit everything the agents have stored for this chat.

### The cost warning

Agents cost extra tokens and extra model calls. Each agent adds its own instructions, and often its own model call. Marinara groups agents that share the same connection into one call when it can. Above the agent list, a readout estimates the load for your current setup. It shows about how many tokens of agent instructions you added and about how many extra calls happen per turn.

This readout turns amber with a warning icon when the load gets heavy. The real cost per turn is higher than the number shown. Your chat history and character details are sent with each call. If you see the warning, remove agents you do not need, or move some to a cheaper or local connection.

## Which agents each mode starts with

Every built-in agent is off by default. To save you setup, Roleplay chats switch on a small starter set when you create the chat. Each chat mode also limits which agents you can add.

- **Roleplay**: a new chat starts with **World State**, **Prose Guardian**, **Continuity Checker**, and **Expression Engine** active. You can add any other built-in agent that supports Roleplay.
- **Conversation**: no built-in agents run by default or appear in the picker. You can still attach your own custom agents.
- **Game Mode**: the normal agent picker is hidden. Game Mode has its own built-in world, quest, and combat systems, so Roleplay agents stay out of the way. Instead, Game Mode gives you toggles for **Game Session Keeper** and **Music DJ**, and you can still attach your own custom agents.

You can add or remove agents at any time, so the starter set is only a starting point.

## Telling whether an agent ran

Some agents change something you can see right away. Others work quietly. Here is how to check.

- Tracker agents write into the HUD and the tracker panels. If the time, location, mood, or stats updated, a tracker agent ran.
- A floating status overlay shows short thinking messages from agents while they work, so you can watch them run in real time.
- The **Prose Guardian** and **Continuity Checker** agents change the reply text itself. A cleaned-up or corrected reply is a sign they ran.
- For a full trace, turn on **Debug mode** in **Settings**, then **Advanced**, then **Message Tools**. It logs the prompt and response for each agent to the server console. It also shows an **Agent Debug** overlay with per-agent calls, tokens, and timing.

Did an agent you expected not run? Check that **Enable Agents** is on. Check that the agent is active for this chat. Check that your chat mode allows it.

## Related guides

- [Built-in Agents Reference](built-in-agents.md)
- [Creating Custom Agents](custom-agents.md)
- [Agent Approvals and the Agent Suite](approvals-and-agent-suite.md)
- [Roleplay HUD and Trackers](../roleplay/hud-and-trackers.md)
