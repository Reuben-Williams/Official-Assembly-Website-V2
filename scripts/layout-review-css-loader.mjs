const SERVER_ONLY_STUB = "data:text/javascript,export{}";
const NEXT_NAVIGATION_STUB = `data:text/javascript,${encodeURIComponent(`
  export function usePathname() { return "/"; }
  export function useRouter() {
    return {
      back() {},
      forward() {},
      prefetch() {},
      push() {},
      refresh() {},
      replace() {},
    };
  }
  export function useSearchParams() { return new URLSearchParams(); }
  export function notFound() { throw new Error("notFound"); }
  export function redirect() { throw new Error("redirect"); }
`)}`;
const NEXT_IMAGE_STUB = new URL("./layout-review-next-image.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { shortCircuit: true, url: SERVER_ONLY_STUB };
  }
  if (specifier === "next/navigation") {
    return { shortCircuit: true, url: NEXT_NAVIGATION_STUB };
  }
  if (specifier === "next/image") {
    return { shortCircuit: true, url: NEXT_IMAGE_STUB };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".css")) return nextLoad(url, context);

  return {
    format: "module",
    shortCircuit: true,
    source: `
      const styles = new Proxy({}, {
        get(_target, property) {
          return typeof property === "string" ? property : "";
        }
      });
      export default styles;
    `,
  };
}
