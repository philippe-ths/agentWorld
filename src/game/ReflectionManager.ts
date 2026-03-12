import { LLM_ENDPOINTS } from './GameConfig';
import { LESSON_LEARNED, REFLECTION } from './prompts';

export type ReflectionTriggerType =
    | 'periodic'
    | 'repeated_failed_action'
    | 'unknown_directive_flood'
    | 'primary_output_obstacle'
    | 'completed_goal'
    | 'conversation_goal_change'
    | 'abandoned_goal'
    | 'switched_goal';

export interface ReflectionTrigger {
    type: ReflectionTriggerType;
    detail: string;
}

export interface ReflectionEvent {
    turnNumber: number;
    kind: 'success' | 'failure';
    summary: string;
    obstacleKey?: string;
    successPattern?: string;
}

export interface ReflectionState {
    repeatedObstacle: string;
    activeObstacle: string;
    resolvedObstacle: string;
    recentSuccessPattern: string;
    failedAssumption: string;
    currentStrategy: string;
    retiredStrategy: string;
    completionLesson: string;
    confidence: number;
    lastOutputFormatFailureKey: string;
    lastOutputFormatFailureTurn: number;
    stale: boolean;
    updatedTurn: number;
    trigger: string;
}

interface PersistedEvent {
    turnNumber: number;
    label: string;
}

const DEFAULT_STATE: ReflectionState = {
    repeatedObstacle: 'none',
    activeObstacle: 'none',
    resolvedObstacle: 'none',
    recentSuccessPattern: 'none',
    failedAssumption: 'none',
    currentStrategy: 'none',
    retiredStrategy: 'none',
    completionLesson: 'none',
    confidence: 3,
    lastOutputFormatFailureKey: 'none',
    lastOutputFormatFailureTurn: 0,
    stale: true,
    updatedTurn: 0,
    trigger: 'initial',
};

const MAX_FAILURE_HISTORY = 6;
const MAX_SUCCESS_HISTORY = 4;

