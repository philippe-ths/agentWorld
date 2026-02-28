# Conversations

## Overview

NPCs can hold conversations with each other and with the player. Conversations happen outside the normal turn loop — the turn system pauses while a conversation is active and resumes when it ends.

There are three conversation flows:
- **NPC-to-NPC** — initiated by an NPC directive, both sides driven by the LLM, shown via speech bubbles
- **NPC-to-Player** — initiated by an NPC directive targeting "Player", opens the dialogue box so the player can respond
- **Player-to-NPC** — initiated by pressing **Enter** next to an NPC, opens the dialogue box

## NPC-to-NPC Conversations

When an NPC includes `start_conversation_with(Name, message)` in its turn directives, the turn system pauses and hands control to the ConversationManager.

### Flow

```
NPC A emits start_conversation_with(B, opening)
  → Turn system pauses
  → A's speech bubble shows opening message
  → B receives conversation history via LLM (converse prompt)
  → B responds with say(message) or end_conversation()
  → A receives updated history via LLM
  → ...alternate up to 6 total exchanges...
  → Turn system resumes
```

Both NPCs receive their own world state and memory alongside the conversation history when generating each reply.

### Exchange Limit

Conversations cap at **6 exchanges** (`MAX_EXCHANGES`). If neither NPC ends the conversation before that, it closes automatically.

### Speech Bubbles

Each message is displayed as a white rounded-rect bubble above the speaking NPC's sprite. The bubble auto-sizes to fit the text (max 200px wide) and persists for 3 seconds before fading out.

## NPC-to-Player Conversations

If an NPC emits `start_conversation_with(Player, message)`, the system detects that the target is the player and opens the dialogue box instead of running the NPC-to-NPC LLM loop.

The opening message is shown in a speech bubble first, then the dialogue box opens with the message displayed. From there the flow matches the Player-to-NPC flow below.

## Player-to-NPC Conversations

Press **Enter** while adjacent to an NPC to open the dialogue box and start a conversation.

### Flow

```
Player presses Enter next to NPC
  → Turn system pauses
  → Dialogue box opens (titled with NPC name)
  → Player types messages, NPC responds via LLM
  → Player presses Escape or clicks close to end
  → Transcript saved to NPC's chronological log
  → Turn system resumes
```

The NPC receives its world state, memory, and the full conversation history each time it responds. It uses the `CONVERSATION_SYSTEM_PROMPT` — a dedicated prompt that instructs the NPC to be concise, exchange useful information, and end the conversation when it has nothing important to say.

### Dialogue Box

A Phaser container rendered in-canvas with:
- Title bar showing the NPC's name and a **×** close button
- Scrollable message area (NPC messages left-aligned, player messages right-aligned)
- A hidden HTML `<input>` element for text entry, visually integrated at the bottom

Press **Escape** or click **×** to close the dialogue.

## Conversation Directives

### Decision Prompt Commands

These are available to NPCs during their normal turn decision:

| Directive | Description |
|-----------|-------------|
| `start_conversation_with(Name, message)` | Start a conversation with an adjacent entity. Ends the NPC's turn. |
| `end_conversation()` | (Not used in decision context — included for completeness) |

### Conversation Prompt Commands

These are available inside the conversation loop (via `CONVERSATION_SYSTEM_PROMPT`):

| Directive | Description |
|-----------|-------------|
| `say(message)` | Say something to the other party |
| `end_conversation()` | End the conversation |

## Conversation System Prompt

During a conversation, NPCs use a separate prompt from the normal decision prompt:

```
You are an NPC in a conversation with another entity.
Respond in character. Be concise.
The purpose of conversation is to exchange useful information.
Do not make idle small talk. If you have nothing important to say, end the conversation.
Keep your responses to 1-2 sentences.
Do not communicate positions or map features.

Respond with ONE of:
  say(your message here)
  end_conversation()
```

## Validation Rules

Before a conversation starts, ConversationManager validates:
1. No conversation is already active
2. The target entity exists
3. The initiator is not targeting itself
4. The initiator and target are adjacent (within 1 tile in any direction)

Validation failures are logged as warnings and the directive is skipped.

## Turn System Integration

- `start_conversation_with` **always ends the NPC's turn** — any remaining directives in that turn are discarded
- The turn loop pauses via `pauseForConversation()` and resumes via `resumeFromConversation()` when the conversation finishes
- NPC movement is gated during conversations — `NPC.walkToAsync()` checks a pause gate before each step
- The player pressing **Enter** also pauses the turn loop for the duration of the dialogue

## Transcript Logging

Conversation transcripts are appended to the NPC's chronological log file:

```markdown
### Conversation with Bjorn (Turn 4 at 15,10)
Initiated by: Ada
- Ada: I noticed something interesting at the eastern pond
- Bjorn: What did you see there?
- Ada: The water level seems to have changed
Ended by: Bjorn
```

For NPC-to-NPC conversations, both NPCs get the transcript in their logs. For player conversations, only the NPC's log is updated.

## Key Files

| File | Role |
|------|------|
| `src/game/ConversationManager.ts` | Core orchestrator — validation, session lifecycle, NPC-NPC / Player-NPC flows |
| `src/game/ui/SpeechBubble.ts` | NPC speech bubble rendering and timed display |
| `src/game/ui/DialogueBox.ts` | Player dialogue panel with text input |
| `src/game/LLMService.ts` | `converse()` method and `CONVERSATION_SYSTEM_PROMPT` |
| `src/game/DirectiveParser.ts` | Parses `start_conversation_with` and `end_conversation` directives |
| `src/game/TurnManager.ts` | Conversation pause/resume, player interrupt entry point |
