"use client";

import {
  ALERT_CATEGORIES,
  type PublicAlertProjectionV1,
  type PublicAlertItemV1,
} from "@reuben-williams/content";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import {
  type AnimationEvent as ReactAnimationEvent,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "./public-alert-controller.module.css";
import { publicCopy } from "../i18n/catalog.public";
import type { PublicLocale } from "../i18n/locale";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MOBILE_BREAKPOINT_PX = 42 * 16;
const DESKTOP_SCROLL_PX_PER_SECOND = 48;
const MOBILE_SCROLL_PX_PER_SECOND = 36;
const MAX_SCROLL_SECONDS = 120;
const ALERT_GAP_MS = 1_200;
const WATCHDOG_GRACE_MS = 1_000;
const EMPTY_SCROLL_STYLE: ScrollStyle = Object.freeze({});

type MotionMode = "stationary" | "measuring" | "scrolling" | "gap" | "held" | "message-focused";
type ScrollStyle = CSSProperties & {
  "--alert-scroll-duration"?: string;
  "--alert-scroll-start"?: string;
  "--alert-scroll-end"?: string;
};
type PlaybackState = {
  token: string;
  mode: MotionMode;
  style: ScrollStyle;
};

function instant(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function safeLink(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > 2_048) throw new TypeError("Invalid alert link.");
  if (value.startsWith("/") && !value.startsWith("//") && !/[\\\s]/.test(value)) return value;
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new TypeError("Invalid alert link.");
  return parsed.toString();
}

function parseProjection(value: unknown): PublicAlertProjectionV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid alert response.");
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || typeof item.revisionId !== "string" || !UUID.test(item.revisionId) ||
      !Array.isArray(item.activeAlerts) || item.activeAlerts.length > 100) {
    throw new TypeError("Invalid alert response.");
  }
  const evaluatedAt = instant(item.evaluatedAt);
  const nextTransitionAt = item.nextTransitionAt === null ? null : instant(item.nextTransitionAt);
  if (!evaluatedAt || (item.nextTransitionAt !== null && !nextTransitionAt)) throw new TypeError("Invalid alert response.");
  const activeAlerts = item.activeAlerts.map((value): PublicAlertItemV1 => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid alert response.");
    const alert = value as Record<string, unknown>;
    if (typeof alert.id !== "string" || !alert.id || alert.id.length > 200 ||
        typeof alert.message !== "string" || !alert.message.trim() || alert.message.length > 280 ||
        typeof alert.category !== "string" || !ALERT_CATEGORIES.includes(alert.category as never) ||
        (alert.scroll !== undefined && typeof alert.scroll !== "boolean")) {
      throw new TypeError("Invalid alert response.");
    }
    const link = safeLink(alert.link);
    const endsAt = alert.endsAt === undefined || alert.endsAt === null ? undefined : instant(alert.endsAt) ?? undefined;
    if (alert.endsAt !== undefined && alert.endsAt !== null && !endsAt) throw new TypeError("Invalid alert response.");
    return Object.freeze({
      id: alert.id,
      category: alert.category as PublicAlertItemV1["category"],
      message: alert.message,
      ...(alert.scroll === true ? { scroll: true } : {}),
      ...(link ? { link } : {}),
      ...(endsAt ? { endsAt } : {}),
    });
  });
  return Object.freeze({
    schemaVersion: 1,
    revisionId: item.revisionId,
    activeAlerts,
    evaluatedAt,
    nextTransitionAt,
  });
}

