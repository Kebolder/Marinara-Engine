import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../lib/utils";
import {
  getBrowserSpeechRecognitionCtor,
  readBrowserSpeechRecognitionTranscript,
  type BrowserSpeechRecognition,
} from "../../lib/browser-speech-recognition";

interface SpeechToTextButtonProps {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  className?: string;
  iconSize?: number;
}

export function SpeechToTextButton({ disabled, onTranscript, className, iconSize = 16 }: SpeechToTextButtonProps) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const disabledRef = useRef(Boolean(disabled));

  useEffect(() => {
    setSupported(Boolean(getBrowserSpeechRecognitionCtor()));
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    disabledRef.current = Boolean(disabled);
    if (disabled && recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setListening(false);
    }
  }, [disabled]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const startListening = useCallback(() => {
    if (listening || recognitionRef.current) {
      stopListening();
      return;
    }
    if (disabledRef.current) return;

    const Recognition = getBrowserSpeechRecognitionCtor();
    if (!Recognition) {
      toast.error("Speech recognition is not supported in this browser.");
      return;
    }

    const recognition = new Recognition();
    let finalTranscript = "";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index] ?? event.results.item(index);
        const transcript = readBrowserSpeechRecognitionTranscript(result);
        if (result?.isFinal && transcript.trim()) {
          finalTranscript = `${finalTranscript} ${transcript}`.trim();
        }
      }
    };
    recognition.onerror = (event) => {
      const error = event.error ?? "unknown";
      setListening(false);
      if (!["aborted", "no-speech"].includes(error)) {
        toast.error(`Speech recognition failed: ${error}`);
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      if (!disabledRef.current && finalTranscript.trim()) {
        onTranscript(finalTranscript.trim());
      }
    };

    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      toast.error("Could not start speech recognition.");
    }
  }, [listening, onTranscript, stopListening]);

  return (
    <button
      type="button"
      onClick={startListening}
      disabled={disabled}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all duration-200 active:scale-90 sm:h-8 sm:w-8",
        listening
          ? "bg-foreground/10 text-foreground/75 ring-1 ring-foreground/20"
          : supported
            ? "text-foreground/40 hover:bg-foreground/10 hover:text-foreground/70"
            : "text-foreground/25",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      title={
        listening
          ? "Stop dictation"
          : supported
            ? "Dictate message"
            : "Speech recognition is not supported in this browser"
      }
      aria-pressed={listening}
      aria-label={listening ? "Stop dictation" : "Dictate message"}
    >
      {supported ? <Mic size={iconSize} /> : <MicOff size={iconSize} />}
    </button>
  );
}
