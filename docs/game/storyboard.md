# Storyboard Engine Guide

This guide explains storyboards in Marinara Engine. A storyboard turns one finished Game Mode turn into a short run of keyframe images. It can also add short animated clips, including continuous anime-style shots. The turn then reads like a mini cutscene. Storyboards are a Game Mode feature only. They do not exist in Roleplay or Conversation chats.

## What storyboards are

Game Mode is the chat mode where an AI Game Master (GM) narrates a turn-based adventure. When the GM finishes a narration turn, the Storyboard Engine can illustrate that single turn.

Marinara reads the GM narration and splits it into a short run of ordered keyframes. Each keyframe is one picture of a moment in the turn. A storyboard holds 1 to 6 keyframes. The default is 3.

Each keyframe is tied to a range of the turn's text. These text ranges are called reader sections. As you read down the turn, a small viewer shows the keyframe that matches your current spot in the text.

Before it plans the images, Marinara strips the turn's GM command tags. GM command tags are hidden instruction tags in a GM message, such as dice rolls or game-state updates. They are removed so they do not show up in the picture.

Keyframe still images are saved in the **Gallery**, under the **Images** tab. Keyframe clips are saved as scene videos, under the **Videos** tab. Because they are normal Gallery items, you can preview, download, pin, or copy the prompt of any keyframe on its own.

## Before you start

You need a few things set up before a storyboard can render.

1. A Game Mode chat. This feature only works in Game Mode.
2. A working image connection for the game's illustrator. Set it in either place. You only need one:
   - Existing game: open **Chat Settings**, go to **Agents**, then the **Illustrator** card. Turn on **Game Illustrator** and pick an **Image Connection**.
   - New game: in the setup wizard, turn on **Visual Generation** and pick an **Image Generation Connection**.
3. A strong, recent image model is recommended. The app suggests a state-of-the-art image model, or something equivalent to Google Nano Banana 2 Lite.

For animated clips, you also need a video connection. See the animation steps below.

If you have no image connection set, a storyboard request fails with this message: "Choose an Illustrator image connection in Game Settings first."

For steady character looks across keyframes, use character cards with avatars, and turn on **Send Avatar References** in the **Illustrator** card. This sends each character's avatar as a reference image.

## Quick start

1. Open or create a Game Mode chat.
2. Set up the image connection as shown in the section above.
3. Play until the GM finishes a narration turn.
4. Open the **Gallery** panel.
5. Click **Create storyboard**. The button shows **Creating...** with a spinner while it runs.
6. Keep reading the turn. The floating viewer appears and switches keyframes as you read.

If you close the viewer, reopen it. In the **Gallery** panel, click **View storyboard**.

While a storyboard is generating, the **Gallery** shows this banner: "Storyboard generation is running. Keyframes will appear in the game storyboard viewer when ready."

## Automatic and manual storyboards

You can make storyboards by hand, or have Marinara make them for you.

Manual is the **Create storyboard** button in the **Gallery**. It builds a storyboard for the latest finished GM narration turn, only when you ask. You can also use it to refresh or re-illustrate the current turn, even when automatic storyboards are off.

Automatic storyboards are set per chat. Find the controls in either place:

- New game: setup wizard, **Visual Generation**, then the **Storyboards** subsection.
- Existing game: **Chat Settings**, **Agents**, then the **Storyboards** card.

**Automatic Storyboard Illustrations** makes still keyframe images after each finished GM turn, with no clicks from you. This is the lower-cost path. For a new game created through the wizard, this is on by default once **Visual Generation** is enabled. It has no effect until **Game Illustrator** is set up.

**Automatic Storyboard Animations** also makes an MP4 clip for each keyframe. This is off by default. It needs still illustrations plus a video connection. Turning animations on also turns illustrations on. Turning illustrations off turns animations off.

To set up clips:

1. Create a **Video Generation** connection in **Settings**, then **Connections**.
2. Select it in the wizard's **Video Generation Connection** field, or in **Chat Settings**, **Agents**, **Scene Videos**, then **Video Connection**.
3. Turn on **Automatic Storyboard Animations**.

If you turn on animations without a video connection, the wizard warns you: "Choose a Video Generation connection below to save automatic storyboard animations."

A storyboard usually creates 3 image jobs, one per keyframe. With animations on, it also creates up to 3 video jobs. The number follows **Keyframes per Turn**, so choosing 5 can mean 5 image jobs and up to 5 video jobs. Video jobs are much slower and cost more. Start with still illustrations, and add animations only for chats where the wait and cost are fine.

## Storyboard settings

All of these live in the **Storyboards** card. Open **Chat Settings**, go to **Agents**, then **Storyboards**.

