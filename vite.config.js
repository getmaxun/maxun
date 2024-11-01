import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  return {
    define: {
      'import.meta.env.VITE_BACKEND_URL': JSON.stringify(process.env.VITE_BACKEND_URL),
    }, 
    build: {
      outDir: 'build',
      manifest: true,
      chunkSizeWarningLimit: 1024,
    },
    plugins: [react()],
  };
});