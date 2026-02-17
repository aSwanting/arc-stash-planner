import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.SERVER_PROXY_TARGET ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target,
        changeOrigin: true,
      },
    },
  },
});
