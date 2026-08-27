import Image from "next/image";
import type { CSSProperties } from "react";

import type { BuilderServerContent } from "../../lib/builder/server-content";
import {
  HOME_BRAND_BANNER_ALT_EN,
  HOME_BRAND_BANNER_ALT_ES,
  HOME_BRAND_BANNER_REGION_ID,
  resolveHomeBrandBannerSet,
  type VerifiedApprovedBrandAssets,
} from "../../lib/brand/assets";
import type { PublicLocale } from "../i18n/locale";

type HomepageBrandBannerProps = Readonly<{
  assets: VerifiedApprovedBrandAssets | null;
  content: BuilderServerContent;
  locale?: PublicLocale;
}>;

function publicPath(path: string) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  return path.startsWith("/") ? `${basePath}${path}` : path;
}

export function HomepageBrandBanner({
  assets,
  content,
  locale = "en",
}: HomepageBrandBannerProps) {
  if (!assets) return null;
  const selected = resolveHomeBrandBannerSet(
    content.regions[HOME_BRAND_BANNER_REGION_ID],
    assets,
  );
  const alt = locale === "es" ? HOME_BRAND_BANNER_ALT_ES : HOME_BRAND_BANNER_ALT_EN;

  return (
    <section
      className="home-brand-banner"
      data-builder-kind="image"
      data-builder-region={HOME_BRAND_BANNER_REGION_ID}
      data-brand-banner-set={selected.id}
      data-home-brand-banner="true"
    >
      <picture
        className="home-brand-banner-picture"
        style={{
          "--brand-banner-desktop-aspect": `${selected.desktop.webp.width} / ${selected.desktop.webp.height}`,
          "--brand-banner-mobile-aspect": `${selected.mobile.webp.width} / ${selected.mobile.webp.height}`,
        } as CSSProperties}
      >
        <source
          media={`(max-width: ${assets.mobileMaxWidthPx}px)`}
          srcSet={publicPath(selected.mobile.avif.publicPath)}
          type="image/avif"
        />
        <source
          media={`(max-width: ${assets.mobileMaxWidthPx}px)`}
          srcSet={publicPath(selected.mobile.webp.publicPath)}
          type="image/webp"
        />
        <source srcSet={publicPath(selected.desktop.avif.publicPath)} type="image/avif" />
        <Image
          alt={alt}
          className="home-brand-banner-image"
          height={selected.desktop.webp.height}
          priority
          sizes="100vw"
          src={publicPath(selected.desktop.webp.publicPath)}
          unoptimized
          width={selected.desktop.webp.width}
        />
      </picture>
    </section>
  );
}
