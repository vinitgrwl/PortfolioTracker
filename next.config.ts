import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1MB — too tight for real broker statement exports
      // (Vested/Zerodha/Groww/AngelOne Excel files, PDFs).
      bodySizeLimit: "10mb",
    },
  },
  // pdf-parse pulls in a native (napi) binary via @napi-rs/canvas, which
  // Turbopack/webpack can't place inside an ESM/JS chunk. Keep these as
  // real node_modules requires at runtime instead of trying to bundle them.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
