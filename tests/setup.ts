import { computed, ref } from 'vue'

// Ensure Node 25/26 experimental globalThis.localStorage getter doesn't shadow Web Storage in tests
if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== 'function') {
  const store = new Map<string, string>()
  const memoryStorage: Storage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
    writable: true,
  })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: memoryStorage,
      configurable: true,
      writable: true,
    })
  }
}

// Polyfill Nitro / Nuxt auto-imports used by server utilities and composables
const stateMap = new Map<string, ReturnType<typeof ref>>()

;(globalThis as any).ref = ref
;(globalThis as any).computed = computed
;(globalThis as any).useState = <T>(key: string, init?: () => T) => {
  if (!stateMap.has(key)) {
    stateMap.set(key, ref(init ? init() : undefined))
  }
  return stateMap.get(key)!
}

;(globalThis as any).__runtimeConfigOverride = {}

;(globalThis as any).useRuntimeConfig = () => ({
  blobReadWriteToken: '',
  cronSecret: '',
  cacheTtlHours: 24,
  maxDurationSeconds: 3600,
  youtubeProxy: '',
  youtubeCookies: '',
  soundcloudClientId: '',
  ...(globalThis as any).__runtimeConfigOverride,
})

;(globalThis as any).createError = (opts: { statusCode: number, statusMessage: string }) => {
  const err = new Error(opts.statusMessage) as Error & { statusCode: number, statusMessage: string }
  err.statusCode = opts.statusCode
  err.statusMessage = opts.statusMessage
  return err
}

export function resetTestState(configOverride: Record<string, any> = {}) {
  stateMap.clear()
  ;(globalThis as any).__runtimeConfigOverride = configOverride
}
