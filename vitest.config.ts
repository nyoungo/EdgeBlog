import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * 单测不跑图片编解码：把 `*.wasm` 导入换成空模块，否则 Node 会去解析二进制。
 * 运行时（wrangler）仍然把 `.wasm` 当 CompiledWasm 模块打包。
 */
const wasmStub: Plugin = {
  name: 'wasm-stub',
  enforce: 'pre',
  resolveId(source) {
    return source.endsWith('.wasm') ? fromRoot('./tests/wasm-stub.ts') : null;
  },
};

export default defineConfig({
  plugins: [wasmStub],
  resolve: {
    alias: {
      '@': fromRoot('./src'),
      '@shared': fromRoot('./shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
