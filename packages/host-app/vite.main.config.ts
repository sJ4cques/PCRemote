import { defineConfig } from 'vite';

// Los paquetes de @nut-tree-fork llevan binarios nativos (.node) y se cargan
// en runtime desde node_modules; no se pueden empaquetar en el bundle.
const NUT_EXTERNAL = [
  '@nut-tree-fork/nut-js',
  '@nut-tree-fork/shared',
  '@nut-tree-fork/provider-interfaces',
  '@nut-tree-fork/libnut',
  '@nut-tree-fork/libnut-darwin',
  '@nut-tree-fork/libnut-win32',
  '@nut-tree-fork/libnut-linux',
  '@nut-tree-fork/default-clipboard-provider',
];

export default defineConfig({
  build: {
    rollupOptions: {
      external: NUT_EXTERNAL,
    },
  },
});