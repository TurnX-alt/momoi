import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  outDir: 'dist',
  // pg / ws stay external (optional / optional native addons). node:sqlite 是 Node 内置，
  // 自动 external。@homurajs/db 与 drizzle-orm 在 dependencies 里，tsup 默认 externalize、
  // 运行时从 node_modules 解析（部署走 pnpm start，node_modules 在场），无需显式列出。
  // @momoi/shared is forced inlined so apps/server/dist/ is self-contained.
  external: ['pg', 'ws'],
  noExternal: ['@momoi/shared'],
})