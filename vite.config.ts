import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [
    react(),
    process.env.HTTPS === 'true' ? basicSsl() : undefined,
  ].filter(Boolean),
  base: './',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: true, // Exposes dev server to local network for mobile phone testing
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