function parseField(content: string, label: string): string | null {
    const match = content.match(new RegExp(`^${escapeRegex(label)}:\\s*(.+)$`, 'm'));
    return match?.[1]?.trim() || null;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(value: string | null | undefined, fallback = 'none'): string {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function parseConfidence(value: string | null): number {
    const parsed = Number.parseInt(value ?? '', 10);
    if (Number.isNaN(parsed)) return DEFAULT_STATE.confidence;
    return Math.min(5, Math.max(1, parsed));
}

function parseEventsSection(content: string, header: string): PersistedEvent[] {
    const section = content
        .split(/^(?=## )/m)
        .map(part => part.trim())
        .find(part => part.startsWith(`## ${header}`));
    if (!section) return [];

    return section
        .split('\n')
        .slice(1)
        .map(line => line.trim())
        .filter(line => line.startsWith('- '))
        .map(line => line.replace(/^-\s+/, ''))
        .map(line => {
            const eventMatch = line.match(/^Turn (\d+):\s*(.+)$/);
            if (!eventMatch) return null;
            return {
                turnNumber: Number.parseInt(eventMatch[1], 10),
                label: eventMatch[2].trim(),
            };
        })
        .filter((event): event is PersistedEvent => event !== null);
}

function serializeEventsSection(header: string, events: PersistedEvent[]): string {
    if (events.length === 0) return `## ${header}\n- none`;
    return [`## ${header}`, ...events.map(event => `- Turn ${event.turnNumber}: ${event.label}`)].join('\n');
}

function serializeState(state: ReflectionState): string {
    return [
        '## Reflection',
        `Repeated obstacle: ${state.repeatedObstacle}`,
        `Active obstacle: ${state.activeObstacle}`,
        `Resolved obstacle: ${state.resolvedObstacle}`,
        `Recent success pattern: ${state.recentSuccessPattern}`,
        `Failed assumption: ${state.failedAssumption}`,
        `Current strategy: ${state.currentStrategy}`,
        `Retired strategy: ${state.retiredStrategy}`,
        `Completion lesson: ${state.completionLesson}`,
        `Confidence: ${state.confidence}`,
        `Last output format failure key: ${state.lastOutputFormatFailureKey}`,
        `Last output format failure turn: ${state.lastOutputFormatFailureTurn}`,
        `Stale reflection flag: ${state.stale ? 'yes' : 'no'}`,
        `Updated turn: ${state.updatedTurn}`,
        `Trigger: ${state.trigger}`,
    ].join('\n');
}

export function parseReflectionMarkdown(content: string): {
    state: ReflectionState;
    failures: PersistedEvent[];
    successes: PersistedEvent[];
} {
    if (!content.trim()) {
        return { state: { ...DEFAULT_STATE }, failures: [], successes: [] };
    }

    const state: ReflectionState = {
        repeatedObstacle: normalizeText(parseField(content, 'Repeated obstacle')),
        activeObstacle: normalizeText(parseField(content, 'Active obstacle')),
        resolvedObstacle: normalizeText(parseField(content, 'Resolved obstacle')),
        recentSuccessPattern: normalizeText(parseField(content, 'Recent success pattern')),
        failedAssumption: normalizeText(parseField(content, 'Failed assumption')),
        currentStrategy: normalizeText(parseField(content, 'Current strategy')),
        retiredStrategy: normalizeText(parseField(content, 'Retired strategy')),
        completionLesson: normalizeText(parseField(content, 'Completion lesson')),
        confidence: parseConfidence(parseField(content, 'Confidence')),
        lastOutputFormatFailureKey: normalizeText(parseField(content, 'Last output format failure key')),
        lastOutputFormatFailureTurn: Number.parseInt(parseField(content, 'Last output format failure turn') ?? '0', 10) || 0,
        stale: (parseField(content, 'Stale reflection flag') ?? '').toLowerCase() === 'yes',
        updatedTurn: Number.parseInt(parseField(content, 'Updated turn') ?? '0', 10) || 0,
        trigger: normalizeText(parseField(content, 'Trigger'), 'initial'),
    };

    return {
        state,
        failures: parseEventsSection(content, 'Recent Failures'),
        successes: parseEventsSection(content, 'Recent Successes'),
    };
}

export function summarizeRepeatedObstacle(failures: PersistedEvent[]): string {
    const counts = new Map<string, { count: number; latestTurn: number }>();

    for (const failure of failures) {
        const current = counts.get(failure.label) ?? { count: 0, latestTurn: 0 };
        current.count += 1;
        current.latestTurn = Math.max(current.latestTurn, failure.turnNumber);
        counts.set(failure.label, current);
    }

    let best: { label: string; count: number; latestTurn: number } | null = null;
    for (const [label, value] of counts.entries()) {
        if (value.count < 2) continue;
        if (!best || value.count > best.count || (value.count === best.count && value.latestTurn > best.latestTurn)) {
            best = { label, count: value.count, latestTurn: value.latestTurn };
        }
    }

    return best ? `${best.label} (repeated ${best.count} times)` : 'none';
}

export class ReflectionManager {
    private npcName: string;
    private state: ReflectionState = { ...DEFAULT_STATE };
    private recentFailures: PersistedEvent[] = [];
    private recentSuccesses: PersistedEvent[] = [];
    private pendingTriggers: ReflectionTrigger[] = [];

    constructor(npcName: string) {
        this.npcName = npcName;
    }

    async load(): Promise<void> {
        let content = '';
        try {
            const res = await fetch(`${LLM_ENDPOINTS.reflections}/${encodeURIComponent(this.npcName)}`);
            if (res.ok) {
                const data = await res.json();
                content = data.content ?? '';
            }
        } catch {
            content = '';
        }

        const parsed = parseReflectionMarkdown(content);
        this.state = parsed.state;
        this.recentFailures = parsed.failures.slice(-MAX_FAILURE_HISTORY);
        this.recentSuccesses = parsed.successes.slice(-MAX_SUCCESS_HISTORY);
        this.pendingTriggers = [];
    }

    async save(): Promise<void> {
        const content = [
            serializeState(this.state),
            serializeEventsSection('Recent Failures', this.recentFailures),
            serializeEventsSection('Recent Successes', this.recentSuccesses),
        ].join('\n\n') + '\n';

        await fetch(`${LLM_ENDPOINTS.reflections}/${encodeURIComponent(this.npcName)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        });
    }

    buildPromptContent(): string {
        if (this.state.updatedTurn === 0 && this.pendingTriggers.length === 0 && this.state.trigger === 'initial') {
            return '';
        }

        return [
            '## Reflection',
            `Repeated obstacle: ${this.state.repeatedObstacle}`,
            `Active obstacle: ${this.state.activeObstacle}`,
            `Resolved obstacle: ${this.state.resolvedObstacle}`,
            `Recent success pattern: ${this.state.recentSuccessPattern}`,
            `Failed assumption: ${this.state.failedAssumption}`,
            `Current strategy: ${this.state.currentStrategy}`,
            `Retired strategy: ${this.state.retiredStrategy}`,
            `Completion lesson: ${this.state.completionLesson}`,
            `Confidence: ${this.state.confidence}/5`,
            `Stale reflection flag: ${this.state.stale ? 'yes' : 'no'}`,
            `Last updated turn: ${this.state.updatedTurn}`,
            `Last trigger: ${this.state.trigger}`,
        ].join('\n');
    }

    getState(): ReflectionState {
        return { ...this.state };
    }

    recordEvent(event: ReflectionEvent): void {
        if (event.kind === 'failure') {
            const label = event.obstacleKey ?? event.summary;
            this.recentFailures.push({ turnNumber: event.turnNumber, label });
            this.recentFailures = this.recentFailures.slice(-MAX_FAILURE_HISTORY);

            const repeatedObstacle = summarizeRepeatedObstacle(this.recentFailures);
            if (repeatedObstacle !== 'none') {
                this.state.repeatedObstacle = repeatedObstacle;
                this.state.activeObstacle = repeatedObstacle;
                this.markStale({
                    type: 'repeated_failed_action',
                    detail: `Recent failures show: ${repeatedObstacle}`,
                });
            }
            return;
        }

        const label = event.successPattern ?? event.summary;
        this.recentSuccesses.push({ turnNumber: event.turnNumber, label });
        this.recentSuccesses = this.recentSuccesses.slice(-MAX_SUCCESS_HISTORY);
        this.state.recentSuccessPattern = label;
    }

    markPeriodicStale(turnNumber: number, interval: number): void {
        if (turnNumber <= 0 || turnNumber % interval !== 0) return;
        if (this.state.updatedTurn === turnNumber && !this.state.stale) return;
        this.markStale({
            type: 'periodic',
            detail: `Periodic reflection refresh due on turn ${turnNumber}`,
        });
    }

    markGoalCompleted(turnNumber: number, goal: string): void {
        this.retireActiveObstacleAndStrategy();
        this.recordEvent({
            turnNumber,
            kind: 'success',
            summary: `Completed goal: ${goal}`,
            successPattern: `Completing goals by following the active plan: ${goal}`,
        });
        this.markStale({ type: 'completed_goal', detail: `Completed goal on turn ${turnNumber}: ${goal}` });
    }

    markGoalAbandoned(turnNumber: number, goal: string): void {
        this.markStale({ type: 'abandoned_goal', detail: `Abandoned goal on turn ${turnNumber}: ${goal}` });
    }

    markGoalSwitched(turnNumber: number, oldGoal: string, newGoal: string): void {
        this.retireActiveObstacleAndStrategy();
        this.markStale({
            type: 'switched_goal',
            detail: `Switched goals on turn ${turnNumber}: ${oldGoal} -> ${newGoal}`,
        });
    }

    markUnknownDirectiveFlood(turnNumber: number, unknownCount: number): void {
        const detail = `Generated ${unknownCount} unknown directives in turn ${turnNumber}`;
        this.state.activeObstacle = `output_format_unknown_flood (${unknownCount})`;
        this.state.currentStrategy = 'Respond with command lines only and no commentary';
        this.recordOutputFormatFailure(turnNumber, 'output_format:unknown_directive_flood', detail);
        this.markStale({ type: 'unknown_directive_flood', detail });
    }

    recordOutputFormatFailure(turnNumber: number, failureKey: string, detail: string): void {
        this.recordEvent({
            turnNumber,
            kind: 'failure',
            summary: detail,
            obstacleKey: failureKey,
        });

        const wasConsecutive = this.state.lastOutputFormatFailureKey === failureKey
            && this.state.lastOutputFormatFailureTurn === turnNumber - 1;

        this.state.lastOutputFormatFailureKey = failureKey;
        this.state.lastOutputFormatFailureTurn = turnNumber;

        if (!wasConsecutive) return;

        this.state.activeObstacle = `${failureKey} (consecutive turns)`;
        this.markStale({
            type: 'primary_output_obstacle',
            detail: `Primary obstacle: ${failureKey} repeated on consecutive turns`,
        });
    }

    async generateCompletionLesson(
        turnNumber: number,
        goal: string,
        memory: string,
        worldState: string,
    ): Promise<void> {
        let response: Response;
        try {
            response = await fetch(LLM_ENDPOINTS.chat, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: LESSON_LEARNED.model,
                    system: LESSON_LEARNED.buildSystem(this.npcName),
                    messages: [{
                        role: 'user',
                        content: [
                            `TURN: ${turnNumber}`,
                            `COMPLETED GOAL: ${goal}`,
                            '',
                            'RECENT REFLECTION:',
                            this.buildPromptContent() || 'none',
                            '',
                            'MEMORY:',
                            memory || 'none',
                            '',
                            'WORLD STATE:',
                            worldState || 'none',
                        ].join('\n'),
                    }],
                    max_tokens: LESSON_LEARNED.maxTokens,
                }),
            });
        } catch (err) {
            console.warn(`[ReflectionManager] Lesson generation network error for ${this.npcName}:`, err);
            return;
        }

        if (!response.ok) {
            console.warn(`[ReflectionManager] Lesson generation API error for ${this.npcName}: HTTP ${response.status}`);
            return;
        }

        const data = await response.json();
        const raw = String(data.text ?? '').trim();
        const lesson = raw.match(/^Lesson:\s*(.+)$/m)?.[1]?.trim() || 'none';
        this.state.completionLesson = lesson;
        if (lesson !== 'none') {
            this.state.recentSuccessPattern = lesson;
        }
    }

    markConversationGoalChange(turnNumber: number, detail: string): void {
        this.recordEvent({
            turnNumber,
            kind: 'success',
            summary: detail,
            successPattern: detail,
        });
        this.markStale({ type: 'conversation_goal_change', detail });
    }

    async refreshIfStale(
        turnNumber: number,
        worldState: string,
        memory: string,
        goals: string,
    ): Promise<boolean> {
        if (!this.state.stale && this.pendingTriggers.length === 0) return false;

        const triggers = this.pendingTriggers.length > 0
            ? this.pendingTriggers
            : [{ type: 'periodic', detail: 'Refresh requested without explicit trigger details' }];
        const triggerText = triggers.map(trigger => `- ${trigger.type}: ${trigger.detail}`).join('\n');
        const failuresText = this.recentFailures.length > 0
            ? this.recentFailures.map(event => `- Turn ${event.turnNumber}: ${event.label}`).join('\n')
            : '- none';
        const successesText = this.recentSuccesses.length > 0
            ? this.recentSuccesses.map(event => `- Turn ${event.turnNumber}: ${event.label}`).join('\n')
            : '- none';

        let response: Response;
        try {
            response = await fetch(LLM_ENDPOINTS.chat, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: REFLECTION.model,
                    system: REFLECTION.buildSystem(this.npcName),
                    messages: [{
                        role: 'user',
                        content: [
                            `TURN: ${turnNumber}`,
                            '',
                            'CURRENT REFLECTION:',
                            this.buildPromptContent() || 'none',
                            '',
                            'TRIGGERS:',
                            triggerText,
                            '',
                            'RECENT FAILURES:',
                            failuresText,
                            '',
                            'RECENT SUCCESSES:',
                            successesText,
                            '',
                            'GOALS:',
                            goals || 'none',
                            '',
                            'MEMORY:',
                            memory || 'none',
                            '',
                            'WORLD STATE:',
                            worldState,
                        ].join('\n'),
                    }],
                    max_tokens: REFLECTION.maxTokens,
                }),
            });
        } catch (err) {
            console.warn(`[ReflectionManager] Network error for ${this.npcName}:`, err);
            return false;
        }

        if (!response.ok) {
            console.warn(`[ReflectionManager] API error for ${this.npcName}: HTTP ${response.status}`);
            return false;
        }

        const data = await response.json();
        const text = String(data.text ?? '').trim();
        const next = parseReflectionMarkdown(text).state;

        this.state = {
            repeatedObstacle: next.repeatedObstacle,
            activeObstacle: next.activeObstacle,
            resolvedObstacle: next.resolvedObstacle,
            recentSuccessPattern: next.recentSuccessPattern === 'none'
                ? this.state.recentSuccessPattern
                : next.recentSuccessPattern,
            failedAssumption: next.failedAssumption,
            currentStrategy: next.currentStrategy,
            retiredStrategy: next.retiredStrategy,
            completionLesson: next.completionLesson === 'none' ? this.state.completionLesson : next.completionLesson,
            confidence: next.confidence,
            lastOutputFormatFailureKey: this.state.lastOutputFormatFailureKey,
            lastOutputFormatFailureTurn: this.state.lastOutputFormatFailureTurn,
            stale: false,
            updatedTurn: turnNumber,
            trigger: triggers.map(trigger => trigger.type).join(', '),
        };
        this.pendingTriggers = [];
        await this.save();
        return true;
    }

    private markStale(trigger: ReflectionTrigger): void {
        this.state.stale = true;
        this.state.trigger = trigger.type;
        this.pendingTriggers.push(trigger);
    }

    private retireActiveObstacleAndStrategy(): void {
        if (this.state.activeObstacle !== 'none') {
            this.state.resolvedObstacle = this.state.activeObstacle;
            this.state.activeObstacle = 'none';
        }
        if (this.state.currentStrategy !== 'none') {
            this.state.retiredStrategy = this.state.currentStrategy;
            this.state.currentStrategy = 'none';
        }
    }
}