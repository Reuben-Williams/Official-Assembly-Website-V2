"use client";

import {
  ALERT_CATEGORIES,
  type PublicAlertProjectionV1,
  type PublicAlertItemV1,
} from "@reuben-williams/content";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "./public-alert-controller.module.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
        typeof alert.category !== "string" || !ALERT_CATEGORIES.includes(alert.category as never)) {
      throw new TypeError("Invalid alert response.");
    }
    const link = safeLink(alert.link);
    const endsAt = alert.endsAt === undefined || alert.endsAt === null ? undefined : instant(alert.endsAt) ?? undefined;
    if (alert.endsAt !== undefined && alert.endsAt !== null && !endsAt) throw new TypeError("Invalid alert response.");
    return Object.freeze({
      id: alert.id,
      category: alert.category as PublicAlertItemV1["category"],
      message: alert.message,
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

function currentAlerts(projection: PublicAlertProjectionV1 | null, now: number) {
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
}: {
  initialProjection: PublicAlertProjectionV1 | null;
  endpoint?: string;
  rotationMs?: number;
  transitionDelayMs?: number;
}) {
  const [projection, setProjection] = useState(initialProjection);
  const [clock, setClock] = useState(() => Date.now());
  const [index, setIndex] = useState(0);
  const [stickyPaused, setStickyPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const refreshing = useRef<Promise<void> | null>(null);
  const reducedMotion = useReducedMotion();
  const alerts = useMemo(() => currentAlerts(projection, clock), [clock, projection]);

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

  const autoplay = alerts.length > 1 && !stickyPaused && !hovered && !focusWithin && !documentHidden && !reducedMotion;
  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % alerts.length), rotationMs);
    return () => window.clearInterval(timer);
  }, [alerts.length, autoplay, rotationMs]);

  if (alerts.length === 0) return null;
  const currentIndex = Math.min(index, alerts.length - 1);
  const current = alerts[currentIndex]!;

  function navigate(offset: -1 | 1) {
    const next = (currentIndex + offset + alerts.length) % alerts.length;
    setIndex(next);
    setAnnouncement(`Alert ${next + 1} of ${alerts.length}: ${alerts[next]!.message}`);
  }

  return (
    <aside
      className={styles.bar}
      aria-label="Site alerts"
      data-public-alert-controller
      data-category={current.category}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
      }}
    >
      <div className={styles.inner}>
        {alerts.length > 1 ? (
          <button type="button" className={styles.iconButton} aria-label="Previous alert" onClick={() => navigate(-1)}>
            <ChevronLeft aria-hidden="true" />
          </button>
        ) : null}
        <div className={styles.viewport} aria-live="off" aria-atomic="true">
          <div className={styles.current} data-alert-current key={current.id}>
            <span className={styles.category}>{current.category}</span>
            {current.link ? <a href={current.link}>{current.message}</a> : <span>{current.message}</span>}
            {alerts.length > 1 ? <span className={styles.count}>{currentIndex + 1} / {alerts.length}</span> : null}
          </div>
        </div>
        {alerts.length > 1 ? (
          <div className={styles.controls}>
            <button type="button" className={styles.iconButton} aria-label="Next alert" onClick={() => navigate(1)}>
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.pauseButton}
              aria-label={stickyPaused ? "Resume alerts" : "Pause alerts"}
              aria-pressed={stickyPaused}
              onClick={() => setStickyPaused((value) => !value)}
            >
              {stickyPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
              <span>{stickyPaused ? "Resume" : "Pause"}</span>
            </button>
          </div>
        ) : null}
      </div>
      <span className={styles.srOnly} aria-live="polite" aria-atomic="true">{announcement}</span>
      {refreshFailed ? <span className={styles.srOnly} role="status">Latest alerts could not be refreshed.</span> : null}
    </aside>
  );
}
