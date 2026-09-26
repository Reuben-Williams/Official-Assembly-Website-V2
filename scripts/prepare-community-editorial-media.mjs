import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

// Rebuilds only this approved collection. Originals are never resized or overwritten.
// Initial import: node scripts/prepare-community-editorial-media.mjs --gallery-root <folder> --review-root <folder>
// September collection import: add --parade-root <folder containing the five approved JPEGs>
// After originals are vendored: node scripts/prepare-community-editorial-media.mjs
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const option = process.argv[index];
  const value = process.argv[index + 1];
  if (!["--gallery-root", "--review-root", "--parade-root"].includes(option) || !value) throw new Error("Use only --gallery-root <folder>, --review-root <folder> and --parade-root <folder>.");
  argumentsByName.set(option, path.resolve(value));
}
const sourceDirectory = path.join(repositoryRoot, "content/media-source/community-editorial");
const publicDirectory = path.join(repositoryRoot, "public/images/community-editorial");
const approvedOn = "2026-09-14";
const processing = { desktopMaxLongEdge: 1600, mobileMaxLongEdge: 800, quality: 88, withoutEnlargement: true, preserveAspectRatio: true };
const photo = (key, filename, sha256, sourceUrl, alt, caption, placements, extra = {}) => ({
  key, filename, sha256, sourceUrl, alt, caption,
  placements: placements.map(([page, region]) => ({ page, region })),
  sourceCollection: "User-supplied Assemblywoman Morales photo collection",
  inputRoot: "--gallery-root",
  ...extra,
});

