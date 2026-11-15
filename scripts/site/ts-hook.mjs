// `node --import ./scripts/site/ts-hook.mjs file.ts`: lets Node run the app's TypeScript modules,
// whose relative imports leave out the .ts extension. Node strips the types itself.
import { register } from 'node:module'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS loader hook
export async function resolve(spec, ctx, next) {
  try {
    return await next(spec, ctx)
  } catch (e) {
    if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(`${spec}.ts`, ctx)
    throw e
  }
}

if (!globalThis.__tsHook) {
  globalThis.__tsHook = true
  register(import.meta.url)
}
