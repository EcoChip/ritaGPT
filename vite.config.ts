import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

const require = createRequire(import.meta.url);

function copyPdfjsAssetsPlugin() {
  return {
    name: 'copy-pdfjs-assets',
    closeBundle() {
      try {
        const pdfjsDistDir = path.dirname(
          require.resolve('pdfjs-dist/package.json')
        );
        const outDir = path.resolve(__dirname, 'dist');
        if (!fs.existsSync(outDir)) return;

        const mappings = [
          ['standard_fonts', 'pdfjs-standard-fonts'],
          ['cmaps', 'pdfjs-cmaps'],
          ['wasm', 'pdfjs-wasm'],
          ['iccs', 'pdfjs-iccs'],
        ];

        for (const [srcSub, destSub] of mappings) {
          const srcPath = path.join(pdfjsDistDir, srcSub);
          const destPath = path.join(outDir, destSub);
          if (fs.existsSync(srcPath)) {
            fs.cpSync(srcPath, destPath, { recursive: true, force: true });
          }
        }
      } catch (err) {
        console.warn('Could not copy pdfjs-dist static assets:', err);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const resolvedGeminiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    env.GEMINI_API_KEY ||
    env.VITE_GEMINI_API_KEY ||
    env.GOOGLE_API_KEY ||
    ''
  )
    .trim()
    .replace(/[\r\n\s]+/g, '');

  return {
    plugins: [react(), tailwindcss(), copyPdfjsAssetsPlugin()],
    define: {
      __BUILD_GEMINI_API_KEY__: JSON.stringify(resolvedGeminiKey),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

