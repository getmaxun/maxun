import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
dotenv.config();

export default defineConfig(() => {
  const publicUrl = process.env.VITE_PUBLIC_URL || 'http://localhost:5173';

  return {
    define: {
      'import.meta.env.VITE_BACKEND_URL': JSON.stringify(process.env.VITE_BACKEND_URL),
      'import.meta.env.VITE_PUBLIC_URL': JSON.stringify(publicUrl),
    }, 
    server: {
      host: new URL(publicUrl).hostname,
      port: parseInt(new URL(publicUrl).port),
    },
    build: {
      outDir: 'build',
      manifest: true,
      chunkSizeWarningLimit: 1024,
    },
    plugins: [react()],
  };
});