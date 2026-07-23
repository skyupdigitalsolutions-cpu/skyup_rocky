import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api to the backend in dev so cookies are same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:8791',
        changeOrigin: true,
      },
    },
  },
});
