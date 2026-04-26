import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  distDir: "output",
  // Optional: redirect old `/docs` bookmark URLs to in-app help
  async redirects() {
    const slug = (s: string) => [
      {
        source: `/docs/${s}`,
        destination: `/protected/docs/${s}`,
        permanent: true,
      },
      {
        source: `/docs/${s}/`,
        destination: `/protected/docs/${s}`,
        permanent: true,
      },
    ] as const;
    return [
      { source: "/docs", destination: "/protected/docs", permanent: true },
      { source: "/docs/", destination: "/protected/docs", permanent: true },
      ...slug("architecture"),
      ...slug("local-development"),
      ...slug("app-structure-and-database"),
      ...slug("admin-platforms"),
      ...slug("help"),
    ];
  },
};

export default nextConfig;
