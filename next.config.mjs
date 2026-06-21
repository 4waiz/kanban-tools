/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produce a self-contained server bundle for a small Docker image.
  output: "standalone",
  // Sharp and the child-process based converters must run in the Node.js runtime,
  // never the Edge runtime. We also mark them external so Next doesn't try to bundle
  // their native bindings.
  serverExternalPackages: ["sharp", "yauzl", "archiver"],
  // Allow larger uploads through Server Actions / route handlers.
  // NOTE: for production, put a real object store + presigned uploads in front of this.
  experimental: {
    serverActions: {
      bodySizeLimit: "1gb",
    },
  },
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/sharp/**"],
  },
};

export default nextConfig;