| Setting | Default | What it does |
| --- | --- | --- |
| **Automatic Storyboard Illustrations** | On for new wizard games with Visual Generation; else off | Makes still keyframes after each GM turn |
| **Automatic Storyboard Animations** | Off | Adds an MP4 clip per keyframe; needs a video connection |
| **Keyframes per Turn** | 3 (range 1 to 6) | How many keyframes each turn plans |
| **Animation Clip Duration** | 6 seconds (range 1 to 15) | Length of each clip |
| **Viewer Display** | Floating | Floating panel or full background |
| **Illustration Prompt** | Still Keyframes | Style preset for still-only storyboards |
| **Animation Prompt** | Comic Page | Style preset when animations are on |
| **Storyboard Video Prompt** | Same as Game Video Prompt | Motion prompt used only for storyboard keyframe clips |

**Keyframes per Turn** is a slider. The engine tries to plan this many keyframes. A short turn may get fewer. It never plans more than 6.

**Animation Clip Duration** is a number of seconds. It is greyed out unless **Automatic Storyboard Animations** is on. Until you set a value, it uses the 6-second default and shows a **Storyboard default** pill. Once you set your own value, a **Use storyboard default** button appears to clear it. Some video providers may clamp your value to a lower maximum, so the exact length is not promised.

In **Background** viewer mode, each animation starts once with sound when its story beat becomes active. Narration can display while it plays, but narration auto-play waits for the clip to finish. The animation then stays paused on its final frame. The game toolbar provides replay, play/pause, and mute controls on desktop and mobile. Floating storyboard videos also play once and can be replayed instead of looping indefinitely.

**Storyboard Video Prompt** is separate from the general **Game Video Prompt** in the **Scene Videos** card. Leave it on the inherited choice to reuse the general prompt, or select **Anime Game Video** for keyframe clips without changing manual Gallery or Game Assets videos.

Select **Comic Page Animation** for the duration-aware comic source pages, then choose **Comic Page Video** to interpret those panels as ordered visual reference beats for one clip. The original **Comic Page** remains available for ordinary illustrations. The separate video choice leaves the inherited **Game Video Prompt** plus manual Gallery and Game Assets videos unchanged.

New games created with the **Anime Episode** presentation select **Comic Page Animation** and **Comic Page Video** by default. You can switch that chat to the still-shot combination at any time by selecting **Anime Episode Director** and **Anime Game Video**.

## Style presets

The style presets shape how each keyframe looks. Two selectors pick them:

- **Illustration Prompt** is used when storyboards make still keyframes without videos. Default: **Still Keyframes**.
- **Animation Prompt** is used when **Automatic Storyboard Animations** is on. Default: **Comic Page**.

There are seven built-in presets. They are for Game Mode storyboards only. They are separate from Roleplay illustrator presets.

| Preset | Best for |
| --- | --- |
| **Still Keyframes** | Normal reading. Single-scene keyframes. Avoids comic panels, speech bubbles, captions, and SFX text, so the viewer does not spoil later beats. |
| **NovelAI Keyframes** | Compact tag prompts tuned for NovelAI V4 and V4.5. Best paired with **Use Storyboard Prompt Directly**. |
| **Anime Episode Director** | Ordered, animation-ready single shots. It plans the exact first frame, one main movement, simple camera behavior, environmental motion, and an ending hold. |
| **Comic Page** | Original comic-page illustration prompt with 2-6 panels, dialogue bubbles, captions, and lettering. |
| **Comic Page Animation** | Duration-aware comic source pages for animation. Each page uses a small number of chronological panels as ordered visual references for one clip. |
| **Colored Manga** | Colored manga staging, cell shading, screentones, speech bubbles, and SFX. |
| **B&W Manga** | Black-and-white manga inks, screentones, heavy blacks, speech bubbles, and SFX. |

The **Anime Episode Director** pairs with **Anime Game Video** and **Use Storyboard Prompt Directly** when you want the generated still to be the exact first frame of a continuous clip. The director keeps severe violence non-graphic and stages it through anticipation, obstruction, reaction, or aftermath where possible, which can reduce provider safety rejections without changing the GM's canonical story.

The **Comic Page Animation** preset uses the animation clip duration to control page density. It defaults to 2 panels for a 6-7 second clip, allowing a third only for three simple beats with about 2 seconds each; it uses 2-3 panels for 8-10 seconds and no more than 4 for longer clips. Animation pages prioritize visual timing over comic lettering, keep each panel focused, and reserve a short ending hold. Panels follow cause and effect in reading order. **Comic Page Video** normally enters panel 1 immediately; it permits only a very brief full-page establish when doing so cannot reveal a later consequence early.

The **NovelAI Keyframes** preset writes compact Danbooru tags. Danbooru tags are short comma-separated keyword tags that some anime image models expect. Choosing an animation, comic, or manga preset does not turn animations on by itself. You still need **Automatic Storyboard Animations** and a video connection for clips.

## Editing storyboard presets

The built-in presets are read-only. To make your own, open the **Edit Storyboard Presets** section inside the **Storyboards** card. It shows a count of your custom copies.

