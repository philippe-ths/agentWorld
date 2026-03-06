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

export interface CompleteGoalDirective {
    type: 'complete_goal';
}

export interface AbandonGoalDirective {
    type: 'abandon_goal';
}

export interface SwitchGoalDirective {
    type: 'switch_goal';
}

export interface UseToolDirective {
    type: 'use_tool';
    toolId: string;
    args: string;
}

export interface SleepDirective {
    type: 'sleep';
}

export interface CreateFunctionDirective {
    type: 'create_function';
    description: string;
    x: number;
    y: number;
}

export interface UpdateFunctionDirective {
    type: 'update_function';
    functionName: string;
    changeDescription: string;
}

export interface DeleteFunctionDirective {
    type: 'delete_function';
    functionName: string;
}

export interface UnknownDirective {
    type: 'unknown';
    line: string;
}

export type Directive = MoveToDirective | WaitDirective | StartConversationDirective | EndConversationDirective
    | CompleteGoalDirective | AbandonGoalDirective | SwitchGoalDirective | UseToolDirective | SleepDirective
    | CreateFunctionDirective | UpdateFunctionDirective | DeleteFunctionDirective | UnknownDirective;

const MOVE_TO_RE = /^move_to\(\s*(\d+)\s*,\s*(\d+)\s*\)$/;
const WAIT_RE = /^wait\(\s*\)$/;
const START_CONVO_RE = /^start_conversation_with\(\s*([A-Za-z_][A-Za-z0-9_ ]*)\s*,\s*(.+)\s*\)$/;
const END_CONVO_RE = /^end_conversation\(\s*\)$/;
const COMPLETE_GOAL_RE = /^complete_goal\(\s*\)$/;
const ABANDON_GOAL_RE = /^abandon_goal\(\s*\)$/;
const SWITCH_GOAL_RE = /^switch_goal\(\s*\)$/;
const USE_TOOL_RE = /^use_tool\(\s*([a-z_][a-z0-9_]*)\s*,\s*"(.+)"\s*\)$/;
const SLEEP_RE = /^sleep\(\s*\)$/;
const CREATE_FUNCTION_RE = /^create_function\(\s*"(.+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/;
const UPDATE_FUNCTION_RE = /^update_function\(\s*"([a-z_][a-z0-9_]*)"\s*,\s*"(.+)"\s*\)$/;
const DELETE_FUNCTION_RE = /^delete_function\(\s*"([a-z_][a-z0-9_]*)"\s*\)$/;

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
        } else if (COMPLETE_GOAL_RE.test(line)) {
            directives.push({ type: 'complete_goal' });
        } else if (ABANDON_GOAL_RE.test(line)) {
            directives.push({ type: 'abandon_goal' });
        } else if (SWITCH_GOAL_RE.test(line)) {
            directives.push({ type: 'switch_goal' });
        } else if ((match = line.match(USE_TOOL_RE))) {
            directives.push({ type: 'use_tool', toolId: match[1], args: match[2] });
        } else if (SLEEP_RE.test(line)) {
            directives.push({ type: 'sleep' });
        } else if ((match = line.match(CREATE_FUNCTION_RE))) {
            directives.push({
                type: 'create_function',
                description: match[1],
                x: parseInt(match[2]),
                y: parseInt(match[3]),
            });
        } else if ((match = line.match(UPDATE_FUNCTION_RE))) {
            directives.push({
                type: 'update_function',
                functionName: match[1],
                changeDescription: match[2],
            });
        } else if ((match = line.match(DELETE_FUNCTION_RE))) {
            directives.push({
                type: 'delete_function',
                functionName: match[1],
            });
        } else {
            console.warn(`%c[DirectiveParser] Unknown directive: "${line}"`, 'color: #ffaa00; font-weight: bold');
            directives.push({ type: 'unknown', line });
        }
    }

    return directives;
}
