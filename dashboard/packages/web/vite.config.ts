import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the API runs separately (npm run dev:api) and Vite proxies /api to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
