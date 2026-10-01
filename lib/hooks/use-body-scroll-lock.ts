"use client";

import { useEffect } from "react";

/**
 * Locks page scroll while `locked` is true (e.g. any modal is open), so wheel/touch
 * input scrolls the modal's own content instead of the page behind it. Restores the
 * previous `body` overflow value on cleanup.
 */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [locked]);
}
