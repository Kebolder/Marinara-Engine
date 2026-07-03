# Scene Video Generation

Marinara can turn Game Mode and Roleplay gallery illustrations into short MP4 scene videos. The first version is manual-first: generate or upload an illustration, then use the Gallery **Video** action or an illustration's **Animate** button to create a clip from that specific image.

Scene videos are separate from normal image generation. They use a **Video Generation** connection, save MP4 files in the scene-video media store, appear in the Gallery, and can be pinned or followed with the same overlay controls as generated illustrations.

## Setup

1. Open **Settings -> Connections**.
2. Create or edit a connection with provider **Video Generation**.
3. Pick a video service:
   - **Gemini Omni** uses `gemini-omni-flash-preview` by default through Google AI Studio's Gemini API.
   - **xAI Imagine** uses `grok-imagine-video-1.5` by default through the xAI Videos API.
4. Enter the provider API key and save the connection.
5. Optional: enable **Use as default scene video connection** so new/manual scene-video requests can fall back to this connection when the chat has no explicit video connection selected.

Video generation connections have their own defaults. Gemini Omni exposes duration and aspect ratio; duration is rendered into the prompt because Gemini Omni does not currently accept `duration_seconds` in `generation_config.video_config`. xAI exposes duration, aspect ratio, and resolution.

Default values:

| Service | Duration | Aspect ratio | Resolution |
| --- | --- | --- | --- |
| Gemini Omni | 10s | 16:9 | Provider default |
| xAI Imagine | 10s | 16:9 | 720p |

## Chat Settings

Video connections are selected separately from image-generation connections.

- **Game Mode setup wizard:** choose **Video Generation Connection** on the model/setup step when creating the game.
- **Existing Game Mode chats:** open **Chat Settings -> Agents -> Scene Videos** and choose **Video Connection**.
- **Roleplay and Visual Novel chats:** open **Chat Settings -> Agents -> Scene Videos** and choose **Video Connection**.

If a chat does not have a selected video connection, Marinara tries the connection marked **Default for Scene Videos** in Connections. If neither exists, Gallery video actions show a connection warning.

## Gallery Workflow

The Gallery now has three top actions when the mode supports them:

- **Illustrate** generates a still scene illustration.
- **Video** animates the latest generated scene illustration.
- **Background** generates or applies a scene background.

Each illustration tile also has an **Animate** button beside Pin and Download. Use it when you want to animate that exact illustration instead of the newest gallery item.

Generated videos:

- appear under **Scene videos** in the Gallery,
- open in a fullscreen preview when clicked,
- show their generation prompt below the video,
- include a **Copy prompt** button,
- can be downloaded,
- can be pinned to the chat surface,
- participate in **View latest**.

## View Latest And Pinning

**View latest** is a live viewer for the newest Gallery media item. When enabled, it updates automatically whenever a new illustration or scene video is added to the Gallery.

Pinned videos use the same move and resize model as pinned illustrations. Drag the pinned media to reposition it and use the overlay controls to resize, unpin, or close it. The static illustration remains available as a fallback when a video is pending or fails.

## Prompt Templates

Open **Settings -> Advanced -> Game Prompt Templates** to edit the reusable prompt templates used by scene media.

The relevant keys are:

| Key | Purpose |
| --- | --- |
| `game.narrationSummarizer` | Converts completed Game Mode narration into a concise illustration request before scene illustration prompting. |
| `game.sceneIllustration` | Builds the still visual novel/game scene illustration prompt. |
| `game.video` | Builds the motion/camera/timing prompt for scene-video generation. |

`game.video` receives variables such as scene title, narration summary, source illustration prompt, characters, setting, art style, duration seconds, aspect ratio, and a reminder that the source illustration is used as the first frame/reference. Editing this template is the main way to prompt-engineer different motion outcomes without changing code.

Before rendering the template, Marinara compacts the video prompt context. The narration variable is a short visible story beat, not the full assistant message, and the illustration prompt variable is a filtered excerpt that drops common still-image boilerplate. xAI receives a stricter final prompt budget than Gemini because its video API rejects prompts over its maximum length.

The same template key is used for Gemini Omni and xAI scene videos today. Existing saved `game.omniVideo` overrides are still read as a legacy fallback until you save the new `game.video` template.

## Storage And Safety

Scene videos are stored as MP4 files under Marinara's local data directory, separate from `chat_images`. Metadata records the chat, provider, model, prompt, source image, duration, aspect ratio, file path, and creation time.

Video providers are called server-side. Provider responses are validated as MP4 before being saved, and remote video downloads are constrained to HTTPS.

## Troubleshooting

### "Choose a Video Generation connection"

Open **Chat Settings -> Agents -> Scene Videos** for the current chat and select a Video Generation connection. If the dropdown is empty, create one in **Settings -> Connections**.

### "Generate a scene illustration before generating a scene video"

Use **Illustrate** first, upload a gallery image, or click **Animate** on an existing gallery illustration.

### Gemini Omni rejects `duration_seconds`

This is expected provider behavior. Marinara does not send `duration_seconds` to Gemini Omni's `video_config`; duration is rendered into the prompt instead.

### Copy Prompt closes the preview

The preview should stay open while copying. If it closes, update to a build that includes the lightbox copy-event fix.

### xAI video requests take a while

xAI starts a video job and then polls for completion. The default polling interval is controlled by `XAI_VIDEO_POLL_INTERVAL_MS` and the overall timeout by `VIDEO_GEN_TIMEOUT_MS`.

### xAI rejects a long prompt

xAI has a smaller video prompt limit than Gemini. Marinara automatically summarizes narration, excerpts the source illustration prompt, and caps the final rendered prompt for xAI requests. If you heavily customize `game.video`, keep the template concise so provider-specific safety room remains available.
