// Application dev/build configuration: the real loopback API only. Test substitutes have a separate config.
// `npm run build` sets NODE_ENV=production because Vite otherwise follows the caller's NODE_ENV: the browser suite
// builds under NODE_ENV=test, and React's development build runs every effect twice under StrictMode.
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
});
