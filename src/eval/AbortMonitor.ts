import { AbortReason } from './types';

interface FailedAction {
    actionType: string;
    target: string | undefined;
    failureType: string;
}

function failedActionKey(a: FailedAction): string {
    return `${a.actionType}|${a.target ?? ''}|${a.failureType}`;
}

/**
 * Tracks default abort conditions during a scenario run.
 *
 * Abort rules (from spec):
 * 1. Repeated invalid output — 2 times in the same run
 * 2. Repeated failed action loop — same failed action 3 times consecutively
 * 3. Unexpected runtime error — handled externally, triggers immediate abort
 */
export class AbortMonitor {
    private invalidOutputCount = 0;
    private recentFailedActions: string[] = [];

    /** Call when the output guard falls back to wait() due to invalid output. */
    recordInvalidOutput(): void {
        this.invalidOutputCount++;
    }

    /** Call when an action directive fails during execution. */
    recordFailedAction(actionType: string, target: string | undefined, failureType: string): void {
        const key = failedActionKey({ actionType, target, failureType });
        this.recentFailedActions.push(key);

        // Only keep enough history to detect 3 consecutive same failures
        if (this.recentFailedActions.length > 10) {
            this.recentFailedActions.shift();
        }
    }

    /** Call when an action succeeds — breaks the consecutive failure chain. */
    recordSuccess(): void {
        this.recentFailedActions = [];
    }

    /** Check all default abort conditions. Returns null if no abort triggered. */
    checkDefaultAborts(): AbortReason | null {
        if (this.invalidOutputCount >= 2) {
            return { reason: 'repeated invalid output' };
        }

        if (this.hasConsecutiveFailureLoop()) {
            return { reason: 'repeated failed action loop' };
        }

        return null;
    }

    private hasConsecutiveFailureLoop(): boolean {
        const actions = this.recentFailedActions;
        if (actions.length < 3) return false;

        const last = actions[actions.length - 1];
        const secondLast = actions[actions.length - 2];
        const thirdLast = actions[actions.length - 3];

        return last === secondLast && secondLast === thirdLast;
    }
}
