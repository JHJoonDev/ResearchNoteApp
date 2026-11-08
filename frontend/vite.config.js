import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Built files are served by Express on the same origin. Development .env URLs
  // must not leak into this bundle and bypass its content security policy.
  define:
    command === 'build' ? { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') } : {},
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:5000' } },
}));
