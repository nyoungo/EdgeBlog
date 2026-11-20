/** Wrangler 会把 `.wasm` 当模块打包，这里补上 TypeScript 声明。 */
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}