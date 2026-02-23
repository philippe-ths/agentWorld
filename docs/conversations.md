# Conversations

## NPC ↔ NPC

Managed by `ConversationManager.ts` (client-side).

1. An NPC's BehaviorMachine executes a `converse_with` action → dispatches `npc-wants-converse` event.
2. `ConversationManager` pairs initiator with the target NPC; both are marked `isInConversation`.
3. Up to **5 turns** alternate between the two speakers.
4. Each turn calls `POST /api/npc/reason` (dialogue mode, Sonnet) with the conversation history.
5. The speaker's speech bubble is shown for 3.5 s with a 1 s pause between turns.
6. On completion, both NPCs are released and resume normal behaviour.

NPCs already in a conversation are excluded from new ones (`busyNpcs` set).

## Player → NPC

Managed by `ChatController.ts`.

1. Player presses **Enter** → a text input appears at the bottom of the screen.
2. The closest NPC within 2 tiles is selected as the chat target.
3. Player types a message and presses Enter → the message is sent to the NPC's `ProtocolAgent` via `receiveTask(text, 'Player')`.
4. The ProtocolAgent creates a Propose message and routes it through the `ProtocolRouter`, which begins the task decomposition and execution cycle.
5. The NPC acknowledges receipt with a speech bubble.
6. Up to 5 turns are supported per conversation session.
7. **Escape** or empty Enter dismisses the input.

WASD key capture is temporarily released while the input is open so typing works normally.
