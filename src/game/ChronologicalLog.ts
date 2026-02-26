// ── Configuration ───────────────────────────────────────────
export const SUMMARIZE_EVERY_N_TURNS = 5;
export const LOG_CHAR_BUDGET = 4000;

// ── Data model ──────────────────────────────────────────────

interface TurnEntry {
    turnNumber: number;
    lines: string[];
}

interface Summary {
    turnStart: number;
    turnEnd: number;
    text: string;
}

// ── Serialization / parsing ─────────────────────────────────

function serializeSummary(s: Summary): string {
    return `## Summary (Turns ${s.turnStart}-${s.turnEnd})\n${s.text}`;
}

function serializeEntry(e: TurnEntry): string {
    return `## Turn ${e.turnNumber}\n${e.lines.map(l => `- ${l}`).join('\n')}`;
}

function parseMarkdown(md: string): { summaries: Summary[]; entries: TurnEntry[] } {
    const summaries: Summary[] = [];
    const entries: TurnEntry[] = [];
    if (!md.trim()) return { summaries, entries };

    const sections = md.split(/^(?=## )/m);

    for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed) continue;

        const summaryMatch = trimmed.match(/^## Summary \(Turns (\d+)-(\d+)\)\n([\s\S]*)$/);
        if (summaryMatch) {
            summaries.push({
                turnStart: parseInt(summaryMatch[1]),
                turnEnd: parseInt(summaryMatch[2]),
                text: summaryMatch[3].trim(),
            });
            continue;
        }

        const turnMatch = trimmed.match(/^## Turn (\d+)\n([\s\S]*)$/);
        if (turnMatch) {
            const lines = turnMatch[2]
                .split('\n')
                .map(l => l.replace(/^- /, '').trim())
                .filter(l => l.length > 0);
            entries.push({ turnNumber: parseInt(turnMatch[1]), lines });
        }
    }

    return { summaries, entries };
}

// ── ChronologicalLog class ──────────────────────────────────

export class ChronologicalLog {
    private npcName: string;
    private summaries: Summary[] = [];
    private entries: TurnEntry[] = [];
    private currentEntry: TurnEntry | null = null;

    constructor(npcName: string) {
        this.npcName = npcName;
    }

    async load(): Promise<void> {
        const res = await fetch(`/api/logs/${encodeURIComponent(this.npcName)}`);
        if (!res.ok) return;
        const { content } = await res.json();
        const parsed = parseMarkdown(content);
        this.summaries = parsed.summaries;
        this.entries = parsed.entries;
    }

    async save(): Promise<void> {
        const parts: string[] = [];
        for (const s of this.summaries) parts.push(serializeSummary(s));
        for (const e of this.entries) parts.push(serializeEntry(e));
        const content = parts.join('\n\n') + '\n';

        await fetch(`/api/logs/${encodeURIComponent(this.npcName)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        });
    }

    startTurn(
        turnNumber: number,
        position: { x: number; y: number },
        allEntities: { name: string; tilePos: { x: number; y: number } }[],
    ): void {
        const lines: string[] = [];
        lines.push(`I am at (${position.x},${position.y})`);

        const others = allEntities.filter(
            e => !(e.tilePos.x === position.x && e.tilePos.y === position.y),
        );
        if (others.length > 0) {
            const visible = others.map(e => `${e.name} at (${e.tilePos.x},${e.tilePos.y})`);
            lines.push(`I can see: ${visible.join(', ')}`);
        }

        this.currentEntry = { turnNumber, lines };
        this.entries.push(this.currentEntry);
    }

    recordAction(description: string): void {
        if (this.currentEntry) {
            this.currentEntry.lines.push(description);
        }
    }

    buildPromptContent(charBudget: number): string {
        if (this.summaries.length === 0 && this.entries.length === 0) return '';

        const summaryTexts = this.summaries.map(s => serializeSummary(s));
        const entryTexts = this.entries.map(e => serializeEntry(e));

        // Start with all content
        let combined = [...summaryTexts, ...entryTexts];
        let result = combined.join('\n\n');

        // Drop oldest summaries first if over budget
        let dropIndex = 0;
        while (result.length > charBudget && dropIndex < summaryTexts.length) {
            dropIndex++;
            combined = [...summaryTexts.slice(dropIndex), ...entryTexts];
            result = combined.join('\n\n');
        }

        // If still over budget, drop oldest entries
        let entryDropIndex = 0;
        while (result.length > charBudget && entryDropIndex < entryTexts.length - 1) {
            entryDropIndex++;
            combined = [...summaryTexts.slice(dropIndex), ...entryTexts.slice(entryDropIndex)];
            result = combined.join('\n\n');
        }

        return result;
    }

    async maybeSummarize(summarizeEveryN: number): Promise<void> {
        if (this.entries.length <= summarizeEveryN) return;

        // Entries eligible for summarization: everything except the last N
        const toSummarize = this.entries.slice(0, this.entries.length - summarizeEveryN);
        if (toSummarize.length < summarizeEveryN) return;

        const entriesText = toSummarize.map(e => serializeEntry(e)).join('\n\n');

        let summary: string;
        try {
            const res = await fetch('/api/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries: entriesText }),
            });
            if (!res.ok) {
                console.warn(`[ChronologicalLog] Summarize failed for ${this.npcName}: HTTP ${res.status}`);
                return;
            }
            const data = await res.json();
            summary = data.summary;
        } catch (err) {
            console.warn(`[ChronologicalLog] Summarize error for ${this.npcName}:`, err);
            return;
        }

        const turnStart = toSummarize[0].turnNumber;
        const turnEnd = toSummarize[toSummarize.length - 1].turnNumber;

        this.summaries.push({ turnStart, turnEnd, text: summary });
        this.entries = this.entries.slice(toSummarize.length);

        await this.save();
    }

    getLastTurnNumber(): number {
        let last = 0;
        for (const s of this.summaries) {
            if (s.turnEnd > last) last = s.turnEnd;
        }
        for (const e of this.entries) {
            if (e.turnNumber > last) last = e.turnNumber;
        }
        return last;
    }
}
