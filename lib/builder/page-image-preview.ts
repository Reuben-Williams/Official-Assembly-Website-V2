import type {EditableValue} from '@reuben-williams/core';

/** Private editor previews only. Public pages remain server-rendered. */
export function applyDraftPageImages(root:Document,regions:Readonly<Record<string,EditableValue>>) {
  for(const element of root.querySelectorAll<HTMLElement>('[data-builder-region][data-builder-kind="image"]')) {
    const value=regions[element.dataset.builderRegion ?? ''];
    if(value?.type!=='image') continue;
    let url:URL;
    try {url=new URL(value.src,root.baseURI);}catch{continue;}
    if(!['http:','https:'].includes(url.protocol) || url.username || url.password) continue;
    const images=element instanceof HTMLImageElement ? [element] : [...element.querySelectorAll('img')];
    for(const image of images) {
      // Next/Image and picture art direction otherwise take precedence over src.
      image.removeAttribute('srcset');
      for(const source of image.closest('picture')?.querySelectorAll('source') ?? []) source.removeAttribute('srcset');
      image.setAttribute('src',value.src);
      if(image.getAttribute('aria-hidden')!=='true') image.alt=value.alt ?? 'District office media';
    }
  }
}
