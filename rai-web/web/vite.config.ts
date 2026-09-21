// W0-02 section 1: dev server on 127.0.0.1:5174 proxying /api and /auth to the API; production bundle to web/dist.
// This file and server/src/config.ts are the only places that read process.env (section 1.1 rule).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['rai-source'] },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/auth': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  define: {
    // npm run build forces VITE_API_SUBSTITUTE=false (web/package.json); check-substitute-absent verifies the result.
    'import.meta.env.VITE_API_SUBSTITUTE': JSON.stringify(process.env.VITE_API_SUBSTITUTE === 'true'),
  },
});
