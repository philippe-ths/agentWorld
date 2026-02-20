import type { EntityManager } from '../entities/EntityManager';
import type { NPC } from '../entities/NPC';

const NPC_SPAWNS: Record<string, { x: number; y: number }> = {
    ada: { x: 15, y: 10 },
    bjorn: { x: 25, y: 20 },
    cora: { x: 10, y: 25 },
};

export class ControlBar {
    constructor(entityManager: EntityManager) {
        const btnPlay = document.getElementById('btn-play')!;
        const btnPause = document.getElementById('btn-pause')!;
        const btnRestart = document.getElementById('btn-restart')!;

        const getNPCs = (): NPC[] =>
            entityManager.getAll().filter(e => 'id' in e) as NPC[];

        btnPlay.classList.add('active');

        btnPlay.addEventListener('click', () => {
            getNPCs().forEach(npc => npc.resumeAI());
            btnPlay.classList.add('active');
            btnPause.classList.remove('active');
        });

        btnPause.addEventListener('click', () => {
            getNPCs().forEach(npc => npc.pauseAI());
            btnPause.classList.add('active');
            btnPlay.classList.remove('active');
        });

        btnRestart.addEventListener('click', () => {
            getNPCs().forEach(npc => {
                const spawn = NPC_SPAWNS[npc.id];
                if (spawn) npc.restartAI(spawn);
            });
            btnPlay.classList.add('active');
            btnPause.classList.remove('active');
        });
    }
}
