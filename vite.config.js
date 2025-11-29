import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
dotenv.config();

export default defineConfig(() => {
  const publicUrl = process.env.VITE_PUBLIC_URL || "http://localhost:5173";
  const frontendPort = process.env.FRONTEND_PORT || "5173";
  const port = parseInt(frontendPort) || 5173;

  return {
    define: {
      "import.meta.env.VITE_BACKEND_URL": JSON.stringify(
        process.env.VITE_BACKEND_URL
      ),
      "import.meta.env.VITE_PUBLIC_URL": JSON.stringify(publicUrl),
    },
    server: {
      host: "0.0.0.0",
      port: port,
      allowedHosts: [new URL(publicUrl).hostname, ".fly.dev"],
      strictPort: true,
    },
    build: {
      outDir: "build",
      manifest: true,
      chunkSizeWarningLimit: 1024,
    },
    plugins: [react()],
  };
});
