import { Scene } from 'phaser';
import { Entity, TilePos } from './Entity';

export class Player extends Entity {
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
    private _isTurn = false;
    private _onAction: ((moved: boolean) => void) | null = null;

    constructor(
        scene: Scene,
        map: Phaser.Tilemaps.Tilemap,
        startTile: TilePos,
        checkWalkable: (x: number, y: number) => boolean,
    ) {
        super(scene, map, 'player', startTile, checkWalkable, 'Player');
        this.cursors = scene.input.keyboard!.createCursorKeys();
        this.wasd = scene.input.keyboard!.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    }

    /** Called by TurnManager — resolves after the player presses a direction key and the move animation finishes. */
    awaitAction(): Promise<boolean> {
        this._isTurn = true;
        return new Promise(resolve => {
            this._onAction = resolve;
        });
    }

    update(_time: number, _delta: number) {
        if (!this._isTurn || this.isMoving || !this._onAction) return;

        let dx = 0;
        let dy = 0;

        const up = Phaser.Input.Keyboard.JustDown(this.cursors.up) || Phaser.Input.Keyboard.JustDown(this.wasd['W']);
        const down = Phaser.Input.Keyboard.JustDown(this.cursors.down) || Phaser.Input.Keyboard.JustDown(this.wasd['S']);
        const left = Phaser.Input.Keyboard.JustDown(this.cursors.left) || Phaser.Input.Keyboard.JustDown(this.wasd['A']);
        const right = Phaser.Input.Keyboard.JustDown(this.cursors.right) || Phaser.Input.Keyboard.JustDown(this.wasd['D']);

        if (up) { dy = -1; }
        else if (down) { dy = 1; }
        else if (left) { dx = -1; }
        else if (right) { dx = 1; }

        if (dx === 0 && dy === 0) return;

        const callback = this._onAction;
        this._isTurn = false;
        this._onAction = null;
        this.moveToAsync(dx, dy).then(callback);
    }
}
