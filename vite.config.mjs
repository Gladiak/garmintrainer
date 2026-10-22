import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('./', import.meta.url));
  const backendPort = process.env.PORT || loadEnv(mode, root, 'PORT').PORT || 3000;
  const proxy = { '/api': { target: `http://127.0.0.1:${backendPort}`, changeOrigin: true } };
  return {
    root: fileURLToPath(new URL('./frontend', import.meta.url)),
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy, fs: { allow: [root] } },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
    build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 750 },
  };
});
