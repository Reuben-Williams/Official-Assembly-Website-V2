import Image from "next/image";
import { Camera } from "lucide-react";

import type { BuilderServerContent } from "../../lib/builder/server-content";
import type { ImageAsset } from "../data/site";
import { localizedBuilderText } from "../i18n/catalog.server";
import type { PublicLocale } from "../i18n/locale";

type ImagePanelProps = {
  asset: ImageAsset;
  caption: string;
  instance?: string;
  priority?: boolean;
  variant?: "hero" | "wide";
  content?: BuilderServerContent;
  locale?: PublicLocale;
};

const EMPTY_CONTENT: BuilderServerContent = { regions: {} };

export function ImagePanel({
  asset,
  caption,
  instance = "default",
  priority = false,
  variant = "wide",
  content = EMPTY_CONTENT,
  locale = "en",
}: ImagePanelProps) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const stored = [asset.regionId, ...(asset.legacyRegionIds ?? [])]
    .map((id) => content.regions[id]).find((value) => value?.type === "image");
  const resolved = stored?.type === "image" && !asset.retiredSources?.includes(stored.src)
    ? { src: stored.src, alt: stored.alt || (stored.src === asset.src ? asset.alt : "District office media") } : asset;
  const usesDefaultPhoto = resolved.src === asset.src;
  const fullFrame = asset.fullFrame === true;
  const alt = locale === "es" && usesDefaultPhoto && resolved.alt === asset.alt && asset.altEs
    ? asset.altEs : localizedBuilderText(locale, `${asset.regionId}.alt`, resolved.alt);
  // An office-selected replacement must not inherit a description of the default photograph.
  const photoCaption = !usesDefaultPhoto && asset.caption
    ? localizedBuilderText(locale, "global.template.supporting-caption", "District office media")
    : locale === "es" && asset.captionEs && caption === asset.caption
      ? asset.captionEs : localizedBuilderText(locale, `${asset.regionId}.caption`, caption);
  const src = resolved.src.startsWith("/") ? `${basePath}${resolved.src}` : resolved.src;
  const mobileSrc = resolved.src === asset.src && asset.mobileSrc
    ? (asset.mobileSrc.startsWith("/") ? `${basePath}${asset.mobileSrc}` : asset.mobileSrc)
    : null;

  return (
    <div
      className={`image-card ${variant === "hero" ? "hero-image" : "wide-image"}`}
      data-builder-instance={instance}
      data-builder-kind="image"
      data-builder-region={asset.regionId}
      data-editorial-full-frame={fullFrame || undefined}
      style={fullFrame ? { aspectRatio: "auto", height: "auto", minHeight: 0 } : undefined}
    >
      <picture>
        {mobileSrc ? <source media="(max-width: 640px)" srcSet={mobileSrc} /> : null}
        <Image
          src={src}
          alt={alt}
          fill={!fullFrame}
          width={fullFrame ? asset.width : undefined}
          height={fullFrame ? asset.height : undefined}
          priority={priority}
          sizes={
            variant === "hero"
              ? "(max-width: 920px) 100vw, 44vw"
              : "(max-width: 920px) 100vw, 52vw"
          }
        />
      </picture>
      <div className="image-caption">
        <Camera size={18} aria-hidden="true" />
        <span>{photoCaption}</span>
      </div>
    </div>
  );
}
