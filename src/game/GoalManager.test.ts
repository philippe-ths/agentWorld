import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoalManager, Goal } from './GoalManager';

function makeGoal(overrides: Partial<Goal> = {}): Goal {
    return {
        source: 'Conversation with Bjorn',
        goal: 'Inspect the pond',
        status: 'active',
        plan: 'Walk to the pond and look around',
        success: 'I know what is at the pond',
        ...overrides,
    };
}

describe('GoalManager', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    // --- Initial state ---

    it('starts with no active or pending goal', () => {
        const gm = new GoalManager('Ada');
        expect(gm.getActiveGoal()).toBeNull();
        expect(gm.getPendingGoal()).toBeNull();
    });

    // --- setActiveGoal / setPendingGoal ---

    it('setActiveGoal stores a goal with status forced to active', () => {
        const gm = new GoalManager('Ada');
        gm.setActiveGoal(makeGoal({ status: 'pending' }));
        const active = gm.getActiveGoal();
        expect(active).not.toBeNull();
        expect(active!.status).toBe('active');
        expect(active!.goal).toBe('Inspect the pond');
    });

    it('setPendingGoal stores a goal with status forced to pending', () => {
        const gm = new GoalManager('Ada');
        gm.setPendingGoal(makeGoal({ status: 'active' }));
        const pending = gm.getPendingGoal();
        expect(pending).not.toBeNull();
        expect(pending!.status).toBe('pending');
    });

    it('setActiveGoal does not mutate the original goal object', () => {
        const gm = new GoalManager('Ada');
        const original = makeGoal({ status: 'pending' });
        gm.setActiveGoal(original);
        expect(original.status).toBe('pending');
    });

    // --- completeGoal ---

    it('completeGoal returns null when there is no active goal', () => {
        const gm = new GoalManager('Ada');
        expect(gm.completeGoal()).toBeNull();
    });

    it('completeGoal clears the active goal and returns its description', () => {
        const gm = new GoalManager('Ada');
        gm.setActiveGoal(makeGoal());
        const result = gm.completeGoal();
        expect(result).toEqual({ completed: 'Inspect the pond', promoted: null });
        expect(gm.getActiveGoal()).toBeNull();
    });

    it('completeGoal promotes the pending goal to active', () => {
        const gm = new GoalManager('Ada');
        gm.setActiveGoal(makeGoal());
        gm.setPendingGoal(makeGoal({ goal: 'Explore the workshop', source: 'Self' }));
        const result = gm.completeGoal();
        expect(result!.completed).toBe('Inspect the pond');
        expect(result!.promoted).not.toBeNull();
        expect(result!.promoted!.status).toBe('active');
        expect(result!.promoted!.goal).toBe('Explore the workshop');
        expect(gm.getActiveGoal()!.goal).toBe('Explore the workshop');
        expect(gm.getPendingGoal()).toBeNull();
    });

    // --- abandonGoal ---

    it('abandonGoal returns null when there is no active goal', () => {
        const gm = new GoalManager('Ada');
        expect(gm.abandonGoal()).toBeNull();
    });

    it('abandonGoal clears the active goal and returns its description', () => {
        const gm = new GoalManager('Ada');
        gm.setActiveGoal(makeGoal());
        const result = gm.abandonGoal();
        expect(result).toEqual({ abandoned: 'Inspect the pond', promoted: null });
        expect(gm.getActiveGoal()).toBeNull();
    });

    it('abandonGoal promotes the pending goal to active', () => {
        const gm = new GoalManager('Ada');
        gm.setActiveGoal(makeGoal());
        gm.setPendingGoal(makeGoal({ goal: 'Visit the forge', source: 'Cora' }));
        const result = gm.abandonGoal();
        expect(result!.abandoned).toBe('Inspect the pond');
        expect(result!.promoted!.goal).toBe('Visit the forge');
        expect(result!.promoted!.status).toBe('active');
        expect(gm.getPendingGoal()).toBeNull();
    });

    // --- switchGoal ---

    it('switchGoal returns null when there is no active goal', () => {
        const gm = new GoalManager('Ada');
        gm.setPendingGoal(makeGoal());
        expect(gm.switchGoal()).toBeNull();
    });

    it('switchGoal returns null when there is no pending goal', () => {
        const gm = new GoalManager('Ada');
        gm.setActiveGoal(makeGoal());
        expect(gm.switchGoal()).toBeNull();
    });

    it('switchGoal moves pending to active and clears pending', () => {
        const gm = new GoalManager('Ada');
        gm.setActiveGoal(makeGoal({ goal: 'Old goal' }));
        gm.setPendingGoal(makeGoal({ goal: 'New goal' }));
        const result = gm.switchGoal();
        expect(result!.abandoned).toBe('Old goal');
        expect(result!.newGoal.goal).toBe('New goal');
        expect(result!.newGoal.status).toBe('active');
        expect(gm.getActiveGoal()!.goal).toBe('New goal');
        expect(gm.getPendingGoal()).toBeNull();
    });

    // --- buildPromptContent ---

    it('buildPromptContent returns empty string with no goals', () => {
        const gm = new GoalManager('Ada');
        expect(gm.buildPromptContent()).toBe('');
    });

    it('buildPromptContent serializes active goal only', () => {
        const gm = new GoalManager('Ada');
        gm.setActiveGoal(makeGoal());
        const content = gm.buildPromptContent();
        expect(content).toContain('## Active Goal');
        expect(content).toContain('Goal: Inspect the pond');
        expect(content).not.toContain('## Pending Goal');
    });

    it('buildPromptContent serializes both active and pending goals', () => {
        const gm = new GoalManager('Ada');
        gm.setActiveGoal(makeGoal());
        gm.setPendingGoal(makeGoal({ goal: 'Check the forge' }));
        const content = gm.buildPromptContent();
        expect(content).toContain('## Active Goal');
        expect(content).toContain('## Pending Goal');
        expect(content).toContain('Goal: Check the forge');
    });

    // --- save ---

    it('save POSTs serialized goals to the correct endpoint', async () => {
        const gm = new GoalManager('Bjorn');
        gm.setActiveGoal(makeGoal());

        let capturedUrl = '';
        let capturedBody = '';
        const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
            capturedUrl = input;
            capturedBody = String(init?.body ?? '');
            return { ok: true, json: async () => ({}) };
        });
        vi.stubGlobal('fetch', fetchMock);

        await gm.save();

        expect(capturedUrl).toBe('/api/goals/Bjorn');
        const parsed = JSON.parse(capturedBody) as { content: string };
        expect(parsed.content).toContain('## Active Goal');
        expect(parsed.content).toContain('Goal: Inspect the pond');
    });

    // --- load ---

    it('load parses active and pending goals from markdown', async () => {
        const markdown = [
            '## Active Goal',
            'Source: Bjorn',
            'Goal: Inspect the pond',
            'Status: active',
            'Plan: Walk there',
            'Success: Saw the pond',
            '',
            '## Pending Goal',
            'Source: Cora',
            'Goal: Visit the forge',
            'Status: pending',
            'Plan: Head to the forge',
            'Success: Arrived at the forge',
        ].join('\n');

        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({ content: markdown }),
        })));

        const gm = new GoalManager('Ada');
        await gm.load();

        expect(gm.getActiveGoal()).toEqual({
            source: 'Bjorn',
            goal: 'Inspect the pond',
            status: 'active',
            plan: 'Walk there',
            success: 'Saw the pond',
        });
        expect(gm.getPendingGoal()).toEqual({
            source: 'Cora',
            goal: 'Visit the forge',
            status: 'pending',
            plan: 'Head to the forge',
            success: 'Arrived at the forge',
        });
    });

    it('load handles empty content gracefully', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({ content: '' }),
        })));

        const gm = new GoalManager('Ada');
        await gm.load();
        expect(gm.getActiveGoal()).toBeNull();
        expect(gm.getPendingGoal()).toBeNull();
    });

    it('load handles fetch failure gracefully', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network error'); }));

        const gm = new GoalManager('Ada');
        await gm.load();
        expect(gm.getActiveGoal()).toBeNull();
        expect(gm.getPendingGoal()).toBeNull();
    });

    it('load handles non-ok response gracefully', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 404,
        })));

        const gm = new GoalManager('Ada');
        await gm.load();
        expect(gm.getActiveGoal()).toBeNull();
        expect(gm.getPendingGoal()).toBeNull();
    });

    it('load clears previous goals before parsing', async () => {
        const gm = new GoalManager('Ada');
        gm.setActiveGoal(makeGoal());
        gm.setPendingGoal(makeGoal({ goal: 'Stale goal' }));

        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({ content: '' }),
        })));

        await gm.load();
        expect(gm.getActiveGoal()).toBeNull();
        expect(gm.getPendingGoal()).toBeNull();
    });

    // --- Serialization roundtrip ---

    it('save then load roundtrip preserves goal data', async () => {
        const active = makeGoal();
        const pending = makeGoal({ goal: 'Build a tool', source: 'Self', status: 'pending' });

        const gm1 = new GoalManager('Ada');
        gm1.setActiveGoal(active);
        gm1.setPendingGoal(pending);

        let savedContent = '';
        const saveFetch = vi.fn(async (_input: string, init?: RequestInit) => {
            savedContent = (JSON.parse(String(init?.body ?? '{}')) as { content: string }).content;
            return { ok: true, json: async () => ({}) };
        });
        vi.stubGlobal('fetch', saveFetch);
        await gm1.save();

        const loadFetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ content: savedContent }),
        }));
        vi.stubGlobal('fetch', loadFetch);

        const gm2 = new GoalManager('Ada');
        await gm2.load();

        expect(gm2.getActiveGoal()).toEqual({ ...active, status: 'active' });
        expect(gm2.getPendingGoal()).toEqual({ ...pending, status: 'pending' });
    });
});
