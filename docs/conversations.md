# Conversations

## NPC ↔ NPC

Managed by `ConversationManager.ts` (client-side).

1. Medium loop selects `converse` → dispatches `npc-wants-converse` event.
2. `ConversationManager` pairs initiator with nearest NPC; both are marked `isInConversation`.
3. Up to **5 turns** alternate between the two speakers.
4. Each turn calls `POST /api/npc/reason` (dialogue mode, Sonnet) with the conversation history.
5. The speaker's speech bubble is shown for 3.5 s with a 1 s pause between turns.
6. On completion, both NPCs are released and resume normal behaviour.

NPCs already in a conversation are excluded from new ones (`busyNpcs` set).

## Player → NPC

Managed by `ChatController.ts`.

1. Player presses **Enter** → a text input appears at the bottom of the screen.
2. The closest NPC within 5 tiles is selected as the chat target.
3. Player types a message and presses Enter → message is sent to `POST /api/npc/reason` (dialogue mode).
4. The NPC replies via speech bubble; the exchange is logged.
5. **Escape** or a second Enter dismisses the input.

WASD key capture is temporarily released while the input is open so typing works normally.
