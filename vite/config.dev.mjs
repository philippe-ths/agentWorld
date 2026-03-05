import { defineConfig } from 'vite';
import { anthropicProxy } from './anthropic-proxy.mjs';
import { searchProxy } from './search-proxy.mjs';
import { logIO } from './log-io.mjs';
import { codeExecutor } from './code-executor.mjs';
import { functionsIO } from './functions-io.mjs';

export default defineConfig({
    base: './',
    plugins: [anthropicProxy(), searchProxy(), logIO(), codeExecutor(), functionsIO()],
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
