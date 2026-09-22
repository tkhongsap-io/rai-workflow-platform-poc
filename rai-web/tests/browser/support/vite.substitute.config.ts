// Test-only API substitute proxy and visible warning. Never imported by application configuration.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import th from '@rai/shared/locales/th.json' with { type: 'json' };

export default defineConfig(({ command }) => {
  if (process.env.NODE_ENV !== 'test' || command !== 'serve')
    throw new Error('API substitute UI requires test mode and cannot build');
  const port = Number(process.env.SUBSTITUTE_PORT ?? '8789');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid substitute port');
  const target = `http://127.0.0.1:${port}`;
  return {
    plugins: [
      react(),
      {
        name: 'test-only-substitute-warning',
        configResolved(config) {
          if (config.server.host !== '127.0.0.1') throw new Error('API substitute UI requires loopback');
        },
        transformIndexHtml: () => [
          {
            tag: 'aside',
            attrs: { 'data-testid': 'substitute-banner', 'aria-label': th['shell.substitute_banner'] },
            children: th['shell.substitute_banner'],
            injectTo: 'body-prepend',
          },
          {
            tag: 'style',
            children:
              '[data-testid="substitute-banner"] { margin: 0; padding: 6px 16px; background: #fff1f0; color: #8a1c13; font-size: 12.5px; font-weight: 600; }',
            injectTo: 'head',
          },
        ],
      },
    ],
    resolve: { conditions: ['rai-source'] },
    server: {
      host: '127.0.0.1',
      strictPort: true,
      proxy: { '/api': { target, changeOrigin: false }, '/auth': { target, changeOrigin: false } },
    },
  };
});
