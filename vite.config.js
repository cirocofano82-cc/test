import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

// vite-plugin-cesium copia gli asset statici di Cesium (Workers, Assets, Widgets)
// e imposta CESIUM_BASE_URL automaticamente.
export default defineConfig({
  plugins: [react(), cesium()],
  server: {
    port: 5173,
    host: true,
    // Proxy di sviluppo verso OpenSky: la richiesta parte dal server Vite,
    // così il browser non incappa in errori CORS chiamando l'API dal localhost.
    // /osky/states/all -> https://opensky-network.org/api/states/all
    proxy: {
      '/osky': {
        target: 'https://opensky-network.org',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/osky/, '/api'),
      },
    },
  },
});
