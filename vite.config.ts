import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // Havok ships a .wasm file that it locates relative to its own module; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['@babylonjs/havok'] },
  // The demo build is one script with relative paths, so it can be hosted from any folder.
  base: mode === 'demo' ? './' : '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    rollupOptions: mode === 'demo' ? { output: { inlineDynamicImports: true } } : {},
  },
}));
