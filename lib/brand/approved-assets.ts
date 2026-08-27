import {
  verifyApprovedBrandAssets,
  type ApprovedBrandAssetDefinition,
} from "./assets";

const sourceSha256 =
  "a4a00633ffae3280ab81b26856660c4b0a055e787fa2a15e28a47fc64592cc09";
const approvedBy = "Project owner (approved recommended restoration workflow)";
const approvedAt = "2026-08-27T16:39:02.756Z";

const definition = {
  entries: [
    {
      id: "morales.ld34.banner.desktop.avif",
      sourceSha256,
      publicSha256: "af73914e97e28d90c5bded5dd6447d07f4301f47c86b86e92a0ee1d961890dbd",
      publicPath: "/brand/morales-ld34-banner-desktop.avif",
      mimeType: "image/avif",
      width: 1290,
      height: 402,
      purpose: "homepage_banner",
      variant: "banner_desktop_avif",
      approvedBy,
      approvedAt,
    },
    {
      id: "morales.ld34.banner.desktop.webp",
      sourceSha256,
      publicSha256: "88453a842413fadee5b9d95dad20620750b3fd2376359950c1649441f533a42b",
      publicPath: "/brand/morales-ld34-banner-desktop.webp",
      mimeType: "image/webp",
      width: 1290,
      height: 402,
      purpose: "homepage_banner",
      variant: "banner_desktop_webp",
      approvedBy,
      approvedAt,
    },
    {
      id: "morales.ld34.banner.mobile.avif",
      sourceSha256,
      publicSha256: "07fd2b01dfc0c6fe675e1cc82b1670087c122ddf5dc378d8b81fbca20fabada2",
      publicPath: "/brand/morales-ld34-banner-mobile.avif",
      mimeType: "image/avif",
      width: 960,
      height: 299,
      purpose: "homepage_banner",
      variant: "banner_mobile_avif",
      approvedBy,
      approvedAt,
    },
    {
      id: "morales.ld34.banner.mobile.webp",
      sourceSha256,
      publicSha256: "721a1cbb5e7d64fdbd02292eaf0424411613e1064522ac1ff5cf2afd1d3103f1",
      publicPath: "/brand/morales-ld34-banner-mobile.webp",
      mimeType: "image/webp",
      width: 960,
      height: 299,
      purpose: "homepage_banner",
      variant: "banner_mobile_webp",
      approvedBy,
      approvedAt,
    },
    {
      id: "morales.ld34.social.1200x630.png",
      sourceSha256,
      publicSha256: "3e686d2f911deba672679d00fa00a7da41643fef4db4f3ed2bb3b69f19a19f49",
      publicPath: "/brand/morales-ld34-social-1200x630.png",
      mimeType: "image/png",
      width: 1200,
      height: 630,
      purpose: "social_cover",
      variant: "social_1200x630_png",
      approvedBy,
      approvedAt,
    },
  ],
  renderMap: {
    banner: {
      mobileMaxWidthPx: 767,
      fallbackBannerSetId: "morales.ld34.official.2026-08-27",
      sets: [
        {
          id: "morales.ld34.official.2026-08-27",
          pickerPublicPath: "/brand/morales-ld34-banner-desktop.webp",
          desktop: {
            avifId: "morales.ld34.banner.desktop.avif",
            webpId: "morales.ld34.banner.desktop.webp",
          },
          mobile: {
            avifId: "morales.ld34.banner.mobile.avif",
            webpId: "morales.ld34.banner.mobile.webp",
          },
        },
      ],
    },
    socialCoverId: "morales.ld34.social.1200x630.png",
  },
} satisfies ApprovedBrandAssetDefinition;

export const approvedBrandAssets = verifyApprovedBrandAssets(definition);
