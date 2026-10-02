import { it, expect, vi } from "vitest";
import { resolvePublicCarousel, publicCarouselImageUrls } from "../lib/carousel/public-contract";
import { createCarouselBaseline } from "../lib/carousel/contract";
const id = "10000000-0000-4000-8000-000000000001";
const projection = {
  revisionId: id,
  document: createCarouselBaseline(
    Array.from({ length: 8 }, () => ({ mediaId: id, revisionId: id })),
  ),
  images: [],
};
it("does not embed expiring primary or recovery grants in the public page",()=>{
  const result=publicCarouselImageUrls({...projection,images:[{mediaId:id,revisionId:id,url:"https://private.invalid/photo?grant=secret",width:1600,height:900,ready:true}]});
  expect(result.images[0].url).toBe(`/api/carousel/media/${id}`);
  expect(JSON.stringify(result)).not.toContain("secret");
});
it("uses the server-published projection without consulting recovery", async () => {
  const recovery = vi.fn();
  expect(await resolvePublicCarousel(async () => projection, recovery)).toEqual(
    { status: "ready", projection, source: "primary" },
  );
  expect(recovery).not.toHaveBeenCalled();
});
it("recovers the exact stored projection during primary outage", async () => {
  expect(
    await resolvePublicCarousel(
      async () => {
        throw new Error("offline");
      },
      async () => projection,
    ),
  ).toEqual({ status: "ready", projection, source: "recovery" });
});
it("never substitutes the old static baseline after both stores fail", async () => {
  expect(
    await resolvePublicCarousel(
      async () => null,
      async () => null,
    ),
  ).toEqual({ status: "unavailable" });
});
