"use client";
import { useCallback, useEffect, useState } from "react";
import { Folder, Images, Trash2, Upload, RotateCcw } from "lucide-react";
import type { MediaAsset } from "@reuben-williams/core";
import { editorFetch } from "../../../lib/builder/editor-fetch";
import { EMPTY_MEDIA_LIBRARY, type MediaLibrarySnapshot } from "../../../lib/builder/media-library";
import styles from "./media-library-workspace.module.css";

export function MediaLibraryWorkspace({ role, csrf, upload, onChanged }: {
  role: string; csrf: () => string | null; upload?: (file: File) => Promise<MediaAsset>; onChanged: () => void;
}) {
  const [snapshot, setSnapshot] = useState(EMPTY_MEDIA_LIBRARY);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [folder, setFolder] = useState("all");
  const [destination, setDestination] = useState("");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canEdit = ["owner", "editor"].includes(role);
  const refresh = useCallback(async () => {
    const response = await editorFetch("/api/builder/media-library", { cache: "no-store", credentials: "same-origin" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "The library could not be loaded.");
    setSnapshot(data as MediaLibrarySnapshot); setAssets(data.assets); setReady(true);
  }, []);
  useEffect(() => {
    let active = true;
    void editorFetch("/api/builder/media-library", { cache: "no-store", credentials: "same-origin" }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "The library could not be loaded.");
      if (active) { setSnapshot(data); setAssets(data.assets); setReady(true); }
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  const command = async (action: string, extra: Record<string, unknown>) => {
    if (busy || !canEdit) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const token = csrf(); if (!token) throw new Error("Sign in again before changing the library.");
      const response = await editorFetch("/api/builder/media-library", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-builder-csrf": token }, body: JSON.stringify({ action, version: snapshot.version, ...extra }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "This action could not be saved.");
      setSnapshot(data); setSelected([]); setName(""); onChanged();
      setNotice(action === "trash" ? "Moved to Trash. Existing published uses are unchanged. You can restore these images here." : action === "restore" ? "Images restored to the library." : action === "move" ? "Images moved." : "Folder created.");
    } catch (error) { setError(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  };
  const visible = assets.filter(asset => {
    const trashed = snapshot.state.trashed.includes(asset.id);
    return (folder === "trash" ? trashed : !trashed && (folder === "all" || (snapshot.state.placements[asset.id] ?? "unfiled") === folder))
      && `${asset.label} ${asset.alt}`.toLowerCase().includes(query.toLowerCase());
  });
  const chooseFolder = (id: string) => { setFolder(id); setSelected([]); };
  const move = (folderId: string | null, ids = selected) => { if (ids.length) void command("move", { ids, folderId }); };
  return <section className={styles.workspace} aria-busy={busy}>
    <header className={styles.header}><div><p>WEBSITE · MEDIA</p><h1>Image library</h1><span>Organize photos, choose them on a page, then Save draft and Publish to update the website.</span></div>
      {upload && canEdit && <label className={styles.upload}><Upload size={18} /> Upload images<input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async event => {
        const files = [...(event.target.files ?? [])]; event.target.value = ""; if (!files.length) return;
        if (files.length > 25) { setError("Upload up to 25 images at a time."); return; }
        setBusy(true); setError(""); let completed = 0;
        try { for (const file of files) { setNotice(`Uploading ${completed + 1} of ${files.length}: ${file.name}`); await upload(file); completed++; }
          setNotice(`${completed} images added. Names use the filename; you can add an image description when placing a photo.`);
        } catch (error) { setError(`${completed} images completed. ${error instanceof Error ? error.message : "Upload failed."}`); }
        finally { await refresh().catch(error => setError(error.message)); onChanged(); setBusy(false); }
      }} /></label>}</header>
    <p>JPG, PNG, or WebP · originals up to 50 MiB. Large photos are resized automatically without cropping; your original stays unchanged. Extra upload details are optional. Trash is recoverable and never erases published photographs.</p>
    {error && <div role="alert" className={styles.error}>{error} <button type="button" disabled={busy} onClick={() => { setError(""); void refresh().catch(error => setError(error.message)); }}>Refresh library</button></div>}
    <p role="status">{notice}</p>
    <div className={styles.layout}><aside aria-label="Media folders">
      {[{ id: "all", name: "All images" }, { id: "unfiled", name: "Unfiled" }, ...snapshot.state.folders, { id: "trash", name: "Trash" }].map(item => <button key={item.id} type="button" aria-pressed={folder === item.id} onClick={() => chooseFolder(item.id)} disabled={busy}
        onDragOver={event => { if (canEdit && item.id !== "all" && item.id !== "trash") event.preventDefault(); }}
        onDrop={event => { event.preventDefault(); if (!canEdit || busy || ["all", "trash"].includes(item.id)) return;
          try { const ids = JSON.parse(event.dataTransfer.getData("application/x-morales-media")); if (Array.isArray(ids)) move(item.id === "unfiled" ? null : item.id, ids); } catch { setError("Select images and use Move to folder."); }
        }}>{item.id === "trash" ? <Trash2 size={18} /> : item.id === "all" ? <Images size={18} /> : <Folder size={18} />}{item.name}</button>)}
      {canEdit && <form onSubmit={event => { event.preventDefault(); void command("create-folder", { name }); }}><label htmlFor="new-media-folder">New folder</label><input id="new-media-folder" value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="e.g. Community events" /><button disabled={busy || !ready || !name.trim()}>Create folder</button></form>}
    </aside><div>
      <label className={styles.search}>Find an image<input type="search" value={query} onChange={event => { setQuery(event.target.value); setSelected([]); }} placeholder="Search filenames or descriptions" /></label>
      {canEdit && <div className={styles.toolbar}>
        <label><input type="checkbox" disabled={busy || !visible.length} checked={visible.length > 0 && visible.slice(0, 100).every(asset => selected.includes(asset.id))} onChange={event => setSelected(event.target.checked ? visible.slice(0, 100).map(asset => asset.id) : [])} /> Select visible (up to 100)</label><span>{selected.length} selected</span>
        {folder === "trash" ? <button type="button" disabled={busy || !selected.length} onClick={() => void command("restore", { ids: selected })}><RotateCcw size={16} /> Restore</button> : <>
          <label>Move to <select value={destination} onChange={event => setDestination(event.target.value)}><option value="">Unfiled</option>{snapshot.state.folders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <button type="button" disabled={busy || !selected.length} onClick={() => move(destination || null)}>Move</button>
          <button type="button" disabled={busy || !selected.length} onClick={() => void command("trash", { ids: selected })}><Trash2 size={16} /> Move to Trash</button>
        </>}
      </div>}
      {!ready ? <p>Loading the image library…</p> : !visible.length ? <p>No images in this view.</p> : <div className={styles.grid}>{visible.map(asset => <label key={asset.id} className={styles.card} data-selected={selected.includes(asset.id)} draggable={canEdit && !busy && folder !== "trash"}
        onDragStart={event => { event.dataTransfer.setData("application/x-morales-media", JSON.stringify(selected.includes(asset.id) ? selected : [asset.id])); event.dataTransfer.effectAllowed = "move"; }}>
        {canEdit && <input type="checkbox" disabled={busy} checked={selected.includes(asset.id)} onChange={event => setSelected(value => event.target.checked ? [...value, asset.id].slice(0, 100) : value.filter(id => id !== asset.id))} aria-label={`Select ${asset.label}`} />}
        {/* Private preview URLs intentionally bypass public image optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset.url} alt={asset.alt || asset.label} loading="lazy" /><strong>{asset.label}</strong>
      </label>)}</div>}
    </div></div>
  </section>;
}
