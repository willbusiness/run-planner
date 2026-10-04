import { defineConfig } from 'vite';

// Served from https://<user>.github.io/run-planner/
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/run-planner/' : '/',
  optimizeDeps: { exclude: ['maplibre-gl'] }, // keeps MapLibre's worker file resolvable in dev
  build: { chunkSizeWarningLimit: 1200 },
});
