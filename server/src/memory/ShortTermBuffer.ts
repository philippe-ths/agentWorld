import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');

export interface ShortTermEntry {
    timestamp: number;
    position: { x: number; y: number };
    nearbyEntities: string[];
    event: string;
}

const buffers = new Map<string, ShortTermEntry[]>();
const MAX_BUFFER = 50;

async function ensureDataDir() {
    if (!existsSync(DATA_DIR)) {
        await mkdir(DATA_DIR, { recursive: true });
    }
}

function bufferFile(npcId: string): string {
    const safe = npcId.replace(/[^a-z0-9_-]/gi, '_');
    return path.join(DATA_DIR, `${safe}_buffer.json`);
}

async function loadFromDisk(npcId: string): Promise<ShortTermEntry[]> {
    await ensureDataDir();
    const file = bufferFile(npcId);
    if (!existsSync(file)) return [];
    const data = await readFile(file, 'utf-8');
    return JSON.parse(data) as ShortTermEntry[];
}

async function saveToDisk(npcId: string, entries: ShortTermEntry[]) {
    await ensureDataDir();
    await writeFile(bufferFile(npcId), JSON.stringify(entries));
}

export async function initBuffer(npcId: string) {
    if (!buffers.has(npcId)) {
        const stored = await loadFromDisk(npcId);
        buffers.set(npcId, stored);
    }
}

export function addObservation(npcId: string, entry: ShortTermEntry) {
    if (!buffers.has(npcId)) buffers.set(npcId, []);
    const buf = buffers.get(npcId)!;
    buf.push(entry);
    if (buf.length > MAX_BUFFER) buf.shift();
    // Async persist — fire and forget
    saveToDisk(npcId, buf).catch(() => {});
}

export function getRecent(npcId: string, n = 10): ShortTermEntry[] {
    const buf = buffers.get(npcId) ?? [];
    return buf.slice(-n);
}

export function getAll(npcId: string): ShortTermEntry[] {
    return buffers.get(npcId) ?? [];
}

export function clear(npcId: string) {
    buffers.set(npcId, []);
    saveToDisk(npcId, []).catch(() => {});
}
