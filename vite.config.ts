import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'SharedMemoryDatastructures',
      fileName: (_format: string) => `shared-memory-datastructures.js`,
      formats: ['es'],
    },
    sourcemap: true,
    outDir: 'dist',
  },
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
  ],
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
});
