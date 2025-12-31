import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  // Ensure the key exists for the define block, even if empty
  const apiKey = env.API_KEY || env.VITE_API_KEY || "";

  return {
    plugins: [react()],
    define: {
      // This replacement ensures process.env.API_KEY becomes a string literal in the code
      'process.env.API_KEY': JSON.stringify(apiKey),
    },
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules')) {
              if (id.includes('react')) return 'vendor-react';
              if (id.includes('@google/genai')) return 'vendor-genai';
              if (id.includes('lucide-react')) return 'vendor-icons';
              return 'vendor-others';
            }
          }
        }
      }
    },
    server: {
      host: true
    }
  };
});