import {
  verifyApprovedBrandAssets,
  type ApprovedBrandAssetDefinition,
} from "./assets";

const sourceSha256 =
  "a4a00633ffae3280ab81b26856660c4b0a055e787fa2a15e28a47fc64592cc09";
const approvedBy = "Project owner (approved centered banner high-density release)";
const approvedAt = "2026-09-03T02:07:41.708Z";

const definition = {
  entries: [
    {
      id: "morales.ld34.banner.desktop.avif",
      sourceSha256,
      publicSha256: "1517a3d9cdaed61c8fc9bf49e36f5a3144d690dcc054ddc88bf611e9814e57c5",
      publicPath: "/brand/morales-ld34-banner-desktop.avif",
      mimeType: "image/avif",
      width: 2580,
      height: 804,
      purpose: "homepage_banner",
      variant: "banner_desktop_avif",
      approvedBy,
      approvedAt,
    },
    {
      id: "morales.ld34.banner.desktop.webp",
      sourceSha256,
      publicSha256: "48ce700f77c74675256219a97fe43ba6bfdbcd5112c0b4e5bcf4aa13f53c497f",
      publicPath: "/brand/morales-ld34-banner-desktop.webp",
      mimeType: "image/webp",
      width: 2580,
      height: 804,
      purpose: "homepage_banner",
      variant: "banner_desktop_webp",
      approvedBy,
      approvedAt,
    },
    {
      id: "morales.ld34.banner.mobile.avif",
      sourceSha256,
      publicSha256: "b0f6f48f6826ca1b7fc5f6e34d4367f76e9e785612934dd97b8cff3f989243f4",
      publicPath: "/brand/morales-ld34-banner-mobile.avif",
      mimeType: "image/avif",
      width: 1920,
      height: 598,
      purpose: "homepage_banner",
      variant: "banner_mobile_avif",
      approvedBy,
      approvedAt,
    },
    {
      id: "morales.ld34.banner.mobile.webp",
      sourceSha256,
      publicSha256: "b65e3fd35e9ba29dd5479777f3bb4603783302b4b8e1524e435042863022046a",
      publicPath: "/brand/morales-ld34-banner-mobile.webp",
      mimeType: "image/webp",
      width: 1920,
      height: 598,
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
