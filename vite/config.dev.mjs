import { defineConfig } from 'vite';
import { anthropicProxy } from './anthropic-proxy.mjs';

export default defineConfig({
    base: './',
    plugins: [anthropicProxy()],
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    phaser: ['phaser']
                }
            }
        },
    },
    server: {
        port: 8080
    }
});
