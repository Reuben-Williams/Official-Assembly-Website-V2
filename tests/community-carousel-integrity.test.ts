import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { communityPhotos } from "../app/data/community-photos";

const preservedPhotos = [
  {
    id: "community", src: "/images/community-carousel/community.webp", width: 1600, height: 1000, position: "center 33%",
    en: { title: "Community gathering", caption: "Neighbors gather for a group photo with Puerto Rican flags." },
    es: { title: "Encuentro comunitario", caption: "Vecinos se reúnen para una foto grupal con banderas de Puerto Rico." },
  },
  {
    id: "dsc09235", src: "/images/community-carousel/dsc09235.webp", width: 1600, height: 1066, position: "center 33%",
    en: { title: "Together at the stadium", caption: "Assemblywoman Morales joins community members for a group photo on the field." },
    es: { title: "Juntos en el estadio", caption: "La asambleísta Morales se une a miembros de la comunidad para una foto grupal en el campo." },
  },
  {
    id: "dsc09857", src: "/images/community-carousel/dsc09857.webp", width: 1600, height: 1066, position: "center 20%",
    en: { title: "Backpacks and big smiles", caption: "Morales holds up colorful backpacks at an outdoor community gathering." },
    es: { title: "Mochilas y grandes sonrisas", caption: "Morales muestra mochilas de colores en un encuentro comunitario al aire libre." },
  },
];

const preservedHashes = [
  "40072d0c0716e12400725dd34e8e21df8e5a519b7c308a8b2780359f37fb59d6",
  "aaeb457ef074c5e55567ec0244ee828e1b2d975041bf457e6c0d833aa7905552",
  "856342992f826c6e0e34e07ef0a0a1339e9ad77989fb1dd7a8d6481c9f472cb7",
];

describe("approved carousel photo integrity", () => {
  it("preserves all original first-three records including captions, order and crops", () => {
    expect(communityPhotos.slice(0, 3)).toEqual(preservedPhotos);
  });

  it("preserves the exact approved first-three image bytes", () => {
    expect(preservedPhotos.map((photo) => createHash("sha256")
      .update(readFileSync(resolve("public", photo.src.slice(1))))
      .digest("hex"))).toEqual(preservedHashes);
  });

  it("uses the five approved replacement photographs without the excluded cafe or school slide", () => {
    expect(communityPhotos.slice(3).map((photo) => photo.src)).toEqual([
      "/images/community-editorial/bill-signing-group-desktop.webp",
      "/images/community-editorial/community-greeting-desktop.webp",
      "/images/community-editorial/state-house-recognition-desktop.webp",
      "/images/community-editorial/outreach-table-desktop.webp",
      "/images/community-editorial/chamber-group-desktop.webp",
    ]);
  });

  it("describes each real display file using its actual pixel dimensions", async () => {
    for (const photo of communityPhotos) {
      const metadata = await sharp(resolve("public", photo.src.slice(1))).metadata();
      expect({ width: photo.width, height: photo.height }).toEqual({
        width: metadata.width, height: metadata.height,
      });
      expect(Math.max(photo.width, photo.height)).toBeLessThanOrEqual(1600);
    }
  });
});