You copy a built-in into a chat-only editable template, then pick that copy in either selector. The copy controls include the built-in still, anime episode, comic illustration, comic animation, NovelAI, colored manga, and black-and-white manga templates. **Edit Video Presets** likewise offers copies of Cinematic Scene Video, Anime Game Video, and Comic Page Video for either video selector.

Each custom copy has a name, a short description, and the prompt body you edit. A trash button removes a copy after a confirm dialog. These copies are stored on that one chat, not across your whole app.

## The storyboard viewer

The viewer follows your reading position. It shows the keyframe whose reader section matches where you are in the turn text. It is not just "the newest Gallery image." There are two display styles, set by **Viewer Display**.

**Floating** is the default. A small draggable panel sits above the game. Its header reads **Storyboard**. It plays the keyframe's video when ready, and falls back to the image while a clip is pending or failed.

The floating viewer has these controls:

- **Close storyboard viewer** hides the panel for the current turn only. It reappears when the next GM turn finishes. A page refresh also clears the hide.
- **Drag storyboard viewer** is the header handle. Drag the panel anywhere on screen.
- **Play storyboard video** and **Pause storyboard video** control clip playback. Clips start muted.
- **Mute storyboard video** and **Unmute storyboard video** show only when the keyframe has a rendered clip.
- **Change storyboard viewer size** cycles three widths: small, medium (the default), and large.
- A corner handle resizes the panel freely and overrides the size preset.

**Background** fills the whole game surface with the active keyframe instead of a floating card. The image or clip sits behind the game controls. It uses the same reading-position logic as the floating viewer.

Background mode has a trade-off. It turns off Marinara's normal generated scene location background. While it is on, the **Generate background** button in the illustrator popover is disabled. The button shows this note: "Storyboard background display is active, so scene background generation is disabled."

## Getting better results

A storyboard is only as clear as the turn it reads. The best turns name who moves, what changes, and where the key moment is. A vague turn like "the fight continues" gives the engine less to draw than a turn with concrete action and setting details.

For steadier results:

- Keep the game's setting, tone, and art style specific during setup.
- Use character cards with detailed avatars, and turn on **Send Avatar References**.
- Keep important outfits, wounds, props, and locations clear in the narration.
- Use image style profiles for the finish you want.
- Use **Still Keyframes** for normal reading, and a comic or manga preset when clips are on.

## NovelAI options

Two toggles help official NovelAI storyboards. Both are in the **Storyboards** card.

**Use Storyboard Prompt Directly** sends each keyframe's image prompt to the image model with only global style tags added. This is off by default. It skips the extra prompt-wrapping and tag rewriting Marinara normally applies. Pair it with the **NovelAI Keyframes** preset for the cleanest NovelAI request.

**Use NovelAI Character Prompts** sends each visible character through native NovelAI Add Character captions and positions. This is on by default. Important: it only takes effect for an official NovelAI connection using a V4 or V4.5 model on novelai.net. For any other provider or model, the toggle does nothing, and Marinara uses the shared legacy prompt instead.

## Troubleshooting

**"Choose an Illustrator image connection in Game Settings first."** Open **Chat Settings**, **Agents**, then the **Illustrator** card. Turn on **Game Illustrator** and pick an **Image Connection**. For a new game, enable **Visual Generation** and pick an **Image Generation Connection** in the setup wizard.

**"Storyboards can only be generated from GM narration turns."** **Create storyboard** only works on a finished GM narration turn. It does not work on your own player messages. Wait for the GM's reply to finish, then try again.

**"This GM turn has no narration to storyboard."** The turn has no story text to draw. This happens when a GM turn holds only hidden command tags and no narration. Play on until the GM writes a turn with story text, then storyboard that one.

**Images appear, but no videos.** Videos need both **Automatic Storyboard Animations** on and a **Video Generation** connection selected. With animations off, storyboards make still keyframes only.

**Automatic storyboards do not run.** Check that **Automatic Storyboard Illustrations** or **Automatic Storyboard Animations** is on. Check that the image connection is set and the GM turn has finished streaming. Marinara will not make a second storyboard for a turn that already has one. You can still remake it by hand with **Create storyboard** in the **Gallery**.

**The storyboard is partial or stuck.** This usually means one or more image or video jobs failed, timed out, or hit a provider rate limit. Prohibited content can also block a job. If a provider is slow, raise the image and video generation timeouts in your `.env` file, then restart Marinara. See the [configuration guide](../CONFIGURATION.md) for the exact variable names.

For deeper diagnosis, set your log level to debug and watch the server log. The storyboard log lines are tagged `[debug/game/storyboard-illustrator]`, `[debug/game/storyboard-image-assets]`, and `[debug/game/storyboard-video]`.

## Related guides

- [Scene Video Generation](../media/scene-video.md)
- [Image Generation Providers](../media/image-providers.md)
- [Game Mode: Getting Started](getting-started.md)
