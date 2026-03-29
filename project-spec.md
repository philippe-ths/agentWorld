# Project Spec

## Product Summary
- Agent World is an isometric Phaser 3 game where three NPCs make autonomous decisions driven by Anthropic Claude, creating emergent behaviour through persistent memory, conversations, goals, and runtime code generation.
- The primary users are developers and researchers exploring LLM-driven agent behaviour in a game environment.
- The core flow is a sequential NPC turn loop where each NPC receives world state and memory context, Claude decides actions, and the game executes those actions with full state persistence.

## Domain Concepts
- An **Entity** is a sprite-based game object with a tile position, name label, and sleep visual state.
- A **Player** is a keyboard-driven Entity that moves freely outside the turn system.
- An **NPC** (Ada, Bjorn, Cora) is an LLM-driven Entity that acts during its turn via directives parsed from Claude's response.
- A **Directive** is a parsed command from the LLM output (move_to, wait, start_conversation_with, end_conversation, complete_goal, abandon_goal, switch_goal, use_tool, sleep, create_function, update_function, delete_function, or unknown).
- A **ChronologicalLog** is a per-NPC markdown file of observations and actions that auto-summarises old turns via LLM.
- A **Goal** has a source, description, plan, and status (active or pending) with automatic promotion when the active goal completes or is abandoned.
- A **Reflection** is a per-NPC state tracking obstacles, strategies, confidence, and lessons learned, refreshed periodically or on trigger events.
- A **Conversation** is a multi-turn dialogue session between two adjacent entities (NPC-NPC or Player-NPC) with a 6-exchange maximum.
- A **ToolBuilding** is a map object (Search Terminal or Code Forge) that NPCs visit to use tools via the use_tool directive.
- A **FunctionRecord** is an NPC-created executable function (name, description, parameters, code, tile, creator) stored as JSON and registered as a dynamic tool building.
- A **WorldState** is a text serialisation of the game from an NPC's perspective, including a character grid, adjacency info, and tool positions.
- The **TurnManager** cycles through NPCs sequentially (Ada → Bjorn → Cora), executing the full per-turn pipeline for each.
- NPCs interact with tools by walking to a ToolBuilding and issuing use_tool or create/update/delete_function directives.
- Goals are extracted from conversation transcripts by the GoalExtractor and managed by the GoalManager.
- Reflections are triggered by goal changes, repeated failures, unknown directive floods, or output format failures.

## Scope
- Three fixed NPCs (Ada, Bjorn, Cora) take sequential turns with up to 3 action directives per turn.
- NPCs navigate a seeded 30×30 tile map using A* pathfinding with optimistic re-routing (up to 5 re-paths on collision).
- NPCs converse with each other and the player, with transcripts logged to both participants' chronological logs.
- NPCs extract and track goals from conversations with active/pending lifecycle and auto-promotion.
- NPCs generate, update, and delete executable functions via Code Forge, screened for capability and sandboxed in Node VM with a 1-second timeout.
- NPCs search the web via the Search Terminal tool backed by the Tavily API.
- NPCs enter sleep mode for 10 turns and wake on conversation.
- A headless evaluation system runs scenarios from the CLI without a browser to test NPC behaviour.
- Six feature flags (conversations, goals, reflection, logSummarization, functionBuilding, searchTerminal) control runtime capabilities with cascade dependencies.
- There is no combat, inventory, multiplayer, save/load of full game state, audio, or dynamic NPC spawning.
- Generated functions are restricted to pure synchronous computation with no network, filesystem, database, or external API access.

## Important Constraints
- Seven LLM call types have fixed model assignments and token budgets: DECISION (Opus, 320), CONVERSATION (Opus, 512), SUMMARIZE (Haiku, 384), GOAL_EXTRACTION (Sonnet, 256), CODE_GENERATION (Sonnet, 512), REFLECTION (Sonnet, 256), LESSON_LEARNED (Sonnet, 128).
- The anthropic proxy applies a model fallback chain (Sonnet 4.6 → Sonnet 4.5 → Opus 4.6) and retries transient errors (429, 500, 502, 503, 529) up to 3 times with exponential backoff.
- ANTHROPIC_API_KEY is required in `.env`; TAVILY_API_KEY is optional.
- All NPC state (logs, goals, reflections) persists to markdown files in `data/logs/`; functions persist to JSON files in `data/functions/`.
- The directive parser attempts repair and strict validation before reprompting once; on second failure it falls back to wait() and records an output-format failure.
- Conversation participants must be adjacent (within 1 tile) and conversations are capped at 6 exchanges.
- Feature flag cascades: disabling conversations disables goals; disabling goals disables reflection.
- The chronological log budget is 4000 characters per prompt context, with summarisation every 5 turns.
- Reflection refreshes every 5 turns or on trigger events (goal changes, repeated failures, unknown directives).
- Function sandbox allows only Math, String, Array, Object, JSON, Number, Date, RegExp, Map, Set, and basic parsing globals.
- The evaluation system resets all persisted NPC state before each scenario run.
- The map uses a seeded PRNG (seed 42) producing 3–5 organic water ponds on grass terrain.

