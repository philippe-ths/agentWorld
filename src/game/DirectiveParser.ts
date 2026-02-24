export interface MoveToDirective {
    type: 'move_to';
    x: number;
    y: number;
}

export interface StartConversationDirective {
    type: 'start_conversation_with';
    name: string;
}

export interface WaitDirective {
    type: 'wait';
}

export type Directive = MoveToDirective | StartConversationDirective | WaitDirective;

const MOVE_TO_RE = /^move_to\(\s*(\d+)\s*,\s*(\d+)\s*\)$/;
const CONVO_RE = /^start_conversation_with\(\s*(.+?)\s*\)$/;
const WAIT_RE = /^wait\(\s*\)$/;

export function parseDirectives(text: string): Directive[] {
    const directives: Directive[] = [];

    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;

        let match: RegExpMatchArray | null;

        if ((match = line.match(MOVE_TO_RE))) {
            directives.push({ type: 'move_to', x: parseInt(match[1]), y: parseInt(match[2]) });
        } else if ((match = line.match(CONVO_RE))) {
            directives.push({ type: 'start_conversation_with', name: match[1] });
        } else if (WAIT_RE.test(line)) {
            directives.push({ type: 'wait' });
        } else {
            console.warn(`%c[DirectiveParser] Unknown directive: "${line}"`, 'color: #ffaa00; font-weight: bold');
        }
    }

    return directives;
}
