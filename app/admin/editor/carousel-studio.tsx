"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ImagePlus,
  Images,
  Monitor,
  Smartphone,
  RotateCcw,
  X,
} from "lucide-react";
import { CommunityCarousel } from "../../ui/CommunityCarousel";
import {
  canEditCarousel,
  canPublishCarousel,
  replaceCarouselPhoto,
  resetCarouselAppearance,
  type CarouselDocumentV1,
  type CarouselEntry,
  type CarouselFrame,
  type CarouselImage,
  type CarouselMedia,
} from "../../../lib/carousel/contract";
import {
  CarouselClientError,
  type CarouselClient,
} from "../../../lib/carousel/client";
import type { CarouselCommand } from "../../../lib/carousel/handlers";
import type {
  CarouselReview,
  CarouselState,
} from "../../../lib/carousel/service";
import styles from "./carousel-studio.module.css";
import { importCarouselBaseline } from "../../../lib/carousel/baseline-import";

export type StudioMedia = {
  mediaId: string;
  revisionId: string;
  label: string;
  url: string;
  alt: string;
  width?: number;
  height?: number;
  replicaStatus?: "ready" | "pending" | "failed";
};
function PreviewFrame({
  device,
  children,
}: {
  device: "desktop" | "mobile";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(device === "mobile" ? 390 : 600);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) =>
      setAvailable(entries[0].contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = device === "mobile" ? 390 : 1280;
  const height = device === "mobile" ? 600 : 650;
  const scale = Math.min(1, available / width);
  return (
    <div
      ref={ref}
      className={styles.previewCanvas}
      data-device={device}
      style={{ height: height * scale }}
    >
      <div
        className={styles.previewFrame}
        style={{ width, height, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const before = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      before?.focus();
    };
  }, []);
  return (
    <dialog
      className={styles.dialog}
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.dialogHead}>
        <h2>{title}</h2>
        <button type="button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Framing({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CarouselFrame;
  onChange: (value: CarouselFrame) => void;
}) {
  return (
    <fieldset className={styles.framing}>
      <legend>{label}</legend>
      <label>
        Image fit
        <select
          value={value.fit}
          onChange={(event) =>
            onChange({
              ...value,
              fit: event.target.value as CarouselFrame["fit"],
            })
          }
        >
          <option value="cover">Fill the frame</option>
          <option value="contain">Show the whole image</option>
        </select>
      </label>
      <p>
        Fill may crop edges. Use the controls to keep faces visible, or show the
        whole image.
      </p>
      {(["x", "y"] as const).map((axis) => (
        <label key={axis}>
          {axis === "x" ? "Horizontal" : "Vertical"} focus · {value[axis]}%
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={value[axis]}
            disabled={value.fit === "contain"}
            onChange={(event) =>
              onChange({ ...value, [axis]: Number(event.target.value) })
            }
          />
        </label>
      ))}
    </fieldset>
  );
}
export function CarouselStudio({
  role,
  client,
  mediaAssets,
  onRefreshMedia,
  onUploadMedia,
  mediaError,
}: {
  role: string;
  client: CarouselClient;
  mediaAssets: readonly StudioMedia[];
  onRefreshMedia: () => Promise<void>;
  mediaError?: string;
  onUploadMedia?: (
    file: File,
    metadata: { label: string; alt: string },
  ) => Promise<CarouselMedia>;
}) {
  const [state, setState] = useState<CarouselState | null>(null);
  const [document, setDocument] = useState<CarouselDocumentV1 | null>(null);
  const [selected, setSelected] = useState(0);
  const [scope, setScope] = useState<"photo" | "carousel">("photo");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [locale, setLocale] = useState<"en" | "es">("en");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [upload, setUpload] = useState<File | null>(null);
  const [uploadLabel, setUploadLabel] = useState("");
  const [uploadAlt, setUploadAlt] = useState("");
  const [review, setReview] = useState<CarouselReview | null>(null);
  const [seen, setSeen] = useState<string[]>([]);
  const [history, setHistory] = useState(false);
  const [filter, setFilter] = useState("all");
  const [conflict, setConflict] = useState<CarouselState | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [retry, setRetry] = useState<CarouselCommand | null>(null);
  const [needsInitialization, setNeedsInitialization] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const baselineMedia = useRef<CarouselMedia[]>([]);
  const baselineCommand = useRef<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const destination = useRef<HTMLElement | null>(null);
  const allowLeave = useRef(false);
  const editable = canEditCarousel(role);
  const publishable = canPublishCarousel(role);
  const dirty = Boolean(
    document &&
    state &&
    JSON.stringify(document) !== JSON.stringify(state.draft.document),
  );
  const apply = (next: CarouselState) => {
    setState(next);
    setDocument(structuredClone(next.draft.document));
    setReview(null);
    setSeen([]);
    setRetry(null);
    setNeedsInitialization(false);
  };
  useEffect(() => {
    let active = true;
    client
      .read()
      .then((next) => {
        if (active) apply(next);
      })
      .catch((failure) => {
        if (active) {
          setError(failure.message);
          setNeedsInitialization(
            failure instanceof CarouselClientError &&
              failure.code === "NOT_INITIALIZED",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [client]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      if (allowLeave.current) return;
      const target = (event.target as Element)?.closest<HTMLElement>(
        "a[href],button",
      );
      if (target && !root.current?.contains(target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        destination.current = target;
        setLeaving(true);
      }
    };
    window.addEventListener("beforeunload", unload);
    window.document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
  const change = (next: CarouselDocumentV1) => {
    setDocument(next);
    setReview(null);
    setSeen([]);
    setMessage("");
    setRetry(null);
  };
  const patch = (value: Partial<CarouselEntry>) => {
    if (!document) return;
    change({
      ...document,
      entries: document.entries.map((entry, index) =>
        index === selected ? { ...entry, ...value } : entry,
      ),
    });
  };
  const updateDefaults = (value: Partial<CarouselDocumentV1["defaults"]>) => {
    if (document)
      change({ ...document, defaults: { ...document.defaults, ...value } });
  };
  async function run(command: CarouselCommand) {
    setBusy(true);
    setError("");
    setAuthRequired(false);
    setRetry(null);
    try {
      const result = await client.command(command);
      if (result.state) apply(result.state);
      if (result.review) {
        setReview(result.review);
        setSeen([`${device}-${locale}`]);
      }
      setMessage(
        command.action === "publish"
          ? "Published. The homepage and its recovery copy use this saved revision."
          : command.action === "save"
            ? "Draft saved. Your live homepage has not changed."
            : command.action === "restore"
              ? "Earlier revision restored as a new draft. Review it before publishing."
              : "Review the saved revision in both languages and screen sizes.",
      );
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The request could not be confirmed.",
      );
      if (failure instanceof CarouselClientError && failure.status === 401)
        setAuthRequired(true);
      if (failure instanceof CarouselClientError && failure.status === 409) {
        try {
          setConflict(await client.read());
        } catch {
          setError(
            "The latest version could not be loaded. Your unsaved work is retained.",
          );
        }
      } else if (
        !(failure instanceof CarouselClientError) ||
        failure.status >= 500 ||
        failure.status === 401
      )
        setRetry(command);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const base = () => ({
    expectedVersion: state!.version,
    expectedPublishedId: state!.published.id,
  });
  const save = () =>
    run({
      ...base(),
      action: "save",
      commandId: crypto.randomUUID(),
      document: document!,
    });
  function leave() {
    allowLeave.current = true;
    setLeaving(false);
    destination.current?.click();
    queueMicrotask(() => {
      allowLeave.current = false;
    });
  }
  if (!state || !document)
    return (
      <section className={styles.studio}>
        <h1>Carousel Studio</h1>
        <p role={error ? "alert" : "status"}>
          {message || error || "Loading your saved carousel…"}
        </p>
        {needsInitialization && role === "owner" && onUploadMedia && (
          <>
            <p>
              Import the eight approved homepage photographs through the private
              gallery. Their order, bilingual descriptions and framing are
              preserved. Activation waits for verified backups; no placeholder
              photos are created.
            </p>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  setMessage("Verifying the existing private media library…");
                  await client.verifyMedia?.();
                  const baseline = await importCarouselBaseline(
                    onUploadMedia,
                    baselineMedia.current,
                    setMessage,
                  );
                  baselineCommand.current ??= crypto.randomUUID();
                  const result = await client.command({
                    action: "bootstrap",
                    commandId: baselineCommand.current,
                    expectedVersion: 0,
                    expectedPublishedId: null,
                    document: baseline,
                  });
                  if (result.state) apply(result.state);
                  setMessage(
                    "The approved carousel is now managed and backed up.",
                  );
                } catch (failure) {
                  setMessage("");
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "The import could not be completed. Retry to reuse completed images.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy
                ? "Preparing carousel…"
                : "Import and verify current carousel"}
            </button>
          </>
        )}
        {error && (
          <button
            disabled={busy}
            onClick={() => {
              setError("");
              client
                .read()
                .then(apply)
                .catch((failure) => setError(failure.message));
            }}
          >
            Try again
          </button>
        )}
      </section>
    );
  const entry = document.entries[selected];
  const availableImages: CarouselImage[] = [...state.projection.images];
  for (const asset of mediaAssets)
    if (
      asset.width &&
      asset.height &&
      !availableImages.some((image) => image.revisionId === asset.revisionId)
    )
      availableImages.push({
        ...asset,
        width: asset.width,
        height: asset.height,
        ready: asset.replicaStatus === "ready",
      });
  const projection = {
    revisionId: state.draft.id,
    document,
    images: availableImages,
  };
  const imageFor = (photo: CarouselEntry) =>
    availableImages.find(
      (image) => image.revisionId === photo.media.revisionId,
    );
  const move = (step: number) => {
    const next = selected + step;
    if (next < 0 || next > 7) return;
    const entries = [...document.entries];
    [entries[next], entries[selected]] = [entries[selected], entries[next]];
    change({ ...document, entries });
    setSelected(next);
  };
  const appearance = scope === "photo" ? entry : document.defaults;
  const blend = appearance.blend;
  const setAppearance = (
    value: Partial<CarouselEntry & CarouselDocumentV1["defaults"]>,
  ) => (scope === "photo" ? patch(value) : updateDefaults(value));
  const selectReview = (
    nextDevice: typeof device,
    nextLocale: typeof locale,
  ) => {
    setDevice(nextDevice);
    setLocale(nextLocale);
    setSeen((current) => [
      ...new Set([...current, `${nextDevice}-${nextLocale}`]),
    ]);
  };
  return (
    <section ref={root} className={styles.studio} aria-label="Carousel Studio">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>HOMEPAGE · EIGHT PHOTOS</span>
          <h1>Carousel Studio</h1>
          <p>Choose a photo, adjust its appearance, then review and publish.</p>
        </div>
        <div className={styles.actions}>
          <span className={styles.status}>
            {dirty
              ? "Unsaved changes"
              : state.draft.id === state.published.id
                ? "Published revision"
                : "Saved draft"}
          </span>
          <button onClick={() => setHistory(true)}>History</button>
          <button
            disabled={!editable || busy || !dirty}
            onClick={() => void save()}
          >
            Save draft
          </button>
          <button
            className={styles.primary}
            disabled={
              !publishable ||
              busy ||
              dirty ||
              state.draft.id === state.published.id
            }
            onClick={() =>
              void run({
                ...base(),
                action: "review",
                revisionId: state.draft.id,
              })
            }
          >
            Review saved draft
          </button>
        </div>
      </header>
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
      {error && (
        <div role="alert" className={styles.error}>
          {error}
          {authRequired && (
            <p>
              <a
                target="_blank"
                rel="noopener noreferrer"
                href="/admin/login?returnTo=%2Fadmin%2Feditor%3Fworkspace%3Dwebsite.carousel"
              >
                Sign in in another tab
              </a>{" "}
              — leave this tab open to keep your work.
            </p>
          )}
          {retry && (
            <button disabled={busy} onClick={() => void run(retry)}>
              Retry the same action
            </button>
          )}
        </div>
      )}
      <div className={styles.columns}>
        <aside className={styles.photoList} aria-label="Carousel photo slots">
          <div className={styles.panelTitle}>
            <h2>Photo order</h2>
            <span>8 / 8</span>
          </div>
          <p>One image per slide. Select a slot to edit it.</p>
          <ol>
            {document.entries.map((photo, index) => (
              <li key={photo.id} data-carousel-slot>
                <button
                  className={index === selected ? styles.selected : ""}
                  aria-current={index === selected ? "true" : undefined}
                  onClick={() => {
                    setSelected(index);
                    setScope("photo");
                  }}
                >
                  <span className={styles.number}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageFor(photo)?.url} alt="" />
                  <span>
                    <strong>{photo.en.title || "Untitled photo"}</strong>
                    <small>
                      {photo.en.alt && photo.es.alt
                        ? "English + Spanish"
                        : "Needs descriptions"}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className={styles.reorder}>
            <button
              disabled={!editable || busy || selected === 0}
              onClick={() => move(-1)}
            >
              <ArrowUp size={16} /> Earlier
            </button>
            <button
              disabled={!editable || busy || selected === 7}
              onClick={() => move(1)}
            >
              <ArrowDown size={16} /> Later
            </button>
          </div>
          <p>
            Eight fixed slots keep the homepage consistent. Replace an image or
            change its order.
          </p>
        </aside>
        <div className={styles.previewPanel}>
          <div className={styles.panelTitle}>
            <h2>Live preview</h2>
            <span>Preview only</span>
          </div>
          <div className={styles.previewTools}>
            <div>
              <button
                aria-pressed={device === "desktop"}
                onClick={() => setDevice("desktop")}
              >
                <Monitor size={17} /> Desktop
              </button>
              <button
                aria-pressed={device === "mobile"}
                onClick={() => setDevice("mobile")}
              >
                <Smartphone size={17} /> Mobile
              </button>
            </div>
            <div>
              <button
                aria-pressed={locale === "en"}
                onClick={() => setLocale("en")}
              >
                English
              </button>
              <button
                aria-pressed={locale === "es"}
                onClick={() => setLocale("es")}
              >
                Español
              </button>
            </div>
          </div>
          <PreviewFrame device={device}>
            <CommunityCarousel
              key={`${entry.id}-${device}`}
              locale={locale}
              projection={projection}
              initialIndex={selected}
            />
          </PreviewFrame>
          <p className={styles.previewNote}>
            This is the homepage carousel renderer. It starts still; use Play to
            check timing and effects. Reduced-motion preferences are respected.
          </p>
        </div>
        <aside className={styles.settings}>
          <div
            className={styles.tabs}
            role="tablist"
            aria-label="Settings scope"
          >
            <button
              role="tab"
              aria-selected={scope === "photo"}
              onClick={() => setScope("photo")}
            >
              This photo
            </button>
            <button
              role="tab"
              aria-selected={scope === "carousel"}
              onClick={() => setScope("carousel")}
            >
              Whole carousel
            </button>
          </div>
          <fieldset disabled={!editable || busy} className={styles.controls}>
            {scope === "photo" ? (
              <>
                <span className={styles.eyebrow}>
                  PHOTO {String(selected + 1).padStart(2, "0")}
                </span>
                <h2>{entry.en.title || "Describe this image"}</h2>
                <button
                  className={styles.replace}
                  onClick={() => {
                    setPicker(true);
                    void onRefreshMedia();
                  }}
                >
                  <ImagePlus size={18} /> Replace image
                </button>
                <p>
                  Replacing an image clears its old descriptions and effects.
                </p>
                <details open>
                  <summary>English & Spanish descriptions</summary>
                  {(["en", "es"] as const).map((language) => (
                    <div key={language} className={styles.language}>
                      <h3>{language === "en" ? "English" : "Español"}</h3>
                      {(["title", "caption", "alt"] as const).map((field) => (
                        <label key={field}>
                          {field === "alt"
                            ? "Accessibility description"
                            : field === "title"
                              ? "Short title"
                              : "Caption"}{" "}
                          <small>
                            {field === "alt"
                              ? "Required"
                              : "Optional · both languages"}
                          </small>
                          <textarea
                            rows={field === "title" ? 1 : 3}
                            maxLength={field === "title" ? 100 : 300}
                            value={entry[language][field]}
                            onChange={(event) =>
                              patch({
                                [language]: {
                                  ...entry[language],
                                  [field]: event.target.value.replace(
                                    /[\r\n]+/g,
                                    " ",
                                  ),
                                },
                              })
                            }
                            required={field === "alt"}
                          />
                        </label>
                      ))}
                    </div>
                  ))}
                  <p>
                    Describe what the photo actually shows. Do not reuse
                    descriptions from a different event.
                  </p>
                </details>
                <details>
                  <summary>Framing & focal point</summary>
                  <Framing
                    label="Desktop framing"
                    value={entry.desktop}
                    onChange={(desktop) => patch({ desktop })}
                  />
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={entry.mobile !== null}
                      onChange={(event) =>
                        patch({
                          mobile: event.target.checked
                            ? { ...entry.desktop }
                            : null,
                        })
                      }
                    />{" "}
                    Use different mobile framing
                  </label>
                  {entry.mobile && (
                    <Framing
                      label="Mobile framing"
                      value={entry.mobile}
                      onChange={(mobile) => patch({ mobile })}
                    />
                  )}
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={entry.captionSafeMobile}
                      onChange={(event) =>
                        patch({ captionSafeMobile: event.target.checked })
                      }
                    />{" "}
                    Keep the image above captions on mobile
                  </label>
                </details>
              </>
            ) : (
              <>
                <span className={styles.eyebrow}>DEFAULTS FOR ALL PHOTOS</span>
                <h2>Whole carousel</h2>
                <label className={styles.check}>
                  <input type="checkbox" checked={document.defaults.showCaptions === true}
                    onChange={(event) => updateDefaults({ showCaptions: event.target.checked })} />
                  Show photo titles and captions across the website
                </label>
                <p>Off by default. This also controls captions on page photographs; accessibility descriptions remain available. Save, review, and publish to apply it.</p>
                <p>
                  Hidden by default for every slide. Descriptions remain saved in both languages,
                  and accessibility descriptions are always available. Save, review and publish to update the live site.
                </p>
                <p>
                  Photos use these settings unless you choose an individual
                  override. Playback always starts still.
                </p>
              </>
            )}
            <details open>
              <summary>Motion & timing</summary>
              <label>
                Transition
                <select
                  value={appearance.transition ?? "inherit"}
                  onChange={(event) =>
                    setAppearance({
                      transition:
                        event.target.value === "inherit"
                          ? null
                          : (event.target.value as "none" | "fade" | "slide"),
                    } as Partial<
                      CarouselEntry & CarouselDocumentV1["defaults"]
                    >)
                  }
                >
                  {scope === "photo" && (
                    <option value="inherit">Use carousel default</option>
                  )}
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                  <option value="slide">Slide</option>
                </select>
              </label>
              <label>
                Time per photo when playing
                <select
                  value={appearance.seconds ?? "inherit"}
                  onChange={(event) =>
                    setAppearance({
                      seconds:
                        event.target.value === "inherit"
                          ? null
                          : Number(event.target.value),
                    } as Partial<
                      CarouselEntry & CarouselDocumentV1["defaults"]
                    >)
                  }
                >
                  {scope === "photo" && (
                    <option value="inherit">Use carousel default</option>
                  )}
                  {[5, 7, 10].map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} seconds
                    </option>
                  ))}
                </select>
              </label>
              {scope === "carousel" ? (
                <label>
                  Transition speed
                  <select
                    value={document.defaults.speed}
                    onChange={(event) =>
                      updateDefaults({
                        speed: Number(event.target.value) as 350 | 700 | 1100,
                      })
                    }
                  >
                    <option value="350">Quick · 0.35 seconds</option>
                    <option value="700">Balanced · 0.7 seconds</option>
                    <option value="1100">Gentle · 1.1 seconds</option>
                  </select>
                </label>
              ) : (
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={entry.zoom}
                    onChange={(event) => patch({ zoom: event.target.checked })}
                  />{" "}
                  Gentle zoom while playing (up to 4%)
                </label>
              )}
            </details>
            <details>
              <summary>Navy fade</summary>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={blend !== null}
                  onChange={(event) =>
                    setAppearance({
                      blend: event.target.checked
                        ? { top: 30, bottom: 65 }
                        : null,
                    })
                  }
                />{" "}
                {scope === "photo"
                  ? "Override this photo’s fade"
                  : "Customize the original navy fade"}
              </label>
              {blend &&
                (["top", "bottom"] as const).map((edge) => (
                  <label key={edge}>
                    {edge === "top" ? "Top" : "Bottom"} fade · {blend[edge]}%
                    <input
                      type="range"
                      min={edge === "top" ? 0 : 30}
                      max={edge === "top" ? 75 : 85}
                      value={blend[edge]}
                      onChange={(event) =>
                        setAppearance({
                          blend: {
                            ...blend,
                            [edge]: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
              <p>
                {scope === "photo"
                  ? "Unchecked uses the carousel default."
                  : "Unchecked preserves the existing responsive fade."}{" "}
                Captions retain a readable navy background.
              </p>
            </details>
            {scope === "photo" && (
              <button
                className={styles.reset}
                onClick={() =>
                  dirty
                    ? setResetPending(true)
                    : patch(resetCarouselAppearance(entry))
                }
              >
                <RotateCcw size={16} /> Reset photo appearance
              </button>
            )}
          </fieldset>
        </aside>
      </div>
      {resetPending && (
        <Dialog
          title="Reset this photo’s appearance?"
          onClose={() => setResetPending(false)}
        >
          <p>
            This replaces its unsaved framing, timing, movement and fade
            settings with the defaults. Its image, descriptions and position are
            kept.
          </p>
          <button onClick={() => setResetPending(false)}>
            Keep current appearance
          </button>
          <button
            onClick={() => {
              patch(resetCarouselAppearance(entry));
              setResetPending(false);
            }}
          >
            Reset appearance
          </button>
        </Dialog>
      )}
      {picker && (
        <Dialog title="Choose a managed image" onClose={() => setPicker(false)}>
          <p>
            Only images from this site’s media gallery are available. A verified
            backup is required before publication.
          </p>
          {mediaError && (
            <p role="alert">{mediaError} Your current image is unchanged.</p>
          )}
          <label>
            Search images
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button onClick={() => void onRefreshMedia()}>Refresh gallery</button>
          {role === "owner" && client.verifyMedia && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await client.verifyMedia!();
                  setMessage(
                    "Media library verified. Uploads are available for the next seven days.",
                  );
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "Media verification failed.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Verify media library
            </button>
          )}
          <div className={styles.mediaGrid}>
            {mediaAssets
              .filter((asset) =>
                asset.label.toLowerCase().includes(search.toLowerCase()),
              )
              .map((asset) => (
                <button
                  key={asset.revisionId}
                  disabled={!asset.width || !asset.height}
                  onClick={() => {
                    patch(
                      replaceCarouselPhoto(entry, {
                        mediaId: asset.mediaId,
                        revisionId: asset.revisionId,
                      }),
                    );
                    setPicker(false);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.url} alt="" loading="lazy" />
                  <strong>{asset.label}</strong>
                  <small>
                    {asset.replicaStatus === "ready"
                      ? "Backup ready"
                      : "Backup pending — draft only"}
                  </small>
                </button>
              ))}
          </div>
          {onUploadMedia && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!upload) return;
                setBusy(true);
                void onUploadMedia(upload, {
                  label: uploadLabel,
                  alt: uploadAlt,
                })
                  .then(() => {
                    setUpload(null);
                    setMessage(
                      "Uploaded. Choose the new image from the refreshed gallery.",
                    );
                  })
                  .catch(() =>
                    setError(
                      "The upload could not be completed. Check the file and try again.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              <h3>Upload a new image</h3>
              <label>
                JPEG image file
                <input
                  type="file"
                  accept="image/jpeg,.jpg,.jpeg"
                  required
                  onChange={(event) =>
                    setUpload(event.target.files?.[0] ?? null)
                  }
                />
              </label>
              <label>
                Gallery name
                <input
                  required
                  maxLength={100}
                  value={uploadLabel}
                  onChange={(event) => setUploadLabel(event.target.value)}
                />
              </label>
              <label>
                Image description
                <input
                  required
                  maxLength={300}
                  value={uploadAlt}
                  onChange={(event) => setUploadAlt(event.target.value)}
                />
              </label>
              <button disabled={busy || !upload}>
                <Images size={16} /> Upload to media gallery
              </button>
            </form>
          )}
        </Dialog>
      )}
      {review && (
        <Dialog
          title="Review this saved revision"
          onClose={() => setReview(null)}
        >
          <p>
            Nothing here changes your draft. Review English and Spanish at both
            sizes before publishing.
          </p>
          <div className={styles.previewTools}>
            {(["desktop", "mobile"] as const).flatMap((size) =>
              (["en", "es"] as const).map((language) => (
                <button
                  key={`${size}-${language}`}
                  aria-pressed={device === size && locale === language}
                  onClick={() => selectReview(size, language)}
                >
                  {seen.includes(`${size}-${language}`) ? "✓ " : ""}
                  {size === "desktop" ? "Desktop" : "Mobile"} ·{" "}
                  {language === "en" ? "English" : "Español"}
                </button>
              )),
            )}
          </div>
          <PreviewFrame device={device}>
            <CommunityCarousel
              key={`${review.revisionId}-${device}-${locale}`}
              locale={locale}
              projection={review.projection}
            />
          </PreviewFrame>
          <h3>Changes from the published version</h3>
          <ul>
            {review.changes.map((change, index) => (
              <li key={index}>
                {change.category} · {change.label}
              </li>
            ))}
          </ul>
          <p>
            Revision {review.revisionId.slice(0, 8)} · review expires in ten
            minutes. Publishing prepares and verifies a full recovery generation
            first.
          </p>
          <button
            className={styles.primary}
            disabled={busy || seen.length < 4 || !publishable}
            onClick={() =>
              void run({
                ...base(),
                action: "publish",
                commandId: crypto.randomUUID(),
                revisionId: review.revisionId,
                reviewToken: review.token,
              })
            }
          >
            Publish reviewed draft
          </button>
        </Dialog>
      )}
      {history && (
        <Dialog title="Carousel history" onClose={() => setHistory(false)}>
          <p>
            Latest 100 recorded actions. Restoring creates a new draft; it does
            not overwrite the live carousel.
          </p>
          <label>
            Filter by change
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              {[
                "all",
                "image",
                "captions",
                "order",
                "appearance",
                "publish",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {state.history
            .filter(
              (item) =>
                filter === "all" ||
                item.action === filter ||
                item.changes.some((change) => change.category === filter),
            )
            .map((item) => (
              <article className={styles.historyItem} key={item.id}>
                <h3>
                  {item.action} · {new Date(item.created_at).toLocaleString()}
                </h3>
                {item.actor_id && <p>Staff account: {item.actor_id}</p>}
                {item.changes.map((change, index) => (
                  <details key={index}>
                    <summary>
                      {change.category} · {change.label}
                    </summary>
                    <strong>Before</strong>
                    <pre>{change.before}</pre>
                    <strong>After</strong>
                    <pre>{change.after}</pre>
                  </details>
                ))}
                <button
                  disabled={!editable || busy || dirty}
                  onClick={() => {
                    void run({
                      ...base(),
                      action: "restore",
                      commandId: crypto.randomUUID(),
                      revisionId: item.result_revision_id,
                    }).then((ok) => {
                      if (ok) setHistory(false);
                    });
                  }}
                >
                  Restore as a new draft
                </button>
              </article>
            ))}
        </Dialog>
      )}
      {conflict && (
        <Dialog
          title="A newer version was saved"
          onClose={() => setConflict(null)}
        >
          <p>
            Your work has not been discarded. Compare the photo order and
            descriptions below, then keep working or explicitly load the latest
            draft.
          </p>
          <div className={styles.comparison}>
            <div>
              <h3>Your current work</h3>
              {document.entries.map((photo) => (
                <p key={photo.id}>
                  {photo.en.title || photo.id} — {photo.en.caption}
                </p>
              ))}
            </div>
            <div>
              <h3>Latest saved draft</h3>
              {conflict.draft.document.entries.map((photo) => (
                <p key={photo.id}>
                  {photo.en.title || photo.id} — {photo.en.caption}
                </p>
              ))}
            </div>
          </div>
          <button onClick={() => setConflict(null)}>Keep my work here</button>
          <button
            onClick={() => {
              apply(conflict);
              setConflict(null);
              setError("");
            }}
          >
            Discard my edits and load latest
          </button>
        </Dialog>
      )}
      {leaving && (
        <Dialog
          title="Save your carousel changes?"
          onClose={() => setLeaving(false)}
        >
          <p>Your changes are only in this tab until saved.</p>
          <div className={styles.actions}>
            <button onClick={() => setLeaving(false)}>Stay here</button>
            <button onClick={leave}>Discard and leave</button>
            <button
              className={styles.primary}
              disabled={busy}
              onClick={() => {
                void save().then((ok) => {
                  if (ok) leave();
                });
              }}
            >
              Save draft and leave
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
