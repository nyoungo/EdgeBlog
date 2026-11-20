/**
 * 测试里的 `*.wasm` 占位模块。
 *
 * 图片编解码依赖 WebAssembly，Node 的模块加载器无法直接 import `.wasm`；
 * vitest.config.ts 把它别名为本文件。真正的编解码只在 Worker 运行时执行，
 * 需要在 Workers 环境里用 `wrangler dev` 验证。
 */
export default {};
