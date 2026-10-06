"use client";

import { useId, useState } from "react";
import { Check, ImageOff, Images, RefreshCw, Search, X } from "lucide-react";
import styles from "./calendar-image-picker.module.css";

export type CalendarMediaChoice = {
  mediaId: string;
  label: string;
  url: string;
  alt?: string;
  width?: number;
  height?: number;
};

export function CalendarImagePicker({ value, onChange, mediaAssets, disabled, loading = false, error = "", onRefresh }: {
  value: string;
  onChange: (mediaId: string) => void;
  mediaAssets: readonly CalendarMediaChoice[];
  disabled: boolean;
  loading?: boolean;
  error?: string;
  onRefresh?: () => Promise<void>;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(() => new Set());
  const selected = mediaAssets.find(asset => asset.mediaId === value);
  const visible = mediaAssets.filter(asset => asset.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const fail = (url: string) => setFailedUrls(previous => previous.has(url) ? previous : new Set([...previous, url]));
  const selectedUnavailable = !selected || failedUrls.has(selected.url);

  return <section className={styles.picker} data-calendar-image-picker aria-labelledby={`${id}-title`}>
    <div className={styles.heading}>
      <div><h3 id={`${id}-title`}><Images aria-hidden="true" size={18} /> Event image (optional)</h3>
        <p>Choose a photograph or flyer. Save your draft to keep the selection.</p></div>
      {onRefresh ? <button className={styles.refresh} type="button" disabled={loading} onClick={() => void onRefresh()}>
        <RefreshCw aria-hidden="true" size={16} /> Refresh images
      </button> : null}
    </div>
    <div className={styles.selected} data-selected-image-preview aria-live="polite">
      {value ? <>
        <div className={styles.preview}>
          {selectedUnavailable ? <span><ImageOff aria-hidden="true" /> Image preview unavailable</span> :
            /* Authorized short-lived gallery URLs stay in the browser; only mediaId is saved. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img key={selected.url} src={selected.url} alt={selected.alt || selected.label} width={selected.width} height={selected.height} onError={() => fail(selected.url)} />}
        </div>
        <div className={styles.selectionInfo}><span className={styles.selectedLabel}><Check aria-hidden="true" size={16} /> Selected image</span>
          <strong>{selected?.label ?? "Saved image"}</strong>
          {selectedUnavailable ? <p>The saved choice is retained. Refresh, replace, or remove it.</p> : null}
          <button className={styles.remove} type="button" disabled={disabled} onClick={() => onChange("")}><X aria-hidden="true" size={16} /> Remove image</button>
        </div>
      </> : <p className={styles.noSelection}><Images aria-hidden="true" /> No image selected. You can publish an event without an image.</p>}
    </div>
    <label className={styles.search} htmlFor={`${id}-search`}><span>Search images</span>
      <span className={styles.searchField}><Search aria-hidden="true" size={18} /><input id={`${id}-search`} type="search" placeholder="Search by image name" value={search} onChange={event => setSearch(event.currentTarget.value)} /></span>
    </label>
    {loading ? <p role="status" className={styles.message}>Loading images… Your current selection is kept.</p> : null}
    {error ? <p role="alert" className={styles.error}>{error} Your current selection is unchanged.</p> : null}
    {!loading && !error && !mediaAssets.length ? <p className={styles.message}>No images in the media library. Add images in Media, then refresh here.</p> : null}
    {!loading && mediaAssets.length > 0 && !visible.length ? <p role="status" className={styles.message}>No images match your search.</p> : null}
    {visible.length > 0 ? <div className={styles.grid} role="group" aria-label="Available event images" aria-busy={loading}>
      {visible.map(asset => {
        const failed = failedUrls.has(asset.url);
        const chosen = asset.mediaId === value;
        return <button key={asset.mediaId} className={styles.tile} type="button" aria-label={`Select image: ${asset.label}`} aria-pressed={chosen}
          disabled={disabled || loading || failed} onClick={() => onChange(asset.mediaId)}>
          <span className={styles.thumbnail}>{failed ? <span className={styles.unavailable}><ImageOff aria-hidden="true" size={24} /> Preview unavailable</span> :
            /* eslint-disable-next-line @next/next/no-img-element */
            <img key={asset.url} src={asset.url} alt="" width={asset.width} height={asset.height} loading="lazy" decoding="async" onError={() => fail(asset.url)} />}
            {chosen ? <span className={styles.check}><Check aria-hidden="true" size={16} /></span> : null}
          </span><strong>{asset.label}</strong>
        </button>;
      })}
    </div> : null}
  </section>;
}
