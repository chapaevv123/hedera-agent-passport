import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // @sh/agent ships TypeScript source; Next compiles it like app code.
  transpilePackages: ["@sh/agent"],
  // The Hedera SDKs load protobufs and native modules at runtime; keep them out of the bundle.
  serverExternalPackages: ["@hashgraphonline/standards-sdk", "@hashgraph/sdk"],
};

export default nextConfig;
