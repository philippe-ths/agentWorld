import vm from 'node:vm';

const TIMEOUT_MS = 1000;

function resultToString(value) {
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function buildContext(args) {
    return vm.createContext({
        __args: args,
        Math,
        String,
        Array,
        Object,
        JSON,
        Number,
        Date,
        RegExp,
        Map,
        Set,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
    });
}

function runFunction(parameters, code, args) {
    const params = parameters.join(', ');
    const wrapped = `
"use strict";
const __fn = (${params}) => {
${code}
};
__fn(...__args);
`;

    const script = new vm.Script(wrapped, { filename: 'npc-function.vm.js' });
    const context = buildContext(args);
    return script.runInContext(context, { timeout: TIMEOUT_MS });
}

export function codeExecutor() {
    return {
        name: 'code-executor',
        configureServer(server) {
            server.middlewares.use('/api/execute', async (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.end(JSON.stringify({ error: 'Method not allowed' }));
                    return;
                }

                let body = '';
                for await (const chunk of req) {
                    body += chunk;
                }

                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                    return;
                }

                const parameters = Array.isArray(parsed.parameters) ? parsed.parameters : null;
                const code = typeof parsed.code === 'string' ? parsed.code : null;
                const args = Array.isArray(parsed.args) ? parsed.args : null;

                if (!parameters || !code || !args || parameters.some(p => typeof p !== 'string')) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'Invalid payload. Expected parameters:string[], code:string, args:unknown[]' }));
                    return;
                }

                try {
                    const result = runFunction(parameters, code, args);
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ result: resultToString(result) }));
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    res.setHeader('Content-Type', 'application/json');
                    // Return execution errors in-band so the game loop is unaffected.
                    res.end(JSON.stringify({ error: message }));
                }
            });
        },
    };
}
