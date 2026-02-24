export interface MoveToDirective {
    type: 'move_to';
    x: number;
    y: number;
}

export interface WaitDirective {
    type: 'wait';
}

export type Directive = MoveToDirective | WaitDirective;

const MOVE_TO_RE = /^move_to\(\s*(\d+)\s*,\s*(\d+)\s*\)$/;
const WAIT_RE = /^wait\(\s*\)$/;

export function parseDirectives(text: string): Directive[] {
    const directives: Directive[] = [];

    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;

        let match: RegExpMatchArray | null;

        if ((match = line.match(MOVE_TO_RE))) {
            directives.push({ type: 'move_to', x: parseInt(match[1]), y: parseInt(match[2]) });
        } else if (WAIT_RE.test(line)) {
            directives.push({ type: 'wait' });
        } else {
            console.warn(`%c[DirectiveParser] Unknown directive: "${line}"`, 'color: #ffaa00; font-weight: bold');
        }
    }

    return directives;
}
