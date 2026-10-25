import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development, /api calls go to the local API (same as the Vercel rewrite in production)
    proxy: { '/api': { target: process.env.API_PROXY || 'http://localhost:4000', changeOrigin: true } },
  },
  build: { sourcemap: false, target: 'es2019' },
});
