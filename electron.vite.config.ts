import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    // github-markdown-css 以 ?raw 文本形式内进主进程产物（导出文档的内嵌样式）；
    // remark-frontmatter 是 ESM-only 包，外部化后运行时 require 拿到的是命名空间
    // 对象而非函数（CJS↔ESM 互操作坑），unified 会把它误判为空 preset 直接抛错。
    // 两者都排除出外部化、随主进程一起打包。
    plugins: [externalizeDepsPlugin({ exclude: ['github-markdown-css', 'remark-frontmatter'] })],
    build: {
      emptyOutDir: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      emptyOutDir: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      emptyOutDir: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
    plugins: [react()],
  },
});
