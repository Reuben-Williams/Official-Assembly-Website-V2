const isGithubPages = process.env.GITHUB_PAGES === "true";
const repoName = "Official-Assembly-Website-V2";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  basePath: isGithubPages ? `/${repoName}` : "",
  assetPrefix: isGithubPages ? `/${repoName}/` : undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: isGithubPages ? `/${repoName}` : "",
    NEXT_PUBLIC_SITE_URL: isGithubPages
      ? `https://reuben-williams.github.io/${repoName}`
      : process.env.NEXT_PUBLIC_SITE_URL
  }
};

export default nextConfig;
