import type { NextConfig } from "next";

// Old product domains: everything moves to the Entoa domain, path and query kept.
const LEGACY_HOSTS = ["englishinterview.vercel.app", "english-interview-agent.vercel.app"];

const nextConfig: NextConfig = {
  async redirects() {
    return LEGACY_HOSTS.map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: "https://entoa.vercel.app/:path*",
      permanent: false,
    }));
  },
  async rewrites() {
    // The public landing is a single static page (public/entoa/index.html).
    return { beforeFiles: [{ source: "/", destination: "/entoa/index.html" }], afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
