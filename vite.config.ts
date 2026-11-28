import { defineConfig } from 'vite';

// The Python server (web/app.py) serves client/dist at / and owns every other path.
// In development, run `pnpm serve` next to `pnpm dev`; these paths are passed on to it.
const backend = 'http://127.0.0.1:8000';
const passed = ['/api', '/static', '/health'];

export default defineConfig({
  root: 'client',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: Object.fromEntries(passed.map((p) => [p, backend])) },
});