const selections = [
  photo("office-group", "asw_carmenmorales_DaLtQD2CMH2_117.jpg", "177f6b608ad0854ddf625c74ece7238b877dc115a030c1409bb55fb65567b0dc",
    "https://www.instagram.com/asw_carmenmorales/p/DaLtQD2CMH2/",
    { en: "Assemblywoman Carmen Morales posing with four people in an office", es: "La asambleísta Carmen Morales posa con cuatro personas en una oficina" },
    { en: "A moment together at the office", es: "Un momento juntos en la oficina" },
    [["/", "home volunteer invitation"], ["/contact", "contact supporting"]]),
  photo("chamber-group", "asw_carmenmorales_DaQ-MerEbea_085.jpg", "920c7ef0f89b15144aeffeef4f61523e694597b352bd6530e0f31f9b64aa7b6c",
    "https://www.instagram.com/asw_carmenmorales/p/DaQ-MerEbea/",
    { en: "Assemblywoman Carmen Morales posing with two men in suits in the legislative chamber", es: "La asambleísta Carmen Morales posa con dos hombres de traje en la cámara legislativa" },
    { en: "Together in the legislative chamber", es: "Juntos en la cámara legislativa" },
    [["/", "hero slide 8"], ["/about", "about supporting"], ["/resources", "resources supporting"]],
    { attribution: "Local source cache credits Assemblyman Michael Venezia; publication source is the supplied Morales collection." }),
  photo("community-greeting", "asw_carmenmorales_DZDMW4hkd2F_244.jpg", "bcb4ca965d7dd7781112a415f62a6283fddf34c8a14b0b9a73958066e701e172",
    "https://www.instagram.com/asw_carmenmorales/p/DZDMW4hkd2F/",
    { en: "Assemblywoman Carmen Morales sharing an outdoor embrace with a young child, with bicycles behind them", es: "La asambleísta Carmen Morales comparte un abrazo al aire libre con un menor, con bicicletas al fondo" },
    { en: "A warm greeting outdoors", es: "Un saludo afectuoso al aire libre" },
    [["/", "hero slide 5"], ["/survey", "survey supporting"], ["/social", "social supporting"]]),
  photo("student-recognition", "asw_carmenmorales_DY0N3smldax_276.jpg", "1040716b818d484dd12c3493e76448c17b9547a67ed9a2b45a2f1128979195c0",
    "https://www.instagram.com/asw_carmenmorales/p/DY0N3smldax/",
    { en: "Assemblywoman Carmen Morales at the left of a group wearing Bloomfield HS Unified shirts in the legislative chamber", es: "La asambleísta Carmen Morales a la izquierda de un grupo con camisetas de Bloomfield HS Unified en la cámara legislativa" },
    { en: "Bloomfield HS Unified in the chamber", es: "Bloomfield HS Unified en la cámara" },
    [],
    { attribution: "Local source cache credits New Jersey Assembly Democrats; publication source is the supplied Morales collection.", qualityNote: "Source width is 1280px. No derivative is enlarged." }),
  photo("state-house-recognition", "news-supporting.jpg", "5bfadecd45f8b7aa35bbdd9818a46d14572f1c8b299fc4822876bb4bc911b7f5",
    "https://www.assemblywomanmorales.com/images/professional/news-supporting-desktop.webp",
    { en: "Assemblywoman Carmen Morales posing with a group holding a certificate in the legislative chamber", es: "La asambleísta Carmen Morales posa con un grupo que sostiene un certificado en la cámara legislativa" },
    { en: "Sharing a certificate in the chamber", es: "Un certificado compartido en la cámara" },
    [["/", "hero slide 6"]],
    { sourceCollection: "Previously approved State House professional photo collection", repositoryInput: "content/media-source/professional/news-supporting.jpg", sourceProvenanceRecord: "content/approved-professional-media.json#media.professional.news-supporting", sourceUrlNote: "Existing published derivative identifies the previously approved source; the original album URL was not retained in its provenance manifest. News keeps its existing derivative and placement." }),
  photo("outreach-table", "asw_carmenmorales_DY7rRPbkaBt_254.jpg", "69070b77ec1158cba206305dcaf896bdda5a1f7a8e2a3ccc01a2ed396cdfdce6",
    "https://www.instagram.com/asw_carmenmorales/p/DY7rRPbkaBt/",
    { en: "Assemblywoman Carmen Morales with two people beside an outdoor office table with seasonal decorations", es: "La asambleísta Carmen Morales con dos personas junto a una mesa de la oficina al aire libre con decoraciones de temporada" },
    { en: "Together at the outdoor office table", es: "Juntos en la mesa de la oficina al aire libre" },
    [["/survey", "survey primary"]]),
  photo("community-selfie", "asw_carmenmorales_DaIY5RjkfSr_137.jpg", "9bdd0782aa069c129777ed21039c6ff212e030af91d6383f6f3578e3381b86dd",
    "https://www.instagram.com/asw_carmenmorales/p/DaIY5RjkfSr/",
    { en: "Assemblywoman Carmen Morales smiling beside a man in an indoor selfie", es: "La asambleísta Carmen Morales sonríe junto a un hombre en una selfi tomada en un interior" },
    { en: "Sharing a smile for the camera", es: "Compartiendo una sonrisa ante la cámara" },
    []),
  photo("hallway-portrait", "asw_carmenmorales_DaO63bVDQYq_107.jpg", "f0f58e516472b73015033083540c8bed16eba6e9ad53ae454b1210c27b4832a8",
    "https://www.instagram.com/asw_carmenmorales/p/DaO63bVDQYq/",
    { en: "Assemblywoman Carmen Morales posing for a photograph in an indoor hallway", es: "La asambleísta Carmen Morales posa para una fotografía en un pasillo interior" },
    { en: "Assemblywoman Carmen Morales", es: "La asambleísta Carmen Morales" },
    [["/voting", "voting supporting"]]),
  photo("bill-signing-group", "bill.jpg", "cbde8a262278b3cd31b28b1f19f437c968cf92145b0f6e1bf9319a82a2c0158e",
    "https://drive.google.com/file/d/18rk_gyD7NrTvnwweUgW9jnZiRHNEczrN/view",
    { en: "Assemblywoman Carmen Morales posing with a group in a gymnasium, with more attendees behind them", es: "La asambleísta Carmen Morales posa con un grupo en un gimnasio, con más asistentes al fondo" },
    { en: "A group moment in the gymnasium", es: "Un momento en grupo en el gimnasio" },
    [["/", "hero slide 4"]],
    { sourceCollection: "User-supplied Google Drive folder: Bill Signing (08-11-2026)", inputRoot: "--review-root", originalFilename: "IMG_7235.HEIC", conversion: "Orientation-preserving JPEG conversion made with heif-convert. The original HEIF is archived alongside this portable input; no decoder security limits were disabled.", archivalOriginal: { filename: "bill.heif", sha256: "631ff308f940b80c928e4e706361e4dcfd708390dbefcc64756bd9204ce5aca6" } }),
];

