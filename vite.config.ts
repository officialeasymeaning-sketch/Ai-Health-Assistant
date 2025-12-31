import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, (process as any).cwd(), '');

  return {
    plugins: [react()],
    define: {
      // Safely replace process.env.API_KEY. 
      // If the env var is missing, it defaults to empty string, allowing the code's fallback to take over.
      'process.env.API_KEY': JSON.stringify(env.API_KEY || env.VITE_API_KEY || ""),
      // Polyfill process.env.NODE_ENV for libraries that might need it
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
    build: {
      // Increase chunk size limit to suppress warnings
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          // Manual chunk splitting to optimize loading and prevent single large file warnings
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