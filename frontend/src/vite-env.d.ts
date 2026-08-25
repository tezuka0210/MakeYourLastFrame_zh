// src/vite-env.d.ts

/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module '@/lib/canvasDrag.js'
declare module '@/lib/useStitching.js'
