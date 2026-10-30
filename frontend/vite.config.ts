import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Proxies mirror nginx.conf's location blocks so nginx, this dev server and
// direct Docker DNS all behave the same: in-container targets are
// `backend`/`ludo-engine`, on the host their published ports.
const inContainer = process.env.VITE_IN_CONTAINER === 'true';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // publish.sh points these outside the bind-mounted /app to dodge a Docker
  // Desktop VirtioFS bug (-35 on zero-copy reads); unset they fall back to the
  // normal in-project paths. See docs/architecture.md (SPA build handoff).
  publicDir: process.env.BUILD_PUBLIC_DIR || 'public',
  build: {
    outDir: process.env.BUILD_OUT_DIR || 'dist',
    emptyOutDir: true,
    cssMinify: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@dicebear')) {
              return 'vendor-dicebear';
            }
            if (id.includes('socket.io-client')) {
              return 'vendor-socket';
            }
            if (id.includes('react') || id.includes('react-dom')) {
              return 'vendor-react';
            }
            if (id.includes('i18next')) {
              return 'vendor-i18n';
            }
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    host: true,
    port: 8080,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: process.env.VITE_ENGINE_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
      // The session socket: a distinct path, so this prefix cannot shadow or be
      // shadowed by /socket.io above (prefixes match from the start).
      '/ws-socket.io': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
    // Bind mounts on macOS don't deliver inotify events reliably, so file
    // changes only reach HMR via polling when containerised.
    watch: inContainer ? { usePolling: true, interval: 300 } : undefined,
  },
});