function currentAlerts(projection: PublicAlertProjectionV1 | null, now: number): PublicAlertItemV1[] {
  return projection?.activeAlerts.filter((alert) => !alert.endsAt || Date.parse(alert.endsAt) > now) ?? [];
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

export function PublicAlertController({
  initialProjection,
  endpoint = "/api/public/alerts",
  rotationMs = 8_000,
  transitionDelayMs = 75,
  locale = "en",
}: {
  initialProjection: PublicAlertProjectionV1 | null;
  endpoint?: string;
  rotationMs?: number;
  transitionDelayMs?: number;
  locale?: PublicLocale;
}) {
  const [projection, setProjection] = useState(initialProjection);
  const [clock, setClock] = useState(() => Date.now());
  const [index, setIndex] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [playback, setPlayback] = useState<PlaybackState>({
    token: "",
    mode: "stationary",
    style: {},
  });
  const [stickyPaused, setStickyPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [messageFocused, setMessageFocused] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const refreshing = useRef<Promise<void> | null>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLElement | null>(null);
  const fallbackTokenRef = useRef<string | null>(null);
  const lastViewportWidthRef = useRef(0);
  const reducedMotion = useReducedMotion();
  const alerts = useMemo(() => currentAlerts(projection, clock), [clock, projection]);
  const currentIndex = alerts.length ? Math.min(index, alerts.length - 1) : 0;
  const current = alerts[currentIndex] ?? null;
  const scrollRequested = current?.scroll === true && !reducedMotion;
  const interactionPaused = stickyPaused || hovered || focusWithin || documentHidden;
  const cycleToken = `${projection?.revisionId ?? "none"}:${current?.id ?? "none"}:${cycle}:${reducedMotion ? "reduced" : "motion"}`;
  const initialMotion: MotionMode = !current || !scrollRequested
    ? "stationary"
    : messageFocused
      ? "message-focused"
      : interactionPaused
        ? "held"
        : "measuring";
  const motion = playback.token === cycleToken ? playback.mode : initialMotion;
  const scrollStyle = playback.token === cycleToken ? playback.style : EMPTY_SCROLL_STYLE;

  const setMotion = useCallback((mode: MotionMode) => {
    setPlayback((value) => ({
      token: cycleToken,
      mode,
      style: value.token === cycleToken ? value.style : {},
    }));
  }, [cycleToken]);

  const refresh = useCallback(() => {
    if (refreshing.current) return refreshing.current;
    const pending = (async () => {
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: { accept: "application/json" },
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.status === 204) {
          setProjection(null);
        } else {
          if (!response.ok) throw new Error("Alert refresh failed.");
          setProjection(parseProjection(await response.json()));
        }
        setRefreshFailed(false);
      } catch {
        setRefreshFailed(true);
      } finally {
        setClock(Date.now());
        refreshing.current = null;
      }
    })();
    refreshing.current = pending;
    return pending;
  }, [endpoint]);

  useEffect(() => {
    if (!projection?.nextTransitionAt) return;
    const transitionAt = Date.parse(projection.nextTransitionAt);
    const delay = Math.max(0, transitionAt - Date.now() + transitionDelayMs);
    const timer = window.setTimeout(() => {
      setClock(Date.now());
      void refresh();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [projection?.nextTransitionAt, refresh, transitionDelayMs]);

  useEffect(() => {
    const catchUp = () => {
      setClock(Date.now());
      const transitionDue = projection?.nextTransitionAt
        ? Date.parse(projection.nextTransitionAt) <= Date.now()
        : false;
      if (refreshFailed || transitionDue) void refresh();
    };
    const visibility = () => {
      const hidden = document.visibilityState === "hidden";
      setDocumentHidden(hidden);
      if (!hidden) catchUp();
    };
    window.addEventListener("focus", catchUp);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("focus", catchUp);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [projection?.nextTransitionAt, refresh, refreshFailed]);

  useLayoutEffect(() => {
    const readyToMeasure = motion === "measuring" || (
      motion === "held" && !interactionPaused && !messageFocused
    );
    if (!readyToMeasure || !current || !scrollRequested || fallbackTokenRef.current === cycleToken) return;
    const viewportWidth = viewportRef.current?.getBoundingClientRect().width ?? 0;
    const trackWidth = trackRef.current?.getBoundingClientRect().width ?? 0;
    const speed = window.innerWidth <= MOBILE_BREAKPOINT_PX
      ? MOBILE_SCROLL_PX_PER_SECOND
      : DESKTOP_SCROLL_PX_PER_SECOND;
    const duration = (viewportWidth + trackWidth) / speed;
    if (!Number.isFinite(duration) || duration < 1 || duration > MAX_SCROLL_SECONDS) {
      fallbackTokenRef.current = cycleToken;
      setMotion("stationary");
      return;
    }
    lastViewportWidthRef.current = viewportWidth;
    setPlayback({
      token: cycleToken,
      mode: "scrolling",
      style: {
        "--alert-scroll-duration": `${duration.toFixed(3)}s`,
        "--alert-scroll-start": `${viewportWidth}px`,
        "--alert-scroll-end": `${-trackWidth}px`,
      },
    });
  }, [current, cycleToken, interactionPaused, messageFocused, motion, scrollRequested, setMotion]);

  useEffect(() => {
    if ((motion !== "measuring" && motion !== "scrolling") || typeof ResizeObserver === "undefined") return;
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const width = viewport.getBoundingClientRect().width;
        if (width > 0 && lastViewportWidthRef.current > 0 && Math.abs(width - lastViewportWidthRef.current) > 0.5) {
          setCycle((value) => value + 1);
        }
      });
    });
    observer.observe(viewport);
    observer.observe(track);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [cycleToken, motion]);

  useEffect(() => {
    if (motion !== "stationary" || alerts.length < 2 || interactionPaused || reducedMotion) return;
    const timer = window.setTimeout(() => {
      setIndex((value) => (Math.min(value, alerts.length - 1) + 1) % alerts.length);
      setCycle((value) => value + 1);
    }, rotationMs);
    return () => window.clearTimeout(timer);
  }, [alerts.length, interactionPaused, motion, reducedMotion, rotationMs]);

  useEffect(() => {
    if (motion !== "gap") return;
    if (interactionPaused || messageFocused) return;
    const timer = window.setTimeout(() => setCycle((value) => value + 1), ALERT_GAP_MS);
    return () => window.clearTimeout(timer);
  }, [interactionPaused, messageFocused, motion]);

  useEffect(() => {
    if (motion !== "scrolling" || interactionPaused) return;
    const seconds = Number.parseFloat(scrollStyle["--alert-scroll-duration"] ?? "");
    if (!Number.isFinite(seconds)) return;
    const token = cycleToken;
    const timer = window.setTimeout(() => {
      fallbackTokenRef.current = token;
      setMotion("stationary");
    }, seconds * 1_000 + WATCHDOG_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [cycleToken, interactionPaused, motion, scrollStyle, setMotion]);

  if (!current) return null;
  const effectiveMode = messageFocused
    ? "message-focused"
    : motion === "scrolling" && interactionPaused
      ? "paused"
      : interactionPaused && (motion === "measuring" || motion === "gap" || motion === "held")
        ? "held"
        : motion;
  const showMovingTrack = motion === "measuring" || motion === "scrolling" || (
    motion === "held" && !interactionPaused && !messageFocused
  );
  const showPause = alerts.length > 1 || (scrollRequested && motion !== "stationary");

  function navigate(offset: -1 | 1) {
    const next = (currentIndex + offset + alerts.length) % alerts.length;
    setIndex(next);
    setCycle((value) => value + 1);
    setAnnouncement(`${locale === "es" ? "Alerta" : "Alert"} ${next + 1} ${locale === "es" ? "de" : "of"} ${alerts.length}: ${alerts[next]!.message}`);
  }

  function completeScroll(event: ReactAnimationEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || !event.animationName.includes("alert-scroll") ||
        event.currentTarget.dataset.cycleToken !== cycleToken || interactionPaused) return;
    if (alerts.length === 1) {
      setMotion("gap");
    } else {
      setIndex((value) => (Math.min(value, alerts.length - 1) + 1) % alerts.length);
      setCycle((value) => value + 1);
    }
  }

  function focusMessage() {
    setMessageFocused(true);
    setCycle((value) => value + 1);
    setMotion("message-focused");
  }

  function blurMessage() {
    setMessageFocused(false);
    setCycle((value) => value + 1);
    setMotion("held");
  }

  const message = showMovingTrack ? (
    <span
      key={cycleToken}
      ref={trackRef}
      className={motion === "scrolling" ? styles.scrollTrack : styles.measureTrack}
      data-alert-track
      data-cycle-token={cycleToken}
      style={{ ...scrollStyle, animationPlayState: interactionPaused ? "paused" : "running" }}
      onAnimationEnd={completeScroll}
    >
      {current.message}
    </span>
  ) : (
    <span className={motion === "gap" ? styles.gapMessage : styles.stationaryMessage}>{current.message}</span>
  );

  const messageFrame = current.link ? (
    <a
      ref={viewportRef as RefObject<HTMLAnchorElement | null>}
      className={styles.messageFrame}
      data-alert-viewport
      href={current.link}
      onFocus={focusMessage}
      onBlur={blurMessage}
    >
      {message}
    </a>
  ) : (
    <span ref={viewportRef} className={styles.messageFrame} data-alert-viewport>{message}</span>
  );

  return (
    <aside
      className={styles.bar}
      aria-label={publicCopy(locale, "alerts.site-label", "Site alerts")}
      data-public-alert-controller
      data-category={current.category}
      data-alert-mode={effectiveMode}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event: ReactFocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
      }}
    >
      <div className={styles.inner}>
        {alerts.length > 1 ? (
          <button type="button" className={`${styles.iconButton} ${styles.previousButton}`} aria-label={publicCopy(locale, "alerts.previous", "Previous alert")} onClick={() => navigate(-1)}>
            <ChevronLeft aria-hidden="true" />
          </button>
        ) : null}
        <div className={styles.current} data-alert-current key={current.id} aria-live="off" aria-atomic="true">
          <span className={styles.category}>{current.category}</span>
          {messageFrame}
          {alerts.length > 1 ? <span className={styles.count}>{currentIndex + 1} / {alerts.length}</span> : null}
        </div>
        {alerts.length > 1 || showPause ? (
          <div className={styles.controls}>
            {alerts.length > 1 ? (
              <button type="button" className={styles.iconButton} aria-label={publicCopy(locale, "alerts.next", "Next alert")} onClick={() => navigate(1)}>
                <ChevronRight aria-hidden="true" />
              </button>
            ) : null}
            {showPause ? (
              <button
                type="button"
                className={styles.pauseButton}
                aria-label={stickyPaused
                  ? `${publicCopy(locale, "alerts.resume", "Resume")} ${locale === "es" ? "alertas" : "alerts"}`
                  : `${publicCopy(locale, "alerts.pause", "Pause")} ${locale === "es" ? "alertas" : "alerts"}`}
                aria-pressed={stickyPaused}
                onClick={() => setStickyPaused((value) => !value)}
              >
                {stickyPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                <span>{stickyPaused
                  ? publicCopy(locale, "alerts.resume", "Resume")
                  : publicCopy(locale, "alerts.pause", "Pause")}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <span className={styles.srOnly} aria-live="polite" aria-atomic="true">{announcement}</span>
      {refreshFailed ? <span className={styles.srOnly} role="status">
        {publicCopy(locale, "alerts.latest-unavailable", "Latest alerts could not be refreshed.")}
      </span> : null}
    </aside>
  );
}
