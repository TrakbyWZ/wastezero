"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Gates a modal's close action behind a "discard unsaved changes?" prompt.
 * Snapshots `value` whenever `open` transitions to true; `requestClose`
 * closes immediately if `value` still matches that snapshot, otherwise
 * defers the close until `confirmDiscard` is called.
 */
export function useDiscardConfirm<T>(open: boolean, value: T) {
  const snapshotRef = useRef<string | null>(null);
  const [pendingClose, setPendingClose] = useState<(() => void) | null>(null);

  useEffect(() => {
    snapshotRef.current = open ? JSON.stringify(value) : null;
    if (!open) setPendingClose(null);
    // Snapshot only when the modal opens/closes, not on every form edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const requestClose = useCallback(
    (close: () => void) => {
      const isDirty =
        snapshotRef.current !== null &&
        snapshotRef.current !== JSON.stringify(value);
      if (isDirty) {
        setPendingClose(() => close);
      } else {
        close();
      }
    },
    [value],
  );

  const confirmDiscard = useCallback(() => {
    setPendingClose((current) => {
      current?.();
      return null;
    });
  }, []);

  const cancelDiscard = useCallback(() => setPendingClose(null), []);

  return {
    requestClose,
    discardPromptOpen: pendingClose !== null,
    confirmDiscard,
    cancelDiscard,
  };
}
