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
  const visible = open && enabled;
  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [visible]);
  return <div className={`news-navigation${mobile ? " news-navigation-mobile" : ""}`} ref={root}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && visible) {
        event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
      }
    }}>
    <div className="news-navigation-top">
      {children}
      <button type="button" className="news-navigation-toggle" aria-label={label} aria-expanded={visible}
        aria-controls={id} ref={trigger} tabIndex={enabled ? 0 : -1} onClick={() => setOpen(!visible)}>
        <ChevronDown aria-hidden="true" size={17} />
      </button>
    </div>
    <div id={id} className="news-navigation-submenu" hidden={!visible}>
      {visible && items.map(item => <Link key={item.href} href={item.href} onClick={() => { setOpen(false); onNavigate?.(); }}>{item.label}</Link>)}
    </div>
  </div>;
}
