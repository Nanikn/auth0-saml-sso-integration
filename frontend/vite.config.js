import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// One browser origin. Auth0 posts the assertion to /api/saml/acs on this
// server, and Vite forwards /api to the Express process. The session cookie
// is therefore set and sent on localhost:5173, not split across ports.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
      },
    },
  },
});
