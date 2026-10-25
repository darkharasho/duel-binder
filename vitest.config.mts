import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const alias = {
  '@': resolve('src/renderer/src'),
  '@shared': resolve('src/shared')
}

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'main',
          environment: 'node',
          globals: true,
          include: ['tests/main/**/*.test.ts']
        }
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          globals: true,
          include: ['tests/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/renderer/setup.ts']
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'portal',
          environment: 'node',
          globals: true,
          include: ['tests/portal/**/*.test.ts']
        }
      },
      {
        test: {
          name: 'workers',
          environment: 'node',
          globals: true,
          include: ['workers/**/test/*.test.js']
        }
      }
    ]
  }
})
