# Server API

Base URL: `http://localhost:3001`

## Legacy Endpoints

These endpoints predate the protocol system and are still functional.

### `POST /api/npc/tick`

Stub skill selection (returns idle).

**Request** — `Observation`:
```json
{ "npcId": "ada", "name": "Ada", "position": { "x": 10, "y": 12 },
  "nearbyEntities": [{ "id": "bjorn", "name": "Bjorn", "position": { "x": 11, "y": 12 }, "distance": 1 }],
  "isInConversation": false, "currentSkill": "wander", "recentEvents": ["chose skill: wander"] }
```

**Response** — `SkillSelection`:
```json
{ "skill": "idle", "params": { "duration": 3000 } }
```

### `POST /api/npc/reason`

Dialogue or reasoning via Sonnet (stub wrappers).

**Request** — `ReasoningRequest`:
```json
{ "npcId": "ada", "observation": { ... }, "mode": "dialogue",
  "conversationHistory": [{ "speaker": "Bjorn", "text": "Hello!" }], "partnerName": "Bjorn" }
```

**Response** — `ReasoningResult`:
```json
{ "type": "dialogue", "dialogue": "Hi Bjorn, nice day!" }
```

### `POST /api/npc/failure`

Report failures for self-critique. Returns `{ "status": "accepted" }`.

### `POST /api/npc/skill-outcome`

Report skill success/failure. Body: `{ "skill": "wander", "success": true }`.

### `GET /api/health`

Returns `{ "status": "ok", "queueDepth": 0 }`.

### `GET /api/stats/resources`

Returns aggregate resource stats.

---

## Protocol Endpoints

These endpoints power the protocol-based reasoning system. Each calls Claude via the `ApiQueue` with appropriate priority and model.

### `POST /api/protocol/propose`

Generate a Propose message — decompose a task into sub-tasks.

**Model:** Sonnet (Priority: REASONING)

**Request:**
```json
{
  "npcId": "ada",
  "taskDescription": "gather wood from the forest",
  "worldSummary": "Forest visible to the east at (20, 15). No entities nearby.",
  "memories": ["Trees are at (22, 16)", "Chopping requires an axe"]
}
```

**Response:**
```json
{
  "type": "propose",
  "id": "task_1708700000000",
  "from": "ada",
  "taskDescription": "gather wood from the forest",
  "interpretation": "Travel to the forest and collect wood",
  "subTasks": [
    { "id": "st_1", "description": "travel to forest", "completionCriteria": "at (22, 16)" }
  ],
  "completionCriteria": "wood obtained",
  "rollupLogic": "all sub-tasks done"
}
```

### `POST /api/protocol/dialogue`

Generate a conversational dialogue turn.

**Model:** Sonnet (Priority: DIALOGUE)

**Request:**
```json
{
  "npcId": "ada",
  "partner": "Bjorn",
  "worldSummary": "Village square. Bjorn is 1 tile away.",
  "history": [{ "speaker": "Bjorn", "text": "Good morning!" }],
  "purpose": "ask Bjorn to help gather wood",
  "memories": []
}
```

**Response:**
```json
{
  "dialogue": "Good morning, Bjorn! Could you help me gather some wood?",
  "internalThought": "I should be direct about needing help."
}
```

### `POST /api/protocol/evaluate-proposal`

Evaluate a proposal — approve it or raise a Question.

**Model:** Sonnet (Priority: REASONING)

**Request:**
```json
{
  "npcId": "ada",
  "proposal": {
    "taskDescription": "gather wood",
    "interpretation": "find wood",
    "subTasks": [{ "id": "s1", "description": "chop tree", "completionCriteria": "has wood" }],
    "completionCriteria": "wood obtained",
    "rollupLogic": "all done"
  },
  "worldSummary": "forest nearby",
  "memories": []
}
```

**Response (approved):**
```json
{ "approved": true }
```

**Response (questioned):**
```json
{
  "type": "question",
  "id": "q_1708700000000",
  "from": "ada",
  "kind": "feasibility",
  "concern": "no axe available",
  "evidence": "inventory is empty",
  "tier": "strategic"
}
```

### `POST /api/protocol/revise`

Generate a Revise in response to a Question.

**Model:** Sonnet (Priority: REASONING)

**Request:**
```json
{
  "npcId": "ada",
  "originalProposal": {
    "taskDescription": "gather wood",
    "interpretation": "find wood",
    "subTasks": [{ "id": "s1", "description": "chop", "completionCriteria": "done" }],
    "completionCriteria": "wood obtained"
  },
  "question": {
    "kind": "feasibility",
    "concern": "no axe",
    "evidence": "empty inventory"
  },
  "worldSummary": "forest nearby"
}
```

**Response:**
```json
{
  "type": "revise",
  "id": "rev_1708700000000",
  "from": "ada",
  "originalProposalId": "unknown",
  "triggeredBy": "unknown",
  "revisedSubTasks": [{ "id": "s1", "description": "find axe first", "completionCriteria": "has axe" }],
  "explanation": "need tool first"
}
```

### `POST /api/protocol/remember`

Distill lessons from a completed task.

**Model:** Haiku (Priority: BACKGROUND)

**Request:**
```json
{
  "npcId": "ada",
  "taskContext": "gathered wood in forest",
  "outcome": "success after finding axe"
}
```

**Response:**
```json
{
  "type": "remember",
  "id": "mem_1708700000000",
  "from": "ada",
  "lessons": [
    { "insight": "axes help with wood gathering", "condition": "gathering wood", "confidence": 0.9 }
  ]
}
```