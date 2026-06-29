import { defineConfig } from 'vite';

// Dev/build config for the browser hot-seat renderer (H5 preview).
export default defineConfig({
  root: 'src/web',
  publicDir: false,
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
  },
});
