/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"]
    };
    return config;
  },
  transpilePackages: [
    "@reuben-williams/canonical-json",
    "@reuben-williams/content",
    "@reuben-williams/core",
    "@reuben-williams/editor",
    "@reuben-williams/entitlements",
    "@reuben-williams/feature-registry",
    "@reuben-williams/forms",
    "@reuben-williams/growth-core",
    "@reuben-williams/growth-customers",
    "@reuben-williams/growth-dashboard",
    "@reuben-williams/growth-leads",
    "@reuben-williams/next"
  ],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" }
      ]
    }];
  }
};

export default nextConfig;
