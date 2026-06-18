/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The /api/admin/migrate route reads the SQL files in ./drizzle at runtime;
  // make sure they're traced into that serverless function's bundle.
  experimental: {
    outputFileTracingIncludes: {
      "/api/admin/migrate": ["./drizzle/**/*"],
    },
  },
  // AFL Tables and bookmaker logos may be referenced remotely; keep this tight.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.afl.com.au" },
      { protocol: "https", hostname: "squiggle.com.au" },
    ],
  },
};

export default nextConfig;
