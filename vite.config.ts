import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: path.join(__dirname, 'src/main/index.ts'),
        vite: {
          build: {
            outDir: path.join(__dirname, 'dist/main'),
            rollupOptions: {
              external: (id) => {
                const exactExternals = [
                  'electron', 'electron-updater', 'ws', 'lowdb', 'lowdb/node',
                  'openai', '@anthropic-ai/sdk', 'electron-store', '@jitsi/robotjs',
                  'unreal-remote-execution', 'posthog-node', 'child_process',
                ];
                if (exactExternals.includes(id)) return true;
                if (id.startsWith('@modelcontextprotocol/sdk')) return true;
                if (id.startsWith('@runreal/unreal-mcp')) return true;
                if (id.startsWith('node:')) return true;
                return false;
              },
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'src/main/preload.ts'),
        vite: {
          build: {
            outDir: path.join(__dirname, 'dist/preload'),
            rollupOptions: {
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
              },
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@main': path.resolve(__dirname, 'src/main'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  envDir: __dirname,
  root: path.join(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.join(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.join(__dirname, 'src/renderer/index.html'),
        vignette: path.join(__dirname, 'src/renderer/vignette.html'),
        cursor: path.join(__dirname, 'src/renderer/cursor.html'),
        pasteHint: path.join(__dirname, 'src/renderer/pasteHint.html'),
      },
    },
  },
});
