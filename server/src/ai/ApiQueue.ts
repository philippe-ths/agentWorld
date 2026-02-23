import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ maxRetries: 3 });

// Priority levels (higher = dispatched first)
export const Priority = {
    BACKGROUND: 0,    // reflection, self-critique
    EVALUATION: 1,    // on-demand goal evaluation
    TICK_IDLE: 2,     // medium loop tick (no active goal)
    REASONING: 3,     // stuck recovery / escalation
    TICK_GOAL: 4,     // medium loop tick (active goal)
    DIALOGUE: 5,      // player-facing conversation
} as const;

export type PriorityLevel = (typeof Priority)[keyof typeof Priority];

interface QueueEntry {
    priority: PriorityLevel;
    params: Anthropic.MessageCreateParams;
    resolve: (msg: Anthropic.Message) => void;
    reject: (err: unknown) => void;
    enqueueTime: number;
}

const queue: QueueEntry[] = [];
let dispatching = false;
let rateLimitResetAt = 0;  // timestamp (ms) when rate limit resets

export function getQueueDepth(): number {
    return queue.length;
}

export function enqueue(
    priority: PriorityLevel,
    params: Anthropic.MessageCreateParams,
): Promise<Anthropic.Message> {
    return new Promise((resolve, reject) => {
        const entry: QueueEntry = { priority, params, resolve, reject, enqueueTime: Date.now() };

        // Insert in priority order (highest priority first)
        let inserted = false;
        for (let i = 0; i < queue.length; i++) {
            if (priority > queue[i].priority) {
                queue.splice(i, 0, entry);
                inserted = true;
                break;
            }
        }
        if (!inserted) queue.push(entry);

        if (queue.length > 5) {
            console.warn(`[ApiQueue] Queue depth: ${queue.length}`);
        }

        dispatch();
    });
}

async function dispatch(): Promise<void> {
    if (dispatching || queue.length === 0) return;
    dispatching = true;

    while (queue.length > 0) {
        // Wait for rate limit reset if needed
        const now = Date.now();
        if (rateLimitResetAt > now) {
            const delay = rateLimitResetAt - now + 100; // add 100ms buffer
            await sleep(delay);
        }

        // Expire requests that have been waiting too long (30s matches client timeout)
        while (queue.length > 0 && Date.now() - queue[queue.length - 1].enqueueTime > 30000) {
            const expired = queue.pop()!;
            expired.reject(new Error('Queue timeout: request waited too long'));
        }

        if (queue.length === 0) break;

        const entry = queue.shift()!;

        try {
            const response = await client.messages.create(entry.params) as Anthropic.Message;

            entry.resolve(response);
        } catch (err) {
            // Check if this is a rate limit error with retry-after info
            if (isRateLimitError(err)) {
                const retryAfter = getRetryAfterMs(err);
                rateLimitResetAt = Date.now() + retryAfter;
                console.warn(`[ApiQueue] Rate limited, waiting ${retryAfter}ms`);
            }
            entry.reject(err);
        }
    }

    dispatching = false;
}

function isRateLimitError(err: unknown): boolean {
    if (err && typeof err === 'object') {
        const status = (err as { status?: number }).status;
        if (status === 429) return true;
        const message = (err as { message?: string }).message;
        if (message && message.includes('rate_limit')) return true;
    }
    return false;
}

function getRetryAfterMs(err: unknown): number {
    if (err && typeof err === 'object') {
        const headers = (err as { headers?: Record<string, string> }).headers;
        if (headers?.['retry-after']) {
            const seconds = parseFloat(headers['retry-after']);
            if (!isNaN(seconds)) return Math.ceil(seconds * 1000);
        }
    }
    // Default: wait 12 seconds (one rate limit window for 5 req/min)
    return 12000;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
