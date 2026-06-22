/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fully static, client-only app. No server, no API routes. The output in
  // `out/` deploys directly to Cloudflare Pages (or any static host).
  output: "export",
  // Static export can't run the Next image optimizer.
  images: { unoptimized: true },
  // Trailing slashes make static hosting (and Pages) routing predictable.
  trailingSlash: true,
  poweredByHeader: false,
};

export default nextConfig;