## Architecture Summary
- The application is a client-side Phaser 3 game served by Vite, with server-side Vite plugins acting as API proxies and file I/O endpoints during development.
- The main runtime layers are: Phaser scenes (rendering, input) → game systems (TurnManager, ConversationManager, GoalManager, ReflectionManager) → LLMService (API calls) → Vite plugin endpoints (proxy, persistence).
- The primary data flow per NPC turn is: load persisted state → build world state and prompt → POST to /api/chat → parse directives → execute actions → persist updated state.
- External service boundaries are the Anthropic Claude API (via /api/chat proxy) and the Tavily Search API (via /api/search proxy).
- A parallel headless evaluation system replicates the turn loop in Node.js without Phaser, using HeadlessEntity, HeadlessEntityManager, and HeadlessDirectiveExecutor.
- Production builds are static HTML+JS bundles with no server-side components.

## Key Dependencies
- `phaser` (v3.90.0): Game engine providing isometric rendering, sprites, tweens, tilemaps, and input handling.
- `@anthropic-ai/sdk` (v0.78.0): Claude API client used by the anthropic proxy plugin for all LLM calls.
- `vite` (v6.3.1): Bundler and dev server, hosting custom plugins for API proxying and file I/O.
- `vitest` (v4.0.18): Unit test runner for game system tests.
- `tsx` (v4.21.0): TypeScript execution for Node.js, used by the headless evaluation CLI.
- `typescript` (~5.7.2): TypeScript compiler.
- `terser` (v5.39.0): JavaScript minifier for production builds.

## Project Structure
- `src/main.ts`: Browser entry point that starts the Phaser game.
- `src/game/main.ts`: Phaser configuration and StartGame() export.
- `src/game/scenes/`: Preloader (sprite loading, texture generation) and GameScene (tilemap, entities, systems, function audit).
- `src/game/entities/`: Entity base class, Player (keyboard-driven), NPC (LLM-driven with optimistic pathfinding), EntityManager (storage, updates, walkability).
- `src/game/TurnManager.ts`: Sequential NPC turn loop with sleep, pause/resume, and per-turn pipeline orchestration.
- `src/game/DirectiveParser.ts`: Parses LLM output into directives with repair, validation, and reprompt logic.
- `src/game/DirectiveExecutor.ts`: Executes parsed directives (movement, tools, goals, sleep, conversations).
- `src/game/prompts.ts`: Seven LLM call configurations with model, token budget, and system prompt builders.
- `src/game/LLMService.ts`: Fetch wrapper for all LLM API calls.
- `src/game/ConversationManager.ts`: NPC-NPC and Player-NPC dialogue orchestration with exchange limits.
- `src/game/ChronologicalLog.ts`: Per-NPC log recording, serialisation, and LLM-driven summarisation.
- `src/game/GoalManager.ts` + `src/game/GoalExtractor.ts`: Goal tracking (active/pending lifecycle) and extraction from conversation transcripts.
- `src/game/ReflectionManager.ts`: Per-NPC reflection state with periodic and trigger-based refresh.
- `src/game/ToolRegistry.ts` + `src/game/ToolService.ts`: Tool building registry and service (web search, code generation, sandboxed execution, function CRUD).
- `src/game/FunctionBuilderService.ts` + `src/game/FunctionCapability.ts`: Code Forge validation, capability screening, and function registration.
- `src/game/MapData.ts` + `src/game/Pathfinder.ts`: Seeded 30×30 map generation and A* pathfinding.
- `src/game/WorldState.ts`: Serialises game state into text for LLM prompt context.
- `src/game/GameConfig.ts`: All constants, NPC definitions, building definitions, feature flags, and tuning parameters.
- `src/eval/`: Headless evaluation system (CLI, HeadlessTurnLoop, HeadlessEntity, HeadlessEntityManager, HeadlessConversationManager, HeadlessDirectiveExecutor, AbortMonitor, ResultWriter, resetState).
- `src/eval/scenarios/`: Declarative test scenarios (scenario-one: navigation, scenario-gather: cooperation).
- `vite/`: Vite plugin files for API proxying (anthropic-proxy, search-proxy), file I/O (log-io, functions-io), code execution (code-executor), and shared utilities.
- `data/logs/`: Persisted NPC chronological logs, goals, and reflections as markdown files.
- `data/functions/`: Persisted NPC-created functions as JSON files.
- `data/test-results/`: Evaluation scenario result JSON files.
- `doc/`: Architecture documentation (overview, architecture, turn-system, conversations, evaluation, llm-integration).

## Testing Overview
- Vitest runs 8 unit test files covering ChronologicalLog, DirectiveParser, FunctionBuilderService, FunctionCapability, GoalExtractor, LLMService, PersistedFunctionAudit, and ReflectionManager.
- The headless evaluation system provides integration-level testing via declarative scenarios run from the CLI (scenario-one for navigation, scenario-gather for multi-NPC cooperation).
- Major testing gaps include no unit tests for TurnManager, ConversationManager, DirectiveExecutor, GoalManager, WorldState, MapData, Pathfinder, ToolRegistry, or ToolService.

## Maintenance Checklist
- Update this file when LLM call types, token budgets, or model assignments change.
- Update this file when feature flags, cascade rules, or tuning parameters change.
- Update this file when new directives, tools, or scenarios are added.
- Update this file when the project structure or key dependencies change.
- Keep this file aligned with the current codebase, not planned architecture.
- Keep this file concise and factual.
