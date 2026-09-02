import Image from "next/image";
import { Camera } from "lucide-react";

import {
  builderImage,
  type BuilderServerContent,
} from "../../lib/builder/server-content";
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
  const resolved = builderImage(content, asset.regionId, asset);
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
    >
      <picture>
        {mobileSrc ? <source media="(max-width: 640px)" srcSet={mobileSrc} /> : null}
        <Image
          src={src}
          alt={localizedBuilderText(locale, `${asset.regionId}.alt`, resolved.alt)}
          fill
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
        <span>{localizedBuilderText(locale, `${asset.regionId}.caption`, caption)}</span>
      </div>
    </div>
  );
}
