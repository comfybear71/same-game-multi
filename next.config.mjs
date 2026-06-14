/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // AFL Tables and bookmaker logos may be referenced remotely; keep this tight.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.afl.com.au" },
      { protocol: "https", hostname: "squiggle.com.au" },
    ],
  },
};

export default nextConfig;
