import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.js'),
        pdf: resolve(__dirname, 'src/pdf.js'),
        react: resolve(__dirname, 'src/react.jsx'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      // 외부 라이브러리 및 피어 의존성 외부화 (브라우저 엔트리 Node 빌트인 부재 검증)
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'qrcode',
        'jsqr',
        'pdf-lib',
        '@pdf-lib/fontkit',
      ],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
