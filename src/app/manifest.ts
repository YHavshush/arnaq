import type { MetadataRoute } from "next";

/** What the iPhone (Add to Home Screen) and Android read to make Kasboek behave like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kasboek",
    short_name: "Kasboek",
    description: "Personal budget overview",
    start_url: "/",
    display: "standalone",
    background_color: "#d9e5f5",
    theme_color: "#d9e5f5",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
