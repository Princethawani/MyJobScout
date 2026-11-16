import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const backendEnvPath = resolve(projectRoot, '../backend/.env');
let backendEnv = '';
try {
  backendEnv = readFileSync(backendEnvPath, 'utf8');
} catch {
  // Use the standard backend port when no local backend .env exists.
}
const backendPort = process.env.VITE_BACKEND_PORT
  ?? backendEnv.match(/^\s*PORT\s*=\s*(\d+)/m)?.[1]
  ?? '3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target: `http://localhost:${backendPort}`, changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') } },
  },
});
