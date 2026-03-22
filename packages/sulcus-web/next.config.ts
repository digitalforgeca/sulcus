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
      // status.sulcus.ca → sulcus.ca/status
      {
        source: "/",
        has: [{ type: "host", value: "status.sulcus.ca" }],
        destination: "https://sulcus.ca/status",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "status.sulcus.ca" }],
        destination: "https://sulcus.ca/status",
        permanent: true,
      },
    ];
  },
};

const withMDX = createMDX({
  options: {
    remarkPlugins: [["remark-gfm"]],
    rehypePlugins: [["rehype-slug"]],
  },
});

export default withMDX(nextConfig);
