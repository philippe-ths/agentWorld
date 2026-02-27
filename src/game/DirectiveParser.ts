export interface MoveToDirective {
    type: 'move_to';
    x: number;
    y: number;
}

export interface WaitDirective {
    type: 'wait';
}

export interface StartConversationDirective {
    type: 'start_conversation_with';
    targetName: string;
    message: string;
}

export interface EndConversationDirective {
    type: 'end_conversation';
}

export type Directive = MoveToDirective | WaitDirective | StartConversationDirective | EndConversationDirective;

const MOVE_TO_RE = /^move_to\(\s*(\d+)\s*,\s*(\d+)\s*\)$/;
const WAIT_RE = /^wait\(\s*\)$/;
const START_CONVO_RE = /^start_conversation_with\(\s*([A-Za-z_][A-Za-z0-9_ ]*)\s*,\s*(.+)\s*\)$/;
const END_CONVO_RE = /^end_conversation\(\s*\)$/;

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
        } else if ((match = line.match(START_CONVO_RE))) {
            directives.push({ type: 'start_conversation_with', targetName: match[1].trim(), message: match[2].trim() });
        } else if (END_CONVO_RE.test(line)) {
            directives.push({ type: 'end_conversation' });
        } else {
            console.warn(`%c[DirectiveParser] Unknown directive: "${line}"`, 'color: #ffaa00; font-weight: bold');
        }
    }

    return directives;
}
