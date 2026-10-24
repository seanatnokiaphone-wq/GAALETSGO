import { defineConfig } from 'vite';

export default defineConfig({
  // Havok ships a .wasm file that it locates relative to its own module; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['@babylonjs/havok'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 8000 },
});
