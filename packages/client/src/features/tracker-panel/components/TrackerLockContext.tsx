import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { isTrackerFieldHidden, isTrackerFieldLocked, type TrackerFieldLocks, type TrackerHiddenFields } from "@marinara-engine/shared";
import type { TrackerFieldLocksUpdater } from "../hooks/use-tracker-field-lock-updater";

export type TrackerHiddenFieldsUpdater = (hiddenFields: TrackerHiddenFields | null | undefined) => TrackerHiddenFields;

interface TrackerLockContextValue {
  fieldLocks?: TrackerFieldLocks | null;
  hiddenTrackerFields?: TrackerHiddenFields | null;
  lockMode: boolean;
  hideMode?: boolean;
  onSetLockMode?: (enabled: boolean) => void;
  onSetHideMode?: (enabled: boolean) => void;
  onToggleFieldLock?: (key: string) => void;
  onToggleFieldHidden?: (key: string) => void;
  onUpdateFieldLocks?: (updater: TrackerFieldLocksUpdater) => void;
  onUpdateHiddenFields?: (updater: TrackerHiddenFieldsUpdater) => void;
}

const TrackerLockContext = createContext<TrackerLockContextValue>({ lockMode: false });

export function TrackerLockProvider({
  children,
  fieldLocks,
  hiddenTrackerFields,
  lockMode,
  hideMode,
  onSetLockMode,
  onSetHideMode,
  onToggleFieldLock,
  onToggleFieldHidden,
  onUpdateFieldLocks,
  onUpdateHiddenFields,
}: TrackerLockContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({
      fieldLocks,
      hiddenTrackerFields,
      lockMode,
      hideMode: hideMode === true,
      onSetLockMode,
      onSetHideMode,
      onToggleFieldLock,
      onToggleFieldHidden,
      onUpdateFieldLocks,
      onUpdateHiddenFields,
    }),
    [
      fieldLocks,
      hiddenTrackerFields,
      lockMode,
      hideMode,
      onSetLockMode,
      onSetHideMode,
      onToggleFieldLock,
      onToggleFieldHidden,
      onUpdateFieldLocks,
      onUpdateHiddenFields,
    ],
  );
  return <TrackerLockContext.Provider value={value}>{children}</TrackerLockContext.Provider>;
}

export function useTrackerLockContext() {
  return useContext(TrackerLockContext);
}

export function useTrackerFieldLock(key: string | undefined) {
  const { fieldLocks, lockMode, onToggleFieldLock } = useTrackerLockContext();
  const onToggleLock = useCallback(() => {
    if (key) onToggleFieldLock?.(key);
  }, [key, onToggleFieldLock]);
  return {
    locked: key ? isTrackerFieldLocked(fieldLocks, key) : false,
    lockMode,
    onToggleLock: key && onToggleFieldLock ? onToggleLock : undefined,
  };
}

export function useTrackerFieldVisibility(key: string | undefined) {
  const { hiddenTrackerFields, hideMode, onToggleFieldHidden } = useTrackerLockContext();
  const onToggleHidden = useCallback(() => {
    if (key) onToggleFieldHidden?.(key);
  }, [key, onToggleFieldHidden]);
  return {
    hidden: key ? isTrackerFieldHidden(hiddenTrackerFields, key) : false,
    hideMode: hideMode === true,
    onToggleHidden: key && onToggleFieldHidden ? onToggleHidden : undefined,
  };
}
