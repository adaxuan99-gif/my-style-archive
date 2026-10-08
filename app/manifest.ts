import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "我的AI衣橱 · My Style Archive",
    short_name: "我的AI衣橱",
    description: "私人衣柜与风格档案",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f8fa",
    theme_color: "#315bdc",
    lang: "zh-CN",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
