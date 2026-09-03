import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const [stateHouseHtml, communityHtml] = process.argv.slice(2);
if (!stateHouseHtml || !communityHtml) {
  throw new Error("Provide the exported State House and community album HTML files.");
}

const workspaceRoot = process.cwd();
const sourceDirectory = path.join(workspaceRoot, "content", "media-source", "professional");
const publicDirectory = path.join(workspaceRoot, "public", "images", "professional");
const manifestPath = path.join(workspaceRoot, "content", "approved-professional-media.json");

const albums = {
  stateHouse: {
    html: stateHouseHtml,
    label: "State House professional photo collection",
  },
  community: {
    html: communityHtml,
    label: "2025 Puerto Rican Flag Raising in Belleville professional photo collection",
  },
};

const selections = [
  {
    id: "media.professional.home-supporting",
    key: "home-supporting",
    album: "stateHouse",
    index: 12,
    page: "/",
    region: "home supporting",
    width: 1600,
    height: 1000,
    mobileWidth: 800,
    mobileHeight: 500,
    alt: {
      en: "Assemblywoman Carmen Morales speaking with a legislative colleague in a State House committee room",
      es: "La asambleísta Carmen Morales conversa con un colega legislativo en una sala de comités de la Casa del Estado",
    },
  },
  {
    id: "media.professional.about-primary",
    key: "about-primary",
    album: "stateHouse",
    index: 15,
    page: "/about",
    region: "about primary",
    width: 1200,
    height: 1500,
    mobileWidth: 800,
    mobileHeight: 1000,
    alt: {
      en: "Assemblywoman Carmen Morales speaking from her desk in a New Jersey State House committee room",
      es: "La asambleísta Carmen Morales habla desde su escritorio en una sala de comités de la Casa del Estado de Nueva Jersey",
    },
  },
  {
    id: "media.professional.news-supporting",
    key: "news-supporting",
    album: "stateHouse",
    index: 49,
    page: "/news",
    region: "news supporting",
    width: 1600,
    height: 1000,
    mobileWidth: 800,
    mobileHeight: 500,
    alt: {
      en: "Assemblywoman Carmen Morales presenting a State House recognition to a District 34 family",
      es: "La asambleísta Carmen Morales entrega un reconocimiento de la Casa del Estado a una familia del Distrito 34",
    },
  },
  {
    id: "media.professional.community-primary",
    key: "community-primary",
    album: "community",
    index: 90,
    page: "/community",
    region: "community primary",
    width: 1200,
    height: 1500,
    mobileWidth: 800,
    mobileHeight: 1000,
    alt: {
      en: "Assemblywoman Carmen Morales and a community member holding Puerto Rican flags outside Belleville Town Hall",
      es: "La asambleísta Carmen Morales y una integrante de la comunidad sostienen banderas de Puerto Rico frente al ayuntamiento de Belleville",
    },
  },
  {
    id: "media.professional.resources-supporting",
    key: "resources-supporting",
    album: "community",
    index: 85,
    page: "/resources",
    region: "resources supporting",
    width: 1600,
    height: 1000,
    mobileWidth: 800,
    mobileHeight: 500,
    alt: {
      en: "Assemblywoman Carmen Morales gathered with Belleville residents at a Puerto Rican flag raising ceremony",
      es: "La asambleísta Carmen Morales junto a residentes de Belleville durante una ceremonia de izamiento de la bandera de Puerto Rico",
    },
  },
];

function albumImageUrls(html) {
  return [...new Set(html.match(/https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]+/g) ?? [])];
}

async function metadataFor(filePath) {
  const metadata = await sharp(filePath).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Missing image dimensions for ${filePath}`);
  return { width: metadata.width, height: metadata.height };
}

await mkdir(sourceDirectory, { recursive: true });
await mkdir(publicDirectory, { recursive: true });

const albumUrls = {};
for (const [key, album] of Object.entries(albums)) {
  albumUrls[key] = albumImageUrls(await readFile(album.html, "utf8"));
}

const assets = [];
for (const selection of selections) {
  const album = albums[selection.album];
  const sourceUrl = albumUrls[selection.album][selection.index - 1];
  if (!sourceUrl) throw new Error(`Approved source ${selection.album} #${selection.index} is missing.`);

  const response = await fetch(`${sourceUrl}=d`);
  if (!response.ok) throw new Error(`Approved source download failed with ${response.status}.`);
  const sourceBuffer = Buffer.from(await response.arrayBuffer());
  const sourcePath = path.join(sourceDirectory, `${selection.key}.jpg`);
  await writeFile(sourcePath, sourceBuffer);

  const desktopPath = path.join(publicDirectory, `${selection.key}-desktop.webp`);
  const mobilePath = path.join(publicDirectory, `${selection.key}-mobile.webp`);
  await sharp(sourceBuffer)
    .rotate()
    .resize(selection.width, selection.height, { fit: "cover", position: sharp.strategy.attention })
    .webp({ quality: 86, smartSubsample: true })
    .toFile(desktopPath);
  await sharp(sourceBuffer)
    .rotate()
    .resize(selection.mobileWidth, selection.mobileHeight, { fit: "cover", position: sharp.strategy.attention })
    .webp({ quality: 84, smartSubsample: true })
    .toFile(mobilePath);

  const sourceDimensions = await metadataFor(sourcePath);
  const desktopDimensions = await metadataFor(desktopPath);
  const mobileDimensions = await metadataFor(mobilePath);
  assets.push({
    id: selection.id,
    sourceCollection: album.label,
    acquiredOn: "2026-09-01",
    source: {
      path: `content/media-source/professional/${selection.key}.jpg`,
      sha256: createHash("sha256").update(sourceBuffer).digest("hex"),
      ...sourceDimensions,
    },
    derivatives: {
      desktop: {
        path: `/images/professional/${selection.key}-desktop.webp`,
        ...desktopDimensions,
      },
      mobile: {
        path: `/images/professional/${selection.key}-mobile.webp`,
        ...mobileDimensions,
      },
    },
    placements: [
      { page: selection.page, region: selection.region },
      ...(selection.id === "media.professional.about-primary"
        ? [{ page: "/", region: "official profile portrait" }]
        : []),
    ],
    alt: selection.alt,
    approvalState: "approved",
  });
}

await writeFile(manifestPath, `${JSON.stringify({ version: 2, assets }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ imported: assets.length, manifest: path.relative(workspaceRoot, manifestPath) }));
