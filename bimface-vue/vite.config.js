import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { tokenApi } from './server/tokenApi.js'
import { attributesApi } from './server/attributesApi.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load BIMFACE_* variables from .env / .env.local for the dev-server plugins.
  // Note: env files are read once at startup - editing them requires a dev-server restart.
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'BIMFACE_')

  return {
    base: './', // relative asset URLs: the build works under ANY subpath,
                 // including https://<user>.github.io/<repo>/ (GitHub Pages)
    plugins: [
      vue(),
      vueDevTools(),
      tokenApi(env),
      attributesApi(env),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