const paradeApproval = {
  inputRoot: "--parade-root",
  approvedOn: "2026-09-26",
  sourceCollection: "User-supplied Google Drive folder: Puerto Rican Parade 2026 / Photos",
  approvalSpecPath: "docs/superpowers/specs/2026-09-26-new-community-photography-design.md",
};
selections.push(
  photo("parade-group", "DSC09013.jpg", "504c5cd03686a61159d2561f3469d9c3c19be931688fe5dedf93c41d07d85c73",
    "https://drive.google.com/file/d/1fFrpwrObHHK8h3N8FqDhcqRgnavAMvIQ/view",
    { en: "Assemblywoman Carmen Morales posing with a group on a street, with parade floats behind them", es: "La asambleísta Carmen Morales posa con un grupo en una calle, con carrozas del desfile al fondo" },
    { en: "A group moment along the parade route", es: "Un momento en grupo durante el desfile" },
    [["/", "hero slide 1"]], paradeApproval),
  photo("parade-walk", "DSC09399.jpg", "560b2113b51a7c1434bd48b2021cb11fe5a3fb679a765bef78da546562a2ff84",
    "https://drive.google.com/file/d/1RWPsjnZFTXWnaygkAM4cw8aMjh88H8gg/view",
    { en: "Assemblywoman Carmen Morales walking beside a man holding an umbrella, with parade participants behind them", es: "La asambleísta Carmen Morales camina junto a un hombre que sostiene un paraguas, con participantes del desfile detrás" },
    { en: "Walking together along the parade route", es: "Caminando juntos durante el desfile" },
    [["/", "hero slide 7"]], paradeApproval),
  photo("parade-wave", "DSC09418.jpg", "ea1516582f2d0bdb7e63ba51e41bed32bfa42bc835ad8f03410c2e94077d9408",
    "https://drive.google.com/file/d/18jb-hW4eDuUWCpJrQEhBZV_olwZBZg_u/view",
    { en: "Assemblywoman Carmen Morales smiling and waving in a denim jacket and burgundy cap", es: "La asambleísta Carmen Morales sonríe y saluda con una chaqueta de mezclilla y una gorra color borgoña" },
    { en: "A smile and a wave from Morales", es: "Una sonrisa y un saludo de Morales" },
    [["/community", "community primary"]], paradeApproval),
  photo("parade-selfie", "DSC09192.jpg", "42fa0e13ad09c9df4eb786ef419830b99986246e7c931e695b2a2a929f1eba84",
    "https://drive.google.com/file/d/1Lk-E37uHhgSJ5_11CrAP8Lqj9DrnjAkg/view",
    { en: "Assemblywoman Carmen Morales smiling with a group posing for a selfie outdoors", es: "La asambleísta Carmen Morales sonríe con un grupo que posa para una selfi al aire libre" },
    { en: "Coming together for a group selfie", es: "Juntos para una selfi en grupo" },
    [["/community", "community supporting"]], paradeApproval),
  photo("parade-smiles", "DSC09212.jpg", "c2a89532fed515cf250f3db2fec81efce7627d84f97318f544f1a55ff1ffa0f0",
    "https://drive.google.com/file/d/1RwX1PNFpl4Ups0cHkk6tYLMt4DgaTJjl/view",
    { en: "Assemblywoman Carmen Morales and a woman in a burgundy shirt smiling together outdoors", es: "La asambleísta Carmen Morales y una mujer con una camiseta color borgoña sonríen juntas al aire libre" },
    { en: "Sharing a smile outdoors", es: "Compartiendo una sonrisa al aire libre" },
    [["/social", "social primary"]], paradeApproval),
);

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function ensureOriginal(destination, input, expectedHash) {
  const retained = existsSync(destination);
  if (!retained && !input) throw new Error(`Missing approved original ${path.basename(destination)}; supply its source-root option for the initial import.`);
  const source = retained ? destination : input;
  const buffer = await readFile(source);
  if (sha256(buffer) !== expectedHash) throw new Error(`Approved source hash mismatch: ${path.basename(source)}. No existing original was overwritten.`);
  if (!retained) await copyFile(source, destination);
  return buffer;
}

