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
  // Don't leak the framework version.
  poweredByHeader: false,
  // Security headers applied to every response.
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
      },
      {
        // Conservative CSP. Next.js needs 'unsafe-inline' for its inline runtime
        // styles; scripts are first-party only. Tighten further with nonces if
        // you remove inline styles.
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "img-src 'self' data: blob:",
          "media-src 'self' blob:",
          "style-src 'self' 'unsafe-inline'",
          `script-src 'self'${isProd ? "" : " 'unsafe-eval'"} 'unsafe-inline'`,
          "font-src 'self' data:",
          "connect-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join("; "),
      },
    ];
    // HSTS only in production (don't pin localhost to HTTPS).
    if (isProd) {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
