import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A Valid ID image may be 2 MB before encoding (guide 3.10).
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
