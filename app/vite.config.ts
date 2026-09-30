import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: [
        "buffer",
        "process",
        "stream",
        "crypto",
        "events",
        "util",
        "path",
      ],
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/artifacts/private/**",
        "**/*-keypair.json",
      ],
    },
    allowedHosts: process.env.CODESPACE_NAME
      ? [
          `${process.env.CODESPACE_NAME}-5173.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev"}`,
        ]
      : [],
  },
});
