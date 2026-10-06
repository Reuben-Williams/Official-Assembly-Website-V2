"use client";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./calendar-workspace.module.css";

export function CalendarDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} aria-label={title} className={styles.dialog} onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>{title}</h2>{children}
  </dialog>;
}
