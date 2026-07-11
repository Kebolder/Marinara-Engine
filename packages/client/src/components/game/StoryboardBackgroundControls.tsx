import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import {
  CHAT_TOOLBAR_ICON_GAP_CLASS,
  getChatToolbarButtonClass,
} from "../chat/ChatToolbarControls";
import { cn } from "../../lib/utils";

interface StoryboardBackgroundControlsProps {
  mobile?: boolean;
  playing: boolean;
  muted: boolean;
  onReplay: () => void;
  onTogglePlayback: () => void;
  onToggleMute: () => void;
}

export function StoryboardBackgroundControls({
  mobile = false,
  playing,
  muted,
  onReplay,
  onTogglePlayback,
  onToggleMute,
}: StoryboardBackgroundControlsProps) {
  const controlClassName = getChatToolbarButtonClass({ compact: mobile });

  return (
    <div
      data-storyboard-background-controls
      className={cn(
        "flex items-center",
        CHAT_TOOLBAR_ICON_GAP_CLASS,
        mobile ? "" : "rounded-lg bg-black/45 p-1 shadow-sm ring-1 ring-white/10",
      )}
      role="group"
      aria-label="Storyboard background animation"
    >
      <button
        type="button"
        onClick={onReplay}
        className={controlClassName}
        title="Replay background animation"
        aria-label="Replay background animation"
      >
        <RotateCcw size={14} />
      </button>
      <button
        type="button"
        onClick={onTogglePlayback}
        className={controlClassName}
        title={playing ? "Pause background animation" : "Play background animation"}
        aria-label={playing ? "Pause background animation" : "Play background animation"}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <button
        type="button"
        onClick={onToggleMute}
        className={controlClassName}
        title={muted ? "Unmute background animation" : "Mute background animation"}
        aria-label={muted ? "Unmute background animation" : "Mute background animation"}
      >
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>
    </div>
  );
}
