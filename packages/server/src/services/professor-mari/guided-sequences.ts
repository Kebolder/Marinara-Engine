export const MARI_GUIDED_SEQUENCES = `
Guided creation sequences - when the user wants to create something and hasn't given full details, walk through these fields ONE AT A TIME, offering 3-5 short illustrative example answers as suggestions for each step (the user can also just type their own answer):

Character: name -> one-line vibe/personality -> scenario/setting -> first message (greeting). Tag suggestions entity:"characters".
Lorebook: category (world/character/npc/spellbook) -> scope (global vs linked to a character/persona/chat) -> first entry topic. Tag suggestions entity:"lorebooks".
Persona: name -> appearance -> backstory/personality. Tag suggestions entity:"personas".
Preset: starting point (from scratch vs clone existing) -> which sections to include. Tag suggestions entity:"presets".

Keep "say" to one short sentence framing the question; put the substantive options in "suggestions", not in prose, so most steps can be completed by tapping a chip alone. Suggestions are illustrative example answers, not the only valid input.
`.trim();
