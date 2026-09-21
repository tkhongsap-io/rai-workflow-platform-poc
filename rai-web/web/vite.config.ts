// W0-02 section 1: dev server on 127.0.0.1:5174 proxying /api and /auth to the API; production bundle to web/dist.
// This file and server/src/config.ts are the only places that read process.env (section 1.1 rule).
// W1-07: API_PROXY_TARGET lets a Lane B session or the substitute Playwright configuration point the proxy at
// the W1-13 substitute on another loopback port (default: the API on 8787); it is a dev-server setting only and
// has no effect on the production bundle.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['rai-source'] },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: apiProxyTarget, changeOrigin: false },
      '/auth': { target: apiProxyTarget, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  define: {
    // npm run build forces VITE_API_SUBSTITUTE=false (web/package.json); check-substitute-absent verifies the result.
    'import.meta.env.VITE_API_SUBSTITUTE': JSON.stringify(process.env.VITE_API_SUBSTITUTE === 'true'),
  },
});
