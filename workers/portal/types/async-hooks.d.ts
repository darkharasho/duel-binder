// The slice of node:async_hooks the nodejs_als compatibility flag provides (src/meter.ts). Only this
// package's tsconfig reads it; the root typecheck gets the real types from @types/node.
declare module 'node:async_hooks' {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined
    run<R>(store: T, callback: () => R): R
  }
}
