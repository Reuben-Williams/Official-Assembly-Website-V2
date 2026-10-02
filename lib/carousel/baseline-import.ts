"use client";
import { communityPhotos } from "../../app/data/community-photos";
import { createCarouselBaseline, type CarouselMedia } from "./contract";

// One-time import of the checked-in approved collection through the normal JPEG upload pipeline.
// No URLs, captions, or images supplied by a third party are accepted here.
export async function importCarouselBaseline(
  upload: (
    file: File,
    metadata: { label: string; alt: string },
  ) => Promise<CarouselMedia>,
  completed: CarouselMedia[],
  progress: (message: string) => void,
) {
  for (let index = completed.length; index < communityPhotos.length; index++) {
    const photo = communityPhotos[index];
    progress(`Importing approved photo ${index + 1} of 8…`);
    const response = await fetch(photo.src, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        "An approved homepage photo could not be read. The live carousel was not changed.",
      );
    const bitmap = await createImageBitmap(await response.blob());
    try {
      if (bitmap.width !== photo.width || bitmap.height !== photo.height)
        throw new Error(
          "The approved photo dimensions changed. Stop and review the source.",
        );
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("This browser cannot prepare the approved photos.");
      context.drawImage(bitmap, 0, 0);
      const jpeg = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error("The photo could not be prepared.")),
          "image/jpeg",
          1,
        ),
      );
      completed.push(
        await upload(
          new File([jpeg], `carousel-baseline-${index + 1}.jpg`, {
            type: "image/jpeg",
          }),
          { label: photo.en.title, alt: photo.en.caption },
        ),
      );
    } finally {
      bitmap.close();
    }
  }
  progress(
    "Verifying image backups and preparing the complete published recovery snapshot…",
  );
  return createCarouselBaseline(completed);
}
