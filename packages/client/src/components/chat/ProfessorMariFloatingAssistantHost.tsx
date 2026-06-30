import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  PROFESSOR_MARI_FLOATING_HIDE_EVENT,
  PROFESSOR_MARI_FLOATING_SHOW_EVENT,
  rememberProfessorMariFloatingEnabled,
} from "./professor-mari-floating-events";

const ProfessorMariFloatingAssistant = lazy(() =>
  import("./HomeProfessorMariChat").then((module) => ({ default: module.ProfessorMariFloatingAssistant })),
);

interface ProfessorMariFloatingAssistantHostProps {
  active: boolean;
}

export function ProfessorMariFloatingAssistantHost({ active }: ProfessorMariFloatingAssistantHostProps) {
  const [visible, setVisible] = useState(false);

  const dismissFloating = useCallback(() => {
    rememberProfessorMariFloatingEnabled(false);
    setVisible(false);
  }, []);

  useEffect(() => {
    setVisible(active);
  }, [active]);

  useEffect(() => {
    const showFloating = () => {
      rememberProfessorMariFloatingEnabled(true);
      setVisible(true);
    };
    const hideFloating = () => {
      setVisible(false);
    };

    window.addEventListener(PROFESSOR_MARI_FLOATING_SHOW_EVENT, showFloating);
    window.addEventListener(PROFESSOR_MARI_FLOATING_HIDE_EVENT, hideFloating);
    return () => {
      window.removeEventListener(PROFESSOR_MARI_FLOATING_SHOW_EVENT, showFloating);
      window.removeEventListener(PROFESSOR_MARI_FLOATING_HIDE_EVENT, hideFloating);
    };
  }, []);

  if (!visible) return null;

  return (
    <Suspense fallback={null}>
      <ProfessorMariFloatingAssistant onDismiss={dismissFloating} />
    </Suspense>
  );
}
