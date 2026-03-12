import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMService } from './LLMService';

describe('LLMService', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('includes reflection in decision prompt messages when provided', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ text: 'wait()' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const service = new LLMService();
        await service.decide('Ada', 'WORLD STATE', 'MEMORY', 'GOALS', 'REFLECTION');

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.messages.map((message: { content: string }) => message.content)).toContain('YOUR REFLECTION:\nREFLECTION');
    });

    it('includes output guard correction feedback when reprompting', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ text: 'wait()' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const service = new LLMService();
        await service.decide(
            'Ada',
            'WORLD STATE',
            'MEMORY',
            'GOALS',
            'REFLECTION',
            'Your previous output failed strict validation.',
        );

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.messages.map((message: { content: string }) => message.content)).toContain(
            'OUTPUT FORMAT CORRECTION:\nYour previous output failed strict validation.',
        );
    });

    it('includes reflection in conversation prompt messages when provided', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ text: 'say(hello)' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const service = new LLMService();
        await service.converse(
            'Bjorn',
            'WORLD STATE',
            'MEMORY',
            [{ speaker: 'Ada', text: 'Hello' }],
            'REFLECTION',
        );

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.messages.map((message: { content: string }) => message.content)).toContain('YOUR REFLECTION:\nREFLECTION');
    });
});