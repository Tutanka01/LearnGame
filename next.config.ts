import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build autonome pour Docker : .next/standalone contient serveur + node_modules minimaux.
  output: "standalone",
};

export default nextConfig;
