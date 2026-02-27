import { Scene } from 'phaser';

const BOX_HEIGHT = 200;
const BOX_MARGIN = 16;
const INPUT_HEIGHT = 32;
const MESSAGE_AREA_PAD = 12;

export class DialogueBox {
    private container: Phaser.GameObjects.Container;
    private bg: Phaser.GameObjects.Graphics;
    private titleText: Phaser.GameObjects.Text;
    private messagesText: Phaser.GameObjects.Text;
    private inputBg: Phaser.GameObjects.Graphics;
    private inputDisplay: Phaser.GameObjects.Text;
    private closeHint: Phaser.GameObjects.Text;
    private htmlInput: HTMLInputElement;
    private messages: string[] = [];
    private onSubmitCallback: ((text: string) => void) | null = null;
    private onCloseCallback: (() => void) | null = null;
    private escKey: Phaser.Input.Keyboard.Key;
    private visible = false;

    constructor(scene: Scene) {
        const cam = scene.cameras.main;
        const boxW = cam.width - BOX_MARGIN * 2;
        const boxX = BOX_MARGIN;
        const boxY = cam.height - BOX_HEIGHT - BOX_MARGIN;

        // Background panel
        this.bg = scene.add.graphics();
        this.bg.fillStyle(0x1a1a2e, 0.92);
        this.bg.lineStyle(1, 0x6bc5ff, 0.6);
        this.bg.fillRoundedRect(0, 0, boxW, BOX_HEIGHT, 8);
        this.bg.strokeRoundedRect(0, 0, boxW, BOX_HEIGHT, 8);

        // Title
        this.titleText = scene.add.text(MESSAGE_AREA_PAD, 8, '', {
            fontSize: '13px',
            color: '#6bc5ff',
            fontFamily: 'Arial, sans-serif',
            fontStyle: 'bold',
        });

        // Messages area
        const messagesAreaWidth = boxW - MESSAGE_AREA_PAD * 2;
        this.messagesText = scene.add.text(MESSAGE_AREA_PAD, 28, '', {
            fontSize: '12px',
            color: '#e0e0e0',
            fontFamily: 'Arial, sans-serif',
            wordWrap: { width: messagesAreaWidth },
            lineSpacing: 4,
        });

        // Input area background
        this.inputBg = scene.add.graphics();
        const inputY = BOX_HEIGHT - INPUT_HEIGHT - 8;
        this.inputBg.fillStyle(0x0d0d1a, 0.8);
        this.inputBg.fillRoundedRect(MESSAGE_AREA_PAD, inputY, messagesAreaWidth - 60, INPUT_HEIGHT, 4);

        // Input display text (mirrors the hidden HTML input)
        this.inputDisplay = scene.add.text(MESSAGE_AREA_PAD + 8, inputY + 8, 'Type a message...', {
            fontSize: '12px',
            color: '#888888',
            fontFamily: 'Arial, sans-serif',
        });

        // Close hint
        this.closeHint = scene.add.text(messagesAreaWidth - 40, inputY + 8, '[ESC] Close', {
            fontSize: '10px',
            color: '#888888',
            fontFamily: 'Arial, sans-serif',
        });

        this.container = scene.add.container(boxX, boxY, [
            this.bg,
            this.titleText,
            this.messagesText,
            this.inputBg,
            this.inputDisplay,
            this.closeHint,
        ]);
        this.container.setScrollFactor(0);
        this.container.setDepth(3000);
        this.container.setVisible(false);

        // Hidden HTML input for text capture
        this.htmlInput = document.createElement('input');
        this.htmlInput.type = 'text';
        this.htmlInput.style.position = 'absolute';
        this.htmlInput.style.opacity = '0';
        this.htmlInput.style.pointerEvents = 'none';
        this.htmlInput.style.left = '-9999px';
        this.htmlInput.maxLength = 200;
        document.body.appendChild(this.htmlInput);

        this.htmlInput.addEventListener('input', () => {
            const val = this.htmlInput.value;
            this.inputDisplay.setText(val || 'Type a message...');
            this.inputDisplay.setColor(val ? '#ffffff' : '#888888');
        });

        this.htmlInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && this.htmlInput.value.trim()) {
                e.preventDefault();
                const text = this.htmlInput.value.trim();
                this.htmlInput.value = '';
                this.inputDisplay.setText('Type a message...');
                this.inputDisplay.setColor('#888888');
                if (this.onSubmitCallback) this.onSubmitCallback(text);
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
            }
            // Stop propagation so game keys don't fire
            e.stopPropagation();
        });

        // ESC key in Phaser as backup
        this.escKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
        this.escKey.on('down', () => {
            if (this.visible) this.close();
        });
    }

    open(targetName: string): void {
        this.visible = true;
        this.messages = [];
        this.titleText.setText(`Conversation with ${targetName}`);
        this.messagesText.setText('');
        this.htmlInput.value = '';
        this.inputDisplay.setText('Type a message...');
        this.inputDisplay.setColor('#888888');
        this.container.setVisible(true);
        // Focus after a tick so the key event that opened the dialog doesn't fire
        setTimeout(() => this.htmlInput.focus(), 50);
    }

    close(): void {
        if (!this.visible) return;
        this.visible = false;
        this.container.setVisible(false);
        this.htmlInput.blur();
        if (this.onCloseCallback) this.onCloseCallback();
    }

    addMessage(speaker: string, text: string): void {
        this.messages.push(`${speaker}: ${text}`);
        // Keep only last ~8 messages visible
        const visible = this.messages.slice(-8);
        this.messagesText.setText(visible.join('\n'));
    }

    onSubmit(callback: (text: string) => void): void {
        this.onSubmitCallback = callback;
    }

    onClose(callback: () => void): void {
        this.onCloseCallback = callback;
    }

    isOpen(): boolean {
        return this.visible;
    }

    destroy(): void {
        this.container.destroy();
        this.htmlInput.remove();
    }
}
