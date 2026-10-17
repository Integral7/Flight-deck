import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
