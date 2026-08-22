import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { outDir, sharedPlugins } from './vite.shared.ts'

/** Side panel: React application (html entry). */
export default defineConfig({
  plugins: [react(), ...sharedPlugins],
  build: {
    outDir,
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'panel/index.html'),
      output: {
        entryFileNames: 'panel/assets/[name].js',
        chunkFileNames: 'panel/assets/[name]-[hash].js',
        assetFileNames: 'panel/assets/[name][extname]',
      },
    },
  },
})

export { outDir }
