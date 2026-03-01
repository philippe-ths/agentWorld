export interface Goal {
    source: string;
    goal: string;
    status: 'active' | 'pending';
    plan: string;
    tasks: string;
}

function serializeGoal(g: Goal, header: string): string {
    return [
        `## ${header}`,
        `Source: ${g.source}`,
        `Goal: ${g.goal}`,
        `Status: ${g.status}`,
        `Plan: ${g.plan}`,
        `Tasks: ${g.tasks}`,
    ].join('\n');
}

function parseGoalSection(text: string, status: 'active' | 'pending'): Goal | null {
    const source = text.match(/^Source:\s*(.+)$/m)?.[1]?.trim();
    const goal = text.match(/^Goal:\s*(.+)$/m)?.[1]?.trim();
    const plan = text.match(/^Plan:\s*(.+)$/m)?.[1]?.trim();
    const tasks = text.match(/^Tasks:\s*(.+)$/m)?.[1]?.trim();
    if (!source || !goal || !plan || !tasks) return null;
    return { source, goal, status, plan, tasks };
}

export class GoalManager {
    private npcName: string;
    private activeGoal: Goal | null = null;
    private pendingGoal: Goal | null = null;

    constructor(npcName: string) {
        this.npcName = npcName;
    }

    async load(): Promise<void> {
        let content = '';
        try {
            const res = await fetch(`/api/goals/${this.npcName}`);
            if (res.ok) {
                const data = await res.json();
                content = data.content ?? '';
            }
        } catch { /* file doesn't exist yet */ }

        this.activeGoal = null;
        this.pendingGoal = null;
        if (!content.trim()) return;

        const sections = content.split(/^(?=## )/m);
        for (const section of sections) {
            const trimmed = section.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('## Active Goal')) {
                this.activeGoal = parseGoalSection(trimmed, 'active');
            } else if (trimmed.startsWith('## Pending Goal')) {
                this.pendingGoal = parseGoalSection(trimmed, 'pending');
            }
        }
    }

    async save(): Promise<void> {
        const parts: string[] = [];
        if (this.activeGoal) parts.push(serializeGoal(this.activeGoal, 'Active Goal'));
        if (this.pendingGoal) parts.push(serializeGoal(this.pendingGoal, 'Pending Goal'));

        await fetch(`/api/goals/${this.npcName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: parts.join('\n\n') }),
        });
    }

    getActiveGoal(): Goal | null {
        return this.activeGoal;
    }

    getPendingGoal(): Goal | null {
        return this.pendingGoal;
    }

    setActiveGoal(goal: Goal): void {
        this.activeGoal = { ...goal, status: 'active' };
    }

    setPendingGoal(goal: Goal): void {
        this.pendingGoal = { ...goal, status: 'pending' };
    }

    /** Clear active goal and auto-promote pending if one exists. Returns the completed goal description. */
    completeGoal(): { completed: string; promoted: Goal | null } | null {
        if (!this.activeGoal) return null;
        const completed = this.activeGoal.goal;
        this.activeGoal = null;
        const promoted = this.promotePending();
        return { completed, promoted };
    }

    /** Abandon active goal and auto-promote pending if one exists. Returns the abandoned goal description. */
    abandonGoal(): { abandoned: string; promoted: Goal | null } | null {
        if (!this.activeGoal) return null;
        const abandoned = this.activeGoal.goal;
        this.activeGoal = null;
        const promoted = this.promotePending();
        return { abandoned, promoted };
    }

    /** Abandon active goal and promote pending to active. Returns old and new goal descriptions. */
    switchGoal(): { abandoned: string; newGoal: Goal } | null {
        if (!this.activeGoal || !this.pendingGoal) return null;
        const abandoned = this.activeGoal.goal;
        this.activeGoal = { ...this.pendingGoal, status: 'active' };
        const newGoal = this.activeGoal;
        this.pendingGoal = null;
        return { abandoned, newGoal };
    }

    /** Format goals for injection into the decision prompt. */
    buildPromptContent(): string {
        const parts: string[] = [];
        if (this.activeGoal) {
            parts.push(serializeGoal(this.activeGoal, 'Active Goal'));
        }
        if (this.pendingGoal) {
            parts.push(serializeGoal(this.pendingGoal, 'Pending Goal'));
        }
        return parts.join('\n\n');
    }

    private promotePending(): Goal | null {
        if (!this.pendingGoal) return null;
        this.activeGoal = { ...this.pendingGoal, status: 'active' };
        const promoted = this.activeGoal;
        this.pendingGoal = null;
        return promoted;
    }
}
