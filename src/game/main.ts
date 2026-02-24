import { Preloader } from './scenes/Preloader';
import { GameScene } from './scenes/GameScene';
import { AUTO, Game } from 'phaser';

export default function StartGame(parent: string) {
    return new Game({
        type: AUTO,
        width: 1024,
        height: 768,
        parent,
        backgroundColor: '#1a1a2e',
        scene: [Preloader, GameScene],
    });
}
