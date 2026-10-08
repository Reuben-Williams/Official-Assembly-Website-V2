"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export type NewsNavigationItem = Readonly<{ href: string; label: string }>;

// A disclosure, not an ARIA application menu: links retain normal browser behavior.
export function NewsNavigation({ children, items, label, id = "news-navigation-submenu", mobile = false, enabled = true, onNavigate }: {
  children: ReactNode;
  items: readonly NewsNavigationItem[];
  label: string;
  id?: string;
  mobile?: boolean;
  enabled?: boolean;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const visible = open && enabled;
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useEffect(() => {
    const otherOpened = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) setOpen(false); };
    window.addEventListener("public-navigation-open", otherOpened);
    return () => window.removeEventListener("public-navigation-open", otherOpened);
  }, [id]);
  const openMenu = () => {
    cancelClose();
    window.dispatchEvent(new CustomEvent("public-navigation-open", { detail: id }));
    setOpen(true);
  };
  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [visible]);
  return <div className={`news-navigation${mobile ? " news-navigation-mobile" : ""}`} ref={root}
    onPointerEnter={event => { if (!mobile && enabled && event.pointerType === "mouse") openMenu(); }}
    onPointerLeave={event => { if (!mobile && event.pointerType === "mouse") { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 200); } }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={(event) => {
      if (event.key === "ArrowDown" && !visible) { event.preventDefault(); openMenu(); }
      if (event.key === "Escape" && visible) {
        event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
      }
    }}>
    <div className="news-navigation-top">
      {children}
      <button type="button" className="news-navigation-toggle" aria-label={label} aria-expanded={visible}
        aria-controls={id} ref={trigger} tabIndex={enabled ? 0 : -1} onClick={() => visible ? setOpen(false) : openMenu()}>
        <ChevronDown aria-hidden="true" size={17} />
      </button>
    </div>
    <div id={id} className="news-navigation-submenu" hidden={!visible}>
      {visible && items.map(item => <Link key={item.href} href={item.href} onClick={() => { setOpen(false); onNavigate?.(); }}>{item.label}</Link>)}
    </div>
  </div>;
}
