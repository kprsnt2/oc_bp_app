import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Attachments are sent as base64 payloads. 24 MB is the serverless ceiling we
  // design for; the client-side pipeline keeps typical messages far below it.
  experimental: {
    serverActions: {
      bodySizeLimit: "24mb",
    },
  },
};

export default nextConfig;