import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import http from 'node:http'
import https from 'node:https'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Sonde : le backend local écoute en HTTPS (certificat auto-signé) quand les certificats
// existent, sinon en HTTP. Sans ce test, le proxy /uploads (images des tickets/emails) pointe
// vers http://localhost:4000 → 500 → images cassées en dev, alors que /api (URL absolue dans
// .env) fonctionne. timeout court : connexion refusée = réponse immédiate.
function probeBackend(url, timeout = 1000) {
  return new Promise((resolve) => {
    try {
      const lib = url.startsWith('https:') ? https : http
      const req = lib.get(url, { rejectUnauthorized: false, timeout }, (res) => {
        res.resume()
        resolve(true)
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
    } catch {
      resolve(false)
    }
  })
}

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, __dirname, '')

  // Cible du proxy : VITE_BACKEND_URL explicite (dev sur un autre host/port),
  // sinon détection automatique HTTPS/HTTP du backend local.
  let backendTarget = env.VITE_BACKEND_URL || process.env.VITE_BACKEND_URL
  if (!backendTarget) {
    backendTarget = (await probeBackend('https://localhost:4000/health'))
      ? 'https://localhost:4000'
      : 'http://localhost:4000'
  }
  // secure: false → accepte le certificat auto-signé généré au démarrage du conteneur
  const proxy = { secure: false, changeOrigin: true, target: backendTarget }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      minify: 'terser',
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'ui-vendor': ['framer-motion', 'canvas-confetti'],
            'chart-vendor': ['recharts'],
            'ag-grid': ['ag-grid-react', 'ag-grid-community']
          }
        }
      }
    },
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': proxy,
        '/uploads': proxy,
        '/socket.io': { ...proxy, ws: true }
      }
    }
  }
})
