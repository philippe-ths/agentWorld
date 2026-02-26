import { defineConfig } from 'vite';
import { anthropicProxy } from './anthropic-proxy.mjs';
import { logIO } from './log-io.mjs';
import { summarizeProxy } from './summarize-proxy.mjs';

export default defineConfig({
    base: './',
    plugins: [anthropicProxy(), logIO(), summarizeProxy()],
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
