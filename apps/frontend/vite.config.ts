import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // This is an isolated F1 build. Do not silently replace the authenticated
  // Vercel preview or the independently protected public portfolio API.
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
  server: { strictPort: true, port: 5173 },
  preview: { strictPort: true, port: 4173 }
});
