import { defineConfig } from 'vite';
import { anthropicProxy } from './anthropic-proxy.mjs';
import { logIO } from './log-io.mjs';

export default defineConfig({
    base: './',
    plugins: [anthropicProxy(), logIO()],
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
