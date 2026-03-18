import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.sulcus.ca" }],
        destination: "https://sulcus.ca/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