async function fileRecord(filePath, recordPath, includeDimensions = true) {
  const buffer = await readFile(filePath);
  const record = { path: recordPath, sha256: sha256(buffer), bytes: buffer.byteLength };
  if (!includeDimensions) return record;
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Missing dimensions: ${recordPath}`);
  return { ...record, width: metadata.width, height: metadata.height };
}

await mkdir(sourceDirectory, { recursive: true });
await mkdir(publicDirectory, { recursive: true });
const assets = [];
for (const selection of selections) {
  const retainedPath = path.join(sourceDirectory, `${selection.key}.jpg`);
  const inputDirectory = argumentsByName.get(selection.inputRoot);
  const input = selection.repositoryInput
    ? path.join(repositoryRoot, selection.repositoryInput)
    : inputDirectory ? path.join(inputDirectory, selection.filename) : undefined;
  await ensureOriginal(retainedPath, input, selection.sha256);
  const source = {
    ...await fileRecord(retainedPath, `content/media-source/community-editorial/${selection.key}.jpg`),
    originalFilename: selection.originalFilename ?? selection.filename,
  };
  let archivalOriginal;
  if (selection.archivalOriginal) {
    const archivalPath = path.join(sourceDirectory, `${selection.key}.heif`);
    await ensureOriginal(archivalPath, inputDirectory ? path.join(inputDirectory, selection.archivalOriginal.filename) : undefined, selection.archivalOriginal.sha256);
    archivalOriginal = { ...await fileRecord(archivalPath, `content/media-source/community-editorial/${selection.key}.heif`, false), format: "heif" };
  }
  const derivatives = {};
  for (const [variant, maxLongEdge] of [["desktop", processing.desktopMaxLongEdge], ["mobile", processing.mobileMaxLongEdge]]) {
    const filename = `${selection.key}-${variant}.webp`;
    const derivativePath = path.join(publicDirectory, filename);
    await sharp(retainedPath).rotate().resize({ width: maxLongEdge, height: maxLongEdge, fit: "inside", withoutEnlargement: true }).webp({ quality: processing.quality }).toFile(derivativePath);
    derivatives[variant] = await fileRecord(derivativePath, `/images/community-editorial/${filename}`);
  }
  assets.push({
    key: selection.key,
    id: `media.community-editorial.${selection.key}`,
    sourceCollection: selection.sourceCollection,
    sourceUrl: selection.sourceUrl,
    ...(selection.sourceUrlNote ? { sourceUrlNote: selection.sourceUrlNote } : {}),
    ...(selection.sourceProvenanceRecord ? { sourceProvenanceRecord: selection.sourceProvenanceRecord } : {}),
    ...(selection.attribution ? { attribution: selection.attribution } : {}),
    ...(selection.qualityNote ? { qualityNote: selection.qualityNote } : {}),
    ...(selection.conversion ? { conversion: selection.conversion } : {}),
    source,
    ...(archivalOriginal ? { archivalOriginal } : {}),
    derivatives,
    placements: selection.placements,
    alt: selection.alt,
    caption: selection.caption,
    approvalState: "approved",
    approvedOn: selection.approvedOn ?? approvedOn,
    approvalSpecPath: selection.approvalSpecPath ?? "docs/superpowers/specs/2026-09-14-community-photo-refresh-design.md",
  });
}

const manifest = {
  version: 1,
  approval: { specPath: "docs/superpowers/specs/2026-09-14-community-photo-refresh-design.md", approvedOn, basis: "User-approved written photo sheet, with subsequent carousel instruction keeping the student group only on Community and placing community-greeting on hero slide 5." },
  revisions: [{ specPath: paradeApproval.approvalSpecPath, approvedOn: paradeApproval.approvedOn, basis: "User-approved September 26 spec: five new authentic originals, replacing carousel slides 1 and 7, Community primary/supporting and Social primary. Prior originals retained; current placements are listed per asset." }],
  provenanceNote: "Instagram URLs are retained from the user-supplied source cache, not an independent event or licensing verification. Photo associations and release use follow the user-approved sheet. Captions describe visible content only.",
  processing,
  assets,
};
await writeFile(path.join(repositoryRoot, "content/approved-community-editorial-media.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ assets: assets.length, derivatives: assets.length * 2, originalsRetained: assets.length + 1, manifest: "content/approved-community-editorial-media.json" }));
