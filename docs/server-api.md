# Server API

Base URL: `http://localhost:3001`

## Endpoints

### `POST /api/npc/tick`

Medium-loop skill selection.

**Request** — `Observation`:
```json
{ "npcId": "ada", "name": "Ada", "position": { "x": 10, "y": 12 },
  "nearbyEntities": [{ "id": "bjorn", "name": "Bjorn", "position": { "x": 11, "y": 12 }, "distance": 1 }],
  "isInConversation": false, "currentSkill": "wander", "recentEvents": ["chose skill: wander"] }
```

**Response** — `SkillSelection`:
```json
{ "skill": "approach_entity", "params": { "entityName": "Bjorn" }, "escalate": false }
```

### `POST /api/npc/reason`

Slow-loop reasoning or dialogue.

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

Returns `{ "status": "ok" }`.
