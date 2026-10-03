import { defineConfig } from 'vite';

// Served from https://<user>.github.io/run-planner/
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/run-planner/' : '/',
});
