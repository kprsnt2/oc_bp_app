import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // This is a Server Action limit only. Route Handlers (where /api/extract
      // and /api/transcribe live) are capped at 4.5 MB by Vercel itself, and
      // no config flag raises that. Documents over that size need the
      // client-side extraction path instead of an upload.
      bodySizeLimit: "24mb",
    },
  },
};

export default nextConfig;
