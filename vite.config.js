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
  },
});
