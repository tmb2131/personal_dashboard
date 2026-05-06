import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Personal Dashboard",
    short_name: "Dashboard",
    description: "Notion, Todoist, and Google Calendar in one calm view.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f1e8",
    theme_color: "#5b6cff",
    icons: [
      {
        src: "/icon.svg",
        type: "image/svg+xml",
        sizes: "any",
      },
    ],
  };
}
