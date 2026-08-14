"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Landmark, Menu, X } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

export type MobileNavigationItem = Readonly<{
  slug: string;
  href: string;
  label: string;
}>;

type MobileNavigationProps = Readonly<{
  brandLabel: string;
  closeLabel: string;
  items: readonly MobileNavigationItem[];
  navigationLabel: string;
  openLabel: string;
}>;

const subscribeToHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function normalizePathname(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

function internalPath(href: string, origin: string) {
  try {
    const url = new URL(href, origin);
    return url.origin === origin ? normalizePathname(url.pathname) : null;
  } catch {
    return null;
  }
}

export function isMobileNavigationItemCurrent(href: string, pathname: string, origin: string) {
  const target = internalPath(href, origin);
  const current = normalizePathname(pathname);
  if (!target) return false;
  if (target === "/") return current === "/";
  if (target === "/news") return current === target || current.startsWith("/news/");
  return current === target;
}

function isUnmodifiedPrimaryClick(event: ReactMouseEvent<HTMLAnchorElement>) {
  return event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
    && event.currentTarget.target !== "_blank";
}

function focusableElements(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("hidden"));
}

export function MobileNavigation({
  brandLabel,
  closeLabel,
  items,
  navigationLabel,
  openLabel,
}: MobileNavigationProps) {
  const pathname = usePathname() || "/";
  const mounted = useSyncExternalStore(subscribeToHydration, clientSnapshot, serverSnapshot);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(false);
  const previousPathnameRef = useRef(pathname);

  const closeMenu = useCallback((restoreFocus: boolean) => {
    restoreFocusRef.current = restoreFocus;
    setOpen(false);
  }, []);

  useEffect(() => {
    if (overlayRef.current) overlayRef.current.inert = !open;
  }, [mounted, open]);

  useEffect(() => {
    if (open) {
      dialogRef.current?.querySelector<HTMLElement>("[data-mobile-menu-close]")?.focus();
      return;
    }
    if (restoreFocusRef.current) triggerRef.current?.focus();
    restoreFocusRef.current = false;
  }, [open]);

  useEffect(() => {
    if (previousPathnameRef.current !== pathname) {
      previousPathnameRef.current = pathname;
      closeMenu(false);
    }
  }, [closeMenu, pathname]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 921px)");
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) closeMenu(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [closeMenu]);

  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const computedPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${computedPadding + scrollbarWidth}px`;
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeMenu, open]);

  const origin = mounted ? window.location.origin : "https://invalid.local";

  const overlay = mounted ? createPortal(
    <div
      aria-hidden={open ? undefined : "true"}
      className="mobile-navigation-overlay"
      data-mobile-menu-overlay
      data-state={open ? "open" : "closed"}
      ref={overlayRef}
    >
      <button
        aria-hidden="true"
        className="mobile-navigation-backdrop"
        data-mobile-menu-backdrop
        onClick={() => closeMenu(true)}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-labelledby="mobile-navigation-title"
        aria-modal="true"
        className="mobile-navigation-drawer"
        data-mobile-menu-dialog
        id="mobile-navigation-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <div className="mobile-navigation-header">
          <span className="mobile-navigation-mark" aria-hidden="true">
            <Landmark size={22} />
          </span>
          <div>
            <p>{brandLabel}</p>
            <h2 id="mobile-navigation-title">{navigationLabel}</h2>
          </div>
          <button
            aria-label={closeLabel}
            className="mobile-navigation-close"
            data-mobile-menu-close
            onClick={() => closeMenu(true)}
            tabIndex={open ? 0 : -1}
            type="button"
          >
            <X aria-hidden="true" size={22} />
          </button>
        </div>
        <nav
          aria-label={navigationLabel}
          className="mobile-navigation-list"
          data-builder-instance="mobile"
          data-builder-kind="sections"
          data-builder-region="global.navigation"
        >
          {items.map((item) => {
            const current = isMobileNavigationItemCurrent(item.href, pathname, origin);
            return (
              <Link
                aria-current={current ? "page" : undefined}
                data-builder-instance="mobile"
                data-builder-item-id={item.slug}
                data-builder-kind="link"
                data-builder-region={`global.navigation.${item.slug}.link`}
                data-mobile-contact={item.slug === "contact" ? "true" : undefined}
                href={item.href}
                key={item.slug}
                onClick={(event) => {
                  if (!isUnmodifiedPrimaryClick(event)) return;
                  const exactTarget = internalPath(item.href, origin);
                  const exactCurrent = normalizePathname(pathname);
                  if (exactTarget === exactCurrent) {
                    event.preventDefault();
                    closeMenu(true);
                  } else {
                    closeMenu(false);
                  }
                }}
                tabIndex={open ? 0 : -1}
              >
                <span
                  data-builder-instance="mobile"
                  data-builder-kind="text"
                  data-builder-link-label
                  data-builder-region={`global.navigation.${item.slug}.label`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </section>
    </div>,
    document.body,
  ) : null;

  return (
    <div className="mobile-menu">
      <button
        aria-controls="mobile-navigation-dialog"
        aria-expanded={open}
        aria-label={open ? closeLabel : openLabel}
        className="mobile-summary"
        data-mobile-menu-trigger
        onClick={() => open ? closeMenu(true) : setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        {open ? <X aria-hidden="true" size={24} /> : <Menu aria-hidden="true" size={24} />}
      </button>
      {overlay}
    </div>
  );
}
