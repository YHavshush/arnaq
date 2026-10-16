import type { NextConfig } from "next";
import { cspHeader } from "./src/lib/csp";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite loads its WASM and data files from its own package folder at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Headers every response gets. The CSP is report-only in production until it has been checked on the
  // real deployment (see src/lib/csp.ts and docs/deploy.md).
  async headers() {
    const csp = cspHeader();
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          ...(csp ? [csp] : []),
        ],
      },
    ];
  },
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
