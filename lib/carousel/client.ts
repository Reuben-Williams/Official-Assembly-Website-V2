import type { CarouselCommand } from "./handlers";
import { editorFetch } from '../builder/editor-fetch';
import type { CarouselState, CarouselReview } from "./service";
import { builderSessionCookies } from "../builder/session-cookies";
export type CarouselReply = { state?: CarouselState; review?: CarouselReview };
export class CarouselClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
export interface CarouselClient {
  read(): Promise<CarouselState>;
  command(command: CarouselCommand): Promise<CarouselReply>;
  verifyMedia?(): Promise<void>;
}
export function createCarouselClient(): CarouselClient {
  async function request(command?: CarouselCommand) {
    const csrf = document.cookie
      .split(";")
      .map((part) => part.trim().split("="))
      .find(([name]) => name === builderSessionCookies.csrf)
      ?.slice(1)
      .join("=");
    const response = await editorFetch("/api/builder/carousel", {
      method: command ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: command
        ? {
            "content-type": "application/json",
            "x-builder-csrf": decodeURIComponent(csrf ?? ""),
          }
        : undefined,
      body: command ? JSON.stringify(command) : undefined,
    });
    const result = await response.json();
    if (!response.ok)
      throw new CarouselClientError(
        response.status,
        result.error?.message ?? "The carousel request could not be confirmed.",
        result.error?.code,
      );
    return result;
  }
  return {
    read: () => request(),
    command: request,
    verifyMedia: async () => {
      const csrf = document.cookie
        .split(";")
        .map((part) => part.trim().split("="))
        .find(([name]) => name === builderSessionCookies.csrf)
        ?.slice(1)
        .join("=");
      const response = await editorFetch("/api/builder/media/inventory", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "x-builder-csrf": decodeURIComponent(csrf ?? "") },
      });
      const result = await response.json();
      if (!response.ok)
        throw new CarouselClientError(
          response.status,
          result.error?.message ??
            "The media inventory found a mismatch. No images were changed; contact the site administrator.",
        );
    },
  };
}
