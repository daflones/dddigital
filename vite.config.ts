import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
          media: ['livekit-client', '@livekit/components-react'],
          markdown: ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
})
