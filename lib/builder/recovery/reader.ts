import type { EditableValue } from "@reuben-williams/core";

import {
  canonicalRecoveryJson,
  recoveryDigest,
  type RecoveryArtifactStore
} from "./blob-store";
import { validateGenerationManifest } from "./contracts";
import { createRecoveryMediaGrant } from "./media-grant";
import { validateCarouselDocument, type CarouselProjection } from '../../carousel/contract';
import { pageMediaRevisionId } from '../page-media';

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
export function createRecoveryContentReader(input: {
  artifacts: RecoveryArtifactStore;
  configuredRoutes: readonly string[];
  grantSecret: string;
  nowEpochSeconds: () => number;
}) {
  return async (pagePath: string) => {
    try {
      const latest = await input.artifacts.readLatest();
      if (!latest) return null;
      const manifestValue = await input.artifacts.readJson(latest.pointer.manifestPath, { useCache: false });
      if (!manifestValue) return null;
      const manifestBytes = new TextEncoder().encode(canonicalRecoveryJson(manifestValue.value));
      if (await recoveryDigest(manifestBytes) !== latest.pointer.manifestDigest) return null;
      const manifest = validateGenerationManifest(manifestValue.value, {
        environment: input.artifacts.environment,
        siteKey: input.artifacts.siteKey,
        routes: input.configuredRoutes,
        expectedGenerationId: latest.pointer.generationId
      });
      const route = manifest.routes.find((candidate) => candidate.path === pagePath);
      if (!route) return null;
      const artifactValue = await input.artifacts.readJson(route.artifactPath, { useCache: false });
      if (!artifactValue || !record(artifactValue.value)) return null;
      const artifactBytes = new TextEncoder().encode(canonicalRecoveryJson(artifactValue.value));
      if (await recoveryDigest(artifactBytes) !== route.artifactDigest ||
          artifactValue.value.generationId !== manifest.generationId || artifactValue.value.route !== pagePath ||
          !record(artifactValue.value.values)) return null;

      const expiresAt = input.nowEpochSeconds() + 60;
      const regions: Record<string, EditableValue> = {};
      for (const [regionId, unknownValue] of Object.entries(artifactValue.value.values)) {
        if (!record(unknownValue) || typeof unknownValue.type !== "string") continue;
        const value = unknownValue as unknown as EditableValue;
        if (value.type === "image" && value.mediaId) {
          const revisionId=pageMediaRevisionId(value.src);
          const candidates=manifest.media.filter(candidate=>candidate.mediaId===value.mediaId && (!revisionId || candidate.revisionId===revisionId));
          const media=candidates.length===1 ? candidates[0] : undefined;
          const routeMedia=artifactValue.value.media;
          if(!Array.isArray(routeMedia) || !routeMedia.some(item=>record(item) && item.mediaId===media?.mediaId && item.revisionId===media?.revisionId)) return null;
          if (!media) return null;
          const grant = createRecoveryMediaGrant({
            schemaVersion: 1,
            environment: input.artifacts.environment,
            siteKey: input.artifacts.siteKey,
            generationId: manifest.generationId,
            route: pagePath,
            mediaDigest: media.artifactDigest,
            manifestPath: latest.pointer.manifestPath,
            expiresAt
          }, input.grantSecret);
          regions[regionId] = {
            ...value,
            src: `/api/builder/recovery/media/${manifest.generationId}/${media.artifactDigest}?grant=${encodeURIComponent(grant)}`
          };
        } else {
          regions[regionId] = value;
        }
      }
      let carousel: CarouselProjection | undefined;
      if (pagePath === '/' && manifest.schemaVersion === 2) {
        const saved = artifactValue.value.carousel;
        if (!record(saved) || !manifest.carousel || saved.revisionId !== manifest.carousel.revisionId ||
            manifest.carousel.artifactPath !== route.artifactPath || manifest.carousel.artifactDigest !== route.artifactDigest) return null;
        const document = validateCarouselDocument(saved.document, true);
        const refs = new Map(document.entries.map(entry => [`${entry.media.mediaId}:${entry.media.revisionId}`, entry.media]));
        const images = [...refs.values()].map(ref => {
          const media = manifest.media.find(item => item.mediaId === ref.mediaId && item.revisionId === ref.revisionId);
          if (!media?.width || !media.height) throw new Error('CAROUSEL_MEDIA_MISSING');
          const grant = createRecoveryMediaGrant({schemaVersion:1,environment:input.artifacts.environment,
            siteKey:input.artifacts.siteKey,generationId:manifest.generationId,route:pagePath,
            mediaDigest:media.artifactDigest,manifestPath:latest.pointer.manifestPath,expiresAt},input.grantSecret);
          return {...ref,width:media.width,height:media.height,ready:true,
            url:`/api/builder/recovery/media/${manifest.generationId}/${media.artifactDigest}?grant=${encodeURIComponent(grant)}`};
        });
        carousel = {revisionId:String(saved.revisionId),document,images};
      }
      return { regions, ...(carousel ? {carousel} : {}) };
    } catch {
      return null;
    }
  };
}
