import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "md", "mdx"],
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

const withMDX = createMDX({
  options: {
    // remarkPlugins: [remarkGfm], // add later if needed
    // rehypePlugins: [rehypeSlug], // add later if needed
  },
});

export default withMDX(nextConfig);
