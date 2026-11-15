import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { isSafeSupabaseClientKey } from '../../packages/contracts/src/project.ts';

export default defineConfig(({ mode }) => {
  // VITE_* values are embedded in public JavaScript. Reject secret/service
  // keys BEFORE Vite replaces the environment variable in any client chunk.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (key && !isSafeSupabaseClientKey(key))
    throw new Error('Refusing to embed a privileged or invalid Supabase API key in the public frontend.');
  return {
    plugins: [react()],
    // This is an isolated F1 build. Do not silently replace the authenticated
    // Vercel preview or the independently protected public portfolio API.
    build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
    server: { strictPort: true, port: 5173 },
    preview: { strictPort: true, port: 4173 }
  };
});
