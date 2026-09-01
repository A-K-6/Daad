/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';

export default defineConfig({
  plugins: [
    react({
      babel: {
        compact: true,
      },
    }),
    process.env.HTTPS === 'true' ? basicSsl() : undefined,
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  clearScreen: false,
  esbuild: {
    target: 'es2022',
    legalComments: 'none',
  },
  server: {
    port: 1420,
    strictPort: true,
    host: true, // Exposes dev server to local network for mobile phone testing
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'es2022',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    cssMinify: 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    reportCompressedSize: false, // Skips slow gzip size calculation for instant build
    chunkSizeWarningLimit: 1200,
  },
});
