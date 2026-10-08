"use client";

import { BuilderPreviewBridge } from "@reuben-williams/next";
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';
import type {PageContent} from '@reuben-williams/core';
import {applyDraftPageImages} from '../lib/builder/page-image-preview';

import { BUILDER_SITE_KEY } from "../lib/builder/authorization";

export function BuilderContentBridge() {
  const pathname=usePathname();
  const [previewError,setPreviewError]=useState(false);
  useEffect(()=>{
    const params=new URL(window.location.href).searchParams;
    if(window.parent===window || params.get('builderPreview')!=='1' || params.get('builderSiteId')!==BUILDER_SITE_KEY) return;
    const abort=new AbortController();
    const query=new URLSearchParams({mode:'draft',path:pathname});
    void fetch(`/api/builder?${query}`,{credentials:'same-origin',cache:'no-store',signal:abort.signal})
      .then(async response=>{if(!response.ok)throw new Error('draft-unavailable');return response.json() as Promise<PageContent>;})
      .then(content=>{if(!abort.signal.aborted){applyDraftPageImages(document,content.regions);setPreviewError(false);}})
      .catch(()=>{if(!abort.signal.aborted)setPreviewError(true);});
    return ()=>abort.abort();
  },[pathname]);
  return <><BuilderPreviewBridge siteId={BUILDER_SITE_KEY} />{previewError ?
    <p role="alert">Saved photos could not be loaded. Refresh the staff portal before editing.</p> : null}</>;
}
