import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Observation } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const SKILLS_FILE = path.join(DATA_DIR, 'learned_skills.json');

// ── Types ────────────────────────────────────────────────

export interface SkillDef {
    name: string;
    description: string;
    precondition: (obs: Observation) => boolean;
    /** For composed skills: ordered list of sub-skill names to execute */
    steps?: string[];
    /** Whether this skill was learned at runtime */
    learned?: boolean;
    /** Success/failure tracking */
    successes: number;
    failures: number;
}

export interface StoredSkill {
    name: string;
    description: string;
    steps?: string[];
    preconditionRules?: string[];   // serializable precondition descriptors
    successes: number;
    failures: number;
}

// ── Built-in skills ──────────────────────────────────────

const BUILTIN_SKILLS: SkillDef[] = [
    {
        name: 'wander',
        description: 'Pick a random nearby walkable tile and move there. Good for exploring.',
        precondition: (obs) => !obs.isInConversation,
        successes: 0, failures: 0,
    },
    {
        name: 'move_to',
        description: 'Move to a specific tile coordinate.',
        precondition: (obs) => !obs.isInConversation,
        successes: 0, failures: 0,
    },
    {
        name: 'approach_entity',
        description: 'Walk toward a nearby entity to get close to them.',
        precondition: (obs) => !obs.isInConversation && obs.nearbyEntities.length > 0,
        successes: 0, failures: 0,
    },
    {
        name: 'converse',
        description: 'Start or continue a conversation with a nearby entity.',
        precondition: (obs) => obs.nearbyEntities.some(e => e.distance <= 3),
        successes: 0, failures: 0,
    },
    {
        name: 'idle',
        description: 'Wait in place for a while. Good for pausing between activities.',
        precondition: () => true,
        successes: 0, failures: 0,
    },
    {
        name: 'end_conversation',
        description: 'End the current conversation and resume other activities.',
        precondition: (obs) => obs.isInConversation,
        successes: 0, failures: 0,
    },
];

// ── Runtime state ────────────────────────────────────────

const learnedSkills: SkillDef[] = [];

// ── Precondition builders from rule strings ──────────────

function buildPrecondition(rules?: string[]): (obs: Observation) => boolean {
    if (!rules || rules.length === 0) return () => true;
    return (obs: Observation) => {
        for (const rule of rules!) {
            const r = rule.toLowerCase();
            if (r.includes('not in conversation') && obs.isInConversation) return false;
            if (r.includes('entity nearby') && obs.nearbyEntities.length === 0) return false;
            if (r.includes('entity close') && !obs.nearbyEntities.some(e => e.distance <= 3)) return false;
        }
        return true;
    };
}

// ── Persistence ──────────────────────────────────────────

async function ensureDataDir() {
    if (!existsSync(DATA_DIR)) {
        await mkdir(DATA_DIR, { recursive: true });
    }
}

export async function loadLearnedSkills(): Promise<void> {
    await ensureDataDir();
    if (!existsSync(SKILLS_FILE)) return;
    const data = await readFile(SKILLS_FILE, 'utf-8');
    const stored = JSON.parse(data) as StoredSkill[];
    learnedSkills.length = 0;
    for (const s of stored) {
        learnedSkills.push({
            name: s.name,
            description: s.description,
            precondition: buildPrecondition(s.preconditionRules),
            steps: s.steps,
            learned: true,
            successes: s.successes,
            failures: s.failures,
        });
    }
    if (learnedSkills.length > 0) {
        console.log(`[SkillLibrary] Loaded ${learnedSkills.length} learned skills`);
    }
}

async function saveLearnedSkills(): Promise<void> {
    await ensureDataDir();
    const stored: StoredSkill[] = learnedSkills.map(s => ({
        name: s.name,
        description: s.description,
        steps: s.steps,
        successes: s.successes,
        failures: s.failures,
    }));
    await writeFile(SKILLS_FILE, JSON.stringify(stored, null, 2));
}

// ── Public API ───────────────────────────────────────────

function allSkills(): SkillDef[] {
    return [...BUILTIN_SKILLS, ...learnedSkills];
}

export function getMatchingSkills(observation: Observation): string[] {
    return allSkills()
        .filter(s => s.precondition(observation))
        .map(s => {
            let desc = `${s.name} (${s.description})`;
            if (s.steps) desc += ` [composed: ${s.steps.join(' → ')}]`;
            return desc;
        });
}

export function getAllSkillNames(): string[] {
    return allSkills().map(s => s.name);
}

export function getSkillByName(name: string): SkillDef | undefined {
    return allSkills().find(s => s.name === name);
}

export async function addSkill(
    name: string,
    description: string,
    steps?: string[],
    preconditionRules?: string[],
): Promise<boolean> {
    // Don't overwrite existing skills
    if (allSkills().some(s => s.name === name)) {
        console.log(`[SkillLibrary] Skill "${name}" already exists, skipping`);
        return false;
    }

    const skill: SkillDef = {
        name,
        description,
        precondition: buildPrecondition(preconditionRules),
        steps,
        learned: true,
        successes: 0,
        failures: 0,
    };

    learnedSkills.push(skill);
    await saveLearnedSkills();
    console.log(`[SkillLibrary] Learned new skill: ${name}`);
    return true;
}

export async function recordOutcome(skillName: string, success: boolean): Promise<void> {
    const skill = allSkills().find(s => s.name === skillName);
    if (!skill) return;

    if (success) skill.successes++;
    else skill.failures++;

    // Persist if it's a learned skill
    if (skill.learned) {
        await saveLearnedSkills();
    }
}

export function getSkillStats(): Array<{ name: string; successes: number; failures: number; rate: number }> {
    return allSkills()
        .filter(s => s.successes + s.failures > 0)
        .map(s => ({
            name: s.name,
            successes: s.successes,
            failures: s.failures,
            rate: s.successes / (s.successes + s.failures),
        }));
}
