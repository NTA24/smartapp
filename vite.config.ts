import type { ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Ensure .wasm served with correct MIME during dev (decoder resource loading)
function wasmMimePlugin() {
  return {
    name: 'wasm-mime',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
        if (req.url?.split('?')[0]?.endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm')
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const tammiExchangeUrl =
    env.NEWGEN_TAMMI_EXCHANGE_URL ||
    'https://api.newgenjsc.com/auth/api/v1/exchange-tammi'
  const tammiExchangeTarget = new URL(tammiExchangeUrl)
  const serviceAuth = env.NEWGEN_SERVICE_AUTH || ''

  return {
    plugins: [react(), wasmMimePlugin()],
    server: {
      proxy: {
        '/api/exchange-tammi': {
          target: tammiExchangeTarget.origin,
          changeOrigin: true,
          rewrite: () => `${tammiExchangeTarget.pathname}${tammiExchangeTarget.search}`,
          configure(proxy) {
            proxy.on('proxyReq', (proxyReq) => {
              if (serviceAuth) proxyReq.setHeader('X-Service-Auth', serviceAuth)
            })
          },
        },
      },
    },
  }
})
