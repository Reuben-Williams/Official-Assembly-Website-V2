import Image from "next/image";
import { Camera } from "lucide-react";

import type { ImageAsset } from "../data/site";

type ImagePanelProps = {
  asset: ImageAsset;
  caption: string;
  priority?: boolean;
  variant?: "hero" | "wide";
};

export function ImagePanel({
  asset,
  caption,
  priority = false,
  variant = "wide"
}: ImagePanelProps) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const src = `${basePath}${asset.src}`;

  return (
    <div className={`image-card ${variant === "hero" ? "hero-image" : "wide-image"}`}>
      <Image
        src={src}
        alt={asset.alt}
        fill
        priority={priority}
        sizes={
          variant === "hero"
            ? "(max-width: 920px) 100vw, 44vw"
            : "(max-width: 920px) 100vw, 52vw"
        }
      />
      <div className="image-caption">
        <Camera size={18} aria-hidden="true" />
        <span>{caption}</span>
      </div>
    </div>
  );
}
