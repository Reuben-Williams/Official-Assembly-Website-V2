"use client";

import Image from "next/image";
import { ArrowLeft, ArrowRight, Grid2X2, Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { carouselCopy, communityPhotos } from "../data/community-photos";
import type { PublicLocale } from "../i18n/locale";
import styles from "./CommunityHero.module.css";

const duration = 7000;
const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(callback: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const readMotion = () => window.matchMedia(motionQuery).matches;
const serverMotion = () => false;

export function CommunityCarousel({ locale }: { locale: PublicLocale }) {
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const reduced = useSyncExternalStore(subscribeMotion, readMotion, serverMotion);
  const root = useRef<HTMLElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const galleryButton = useRef<HTMLButtonElement>(null);
  const clock = useRef({ index: 0, elapsed: 0 });
  const id = useId();
  const copy = carouselCopy[locale];
  const photo = communityPhotos[current];
  const text = photo[locale];
  const activePlayback = playing && !reduced;
  const pause = useCallback(() => setPlaying(false), []);
  const paint = useCallback(() => {
    if (progress.current) progress.current.style.transform = `scaleX(${(clock.current.index + clock.current.elapsed / duration) / communityPhotos.length})`;
  }, []);
  const choose = useCallback((index: number) => {
    pause();
    const next = (index + communityPhotos.length) % communityPhotos.length;
    clock.current = { index: next, elapsed: 0 };
    setCurrent(next);
    paint();
  }, [paint, pause]);

  useEffect(() => {
    if (!activePlayback) return;
    let last = performance.now();
    let frame: number;
    const tick = (now: number) => {
      clock.current.elapsed += Math.max(0, now - last);
      last = now;
      if (clock.current.elapsed >= duration) {
        clock.current.index = (clock.current.index + Math.floor(clock.current.elapsed / duration)) % communityPhotos.length;
        clock.current.elapsed %= duration;
        setCurrent(clock.current.index);
      }
      paint();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [activePlayback, paint]);

  useEffect(() => {
    const visibility = () => { if (document.hidden) pause(); };
    const motion = window.matchMedia(motionQuery);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pause);
    motion.addEventListener("change", pause);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pause);
      motion.removeEventListener("change", pause);
    };
  }, [pause]);

  useEffect(() => {
    const hero = root.current?.closest<HTMLElement>("[data-community-hero]");
    if (!hero) return;
    // Account for the real navigation and active alert bar, not the demo's fixed header.
    const measure = () => {
      const header = document.querySelector(".site-header");
      const alerts = document.querySelector("[data-public-alert-controller]");
      const height = (header?.getBoundingClientRect().height ?? 74) + (alerts?.getBoundingClientRect().height ?? 0);
      hero.style.setProperty("--hero-chrome-height", `${height}px`);
    };
    const resize = new ResizeObserver(measure);
    const observe = () => {
      resize.disconnect();
      for (const selector of [".site-header", "[data-public-alert-controller]"]) {
        const element = document.querySelector(selector);
        if (element) resize.observe(element);
      }
      measure();
    };
    observe();
    const mutations = new MutationObserver(observe);
    mutations.observe(document.body, { childList: true });
    window.addEventListener("resize", measure);
    return () => { resize.disconnect(); mutations.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  useEffect(() => {
    if (!galleryOpen || !dialog.current) return;
    const modal = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.showModal();
    modal.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    return () => { document.body.style.overflow = overflow; };
  }, [galleryOpen]);

  const closeGallery = () => dialog.current?.close();
  return (
    <section ref={root} className={styles.carousel} data-community-carousel="true" data-playing={activePlayback}
      aria-roledescription={copy.carousel} aria-label={copy.label}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") pause(); }}
      onFocusCapture={(event) => { if (!(event.target as HTMLElement).closest("[data-carousel-play]")) pause(); }}
      onKeyDown={(event) => {
        if (galleryOpen) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault(); choose(current + (event.key === "ArrowRight" ? 1 : -1));
        }
      }}>
      <div id={`${id}-stage`} className={styles.stage} data-carousel-stage data-format={photo.height > photo.width ? "portrait" : "landscape"}
        role="group" aria-roledescription={copy.slide} aria-label={`${current + 1} ${copy.of} ${communityPhotos.length}: ${text.title}`}>
        <Image key={photo.id} className={styles.photo} src={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}${photo.src}`} alt={text.caption}
          width={photo.width} height={photo.height} sizes={photo.height > photo.width ? "(max-width: 600px) 70vw, 420px" : "100vw"}
          preload={current === 0} loading={current === 0 ? undefined : "eager"}
          style={{ objectPosition: photo.position }} hidden={failedPhoto === photo.id} onError={() => setFailedPhoto(photo.id)} />
        {failedPhoto === photo.id && <p className={styles.error} role="status">{copy.error}</p>}
      </div>
      <div className={styles.footer}>
        <div className={styles.description} aria-live={activePlayback ? "off" : "polite"} aria-atomic="true">
          <span className={styles.index}>{String(current + 1).padStart(2, "0")} / 08</span>
          <div><strong>{text.title}</strong><p>{text.caption}</p></div>
        </div>
        <div className={styles.controls}>
          <div className={styles.timeline} role="group" aria-label={copy.progress}>
            <div className={styles.track} aria-hidden="true"><div ref={progress} className={styles.fill} data-carousel-progress /></div>
            {communityPhotos.map((item, index) => <button type="button" key={item.id}
              aria-label={`${copy.show} ${index + 1}: ${item[locale].title}`} aria-current={index === current ? "true" : undefined}
              aria-controls={`${id}-stage`} data-complete={index < current} onClick={() => choose(index)} />)}
          </div>
          <div className={styles.buttons}>
            <button ref={galleryButton} type="button" className={styles.galleryToggle} aria-label={copy.gallery} title={copy.gallery}
              aria-haspopup="dialog" aria-expanded={galleryOpen} aria-controls={`${id}-gallery`}
              onClick={() => { pause(); setGalleryOpen(true); }}><Grid2X2 size={21} aria-hidden="true" /></button>
            <button type="button" aria-label={copy.previous} aria-controls={`${id}-stage`} onClick={() => choose(current - 1)}><ArrowLeft size={23} aria-hidden="true" /></button>
            <button type="button" aria-label={copy.next} aria-controls={`${id}-stage`} onClick={() => choose(current + 1)}><ArrowRight size={23} aria-hidden="true" /></button>
            <button type="button" className={styles.play} data-carousel-play aria-label={activePlayback ? copy.pauseLabel : copy.playLabel}
              aria-controls={`${id}-stage`} disabled={reduced} title={reduced ? copy.reduced : undefined} onClick={() => setPlaying(!activePlayback)}>
              {activePlayback ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{activePlayback ? copy.pause : copy.play}
            </button>
          </div>
        </div>
      </div>
      <dialog ref={dialog} id={`${id}-gallery`} className={styles.dialog} aria-labelledby={`${id}-gallery-title`} aria-describedby={`${id}-gallery-description`}
        onClose={() => { setGalleryOpen(false); galleryButton.current?.focus(); }}
        onClick={(event) => {
          if (event.target !== dialog.current) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeGallery();
        }}>
        <div className={styles.modalHeading}><div><h2 id={`${id}-gallery-title`}>{copy.galleryTitle}</h2><p id={`${id}-gallery-description`}>{copy.description}</p></div>
          <button type="button" aria-label={copy.close} onClick={closeGallery}><X size={22} aria-hidden="true" /></button></div>
        {galleryOpen && <div className={styles.galleryGrid}>{communityPhotos.map((item, index) => <button type="button" key={item.id}
          aria-pressed={index === current} aria-label={`${copy.show} ${index + 1}: ${item[locale].title}`}
          onClick={() => { choose(index); closeGallery(); }}>
          <Image src={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}${item.src}`} width={item.width} height={item.height} sizes="(max-width: 600px) 42vw, 220px" alt="" />
          <span><strong>{String(index + 1).padStart(2, "0")} · {item[locale].title}</strong><small>{item[locale].caption}</small></span>
        </button>)}</div>}
        <p className={styles.modalFoot}>{copy.still}</p>
      </dialog>
    </section>
  );
}
