# Protocol Primitives for Collective Reasoning

## Foundation

This protocol defines the fundamental operations available to a group of independent reasoning agents collaborating to solve arbitrary problems. No operation is specific to any problem domain. The protocol assumes nothing about what the problem is — only that it can be reasoned about, decomposed, attempted, and verified.

Each agent is autonomous. There is no central coordinator. Any agent can invoke any primitive at any time. Leadership for a given task is emergent — it belongs to whoever proposed the approach that others accepted, and it can shift if someone proposes a better one.

---

## Intelligence Tiers

Every invocation of a primitive has a cost. The protocol recognises three tiers of intelligence, and each primitive invocation should use the cheapest tier capable of handling it.

**Strategic.** Handles ambiguity, novelty, and judgment. Used for understanding new problems, generating decompositions, debating approaches, and revising plans when something unexpected happens. Expensive. Invoked rarely and for high-leverage decisions.

**Tactical.** Handles well-scoped tasks where ambiguity has been removed by the strategic tier. Interprets concrete instructions, makes small decisions within clear constraints, generates simple communications. Cheap. Invoked frequently.

**Mechanical.** Handles deterministic operations. Movement, state checks, timer management, memory lookups, distance calculations, verifying completion criteria that have been reduced to checkable conditions. Free. Runs continuously.

The fundamental design principle: **each tier's primary job is to reduce complexity so the tier below it can operate.** Strategy removes ambiguity so tactics can work. Tactics reduces decisions to actions so execution can work. If a tier is struggling, the problem hasn't been sufficiently simplified by the tier above it.

---

## Context Management

Context is a finite resource. Every reasoning invocation (strategic or tactical) operates within a limited window of attention. What enters that window determines the quality of the output. Context management is therefore not a utility — it is a core part of the protocol that runs at every transition between agents and between tiers.

### Briefing

Constructed before any reasoning invocation. Assembles only what is relevant to the specific question being asked, drawn from:

- The agent's own memory (distilled lessons, not raw logs)
- Current world state (what the agent can perceive right now)
- The specific task or question at hand
- Relevant context from other agents (received via Handoff or Report)

A good briefing is the difference between dumping everything the agent has ever seen into the prompt, and presenting a clear situation summary with exactly the information needed to make a decision. Briefing is usually mechanical — select and format from known sources — but may require tactical intelligence for complex situations where relevance is ambiguous.

### Debriefing

Performed after any reasoning invocation or completed task. Distils the result into a form suitable for storage and transmission. A full conversation transcript is not a debrief. A debrief extracts:

- What was decided or accomplished
- What was learned that wasn't known before
- What changed in the world as a result
- What failed and why (if applicable)

Debriefing typically requires tactical intelligence — it's a summarisation task with judgment about what matters. The output of a debrief is what enters memory and what other agents will see.

### Handoff

Performed when work moves between agents or between intelligence tiers. Translates the sender's context into what the recipient needs to act. A handoff preserves:

- What to do (the task)
- What done looks like (completion criteria)
- What to escalate (conditions that exceed the recipient's tier)
- Relevant background (only what affects execution, not full reasoning history)

A handoff strips: the proposer's internal reasoning chain, alternative approaches that were considered and rejected, context about other sub-tasks the recipient isn't responsible for.

---

## The Primitives

### 1. Propose

**What it is.** An agent offers a way to approach a problem — a decomposition into sub-problems, a plan of action, or an interpretation of an ambiguous situation.

**When it happens.** When a new problem arrives that has no known solution. When an existing approach has been Questioned and needs revision. When an agent notices an opportunity or problem that others haven't addressed. Any agent can Propose at any time — it does not require being "assigned" the problem.

**What it carries:**

*The decomposition.* The problem broken into sub-problems or steps. Each sub-problem must be concrete enough to be Accepted by another agent or to be Attempted directly. If a sub-problem is still ambiguous, it should be flagged as needing its own Propose cycle before it can be executed.

*Completion criteria for each piece.* Every sub-problem must define what "done" looks like for that piece. These should be as mechanically verifiable as possible — conditions that can be checked by observation rather than requiring judgment. Where mechanical verification is impossible, the criteria must include observable signals of progress and failure.

Examples of strong criteria: "Entity B is within 3 tiles of location X" (mechanically checkable). "Entity B has verbally confirmed acceptance of the task" (observable, recordable event).

Examples of weak criteria: "Entity B is helping" (requires interpretation). "The situation has improved" (vague, not checkable).

*Completion criteria for the whole.* How the parent problem's completion relates to the children's completion. This is a rollup definition: "If sub-task A is complete AND sub-task B is complete, then the whole is complete" — or, more nuanced, "sub-task A and B must both be complete, AND a final verification step must confirm the combined result."

If the children's completion does not logically guarantee the parent's completion, the decomposition has a gap. The Propose must either fill the gap with additional steps or acknowledge it explicitly.

*Ordering and dependencies.* Which sub-problems can proceed in parallel and which must be sequential. Which sub-problems depend on the results of others.

*Estimated difficulty per piece.* The proposer's judgment of which intelligence tier each sub-problem requires. This determines delegation — strategic sub-problems stay at the strategic tier; tactical sub-problems are handed off to cheaper models; mechanical sub-problems are executed directly.

*Failure modes and contingencies.* What could go wrong with each sub-problem, and what the response should be. "If Bjorn is not at his expected location, search the surrounding area before escalating." Not every failure mode can be anticipated, but known risks should be addressed in the proposal rather than discovered during execution.

**Intelligence tier.** Propose is almost always strategic for novel problems. For familiar problems where a known pattern applies, it can be tactical (retrieve and adapt a remembered plan) or even mechanical (exact replay of a previous successful plan).

**What makes a good Propose.** The completion criteria for the whole are achievable given the completion criteria of the parts. Each sub-problem is scoped tightly enough to be handled by the tier it's assigned to. Failure modes are anticipated. The proposal can be Questioned and defended.

---

### 2. Accept

**What it is.** An agent commits to taking responsibility for a sub-problem from a Propose. Acceptance is a binding commitment — the accepting agent is now expected to Attempt the work and Report the outcome.

**When it happens.** After receiving a Handoff that describes a sub-task. An agent should Accept only if it has enough context to understand what "done" means and believes it can either complete the task or meaningfully Attempt it and Report what happened.

**What it carries:**

*The commitment.* Confirmation that the agent takes responsibility for the sub-problem.

*Understood completion criteria.* The accepting agent's restatement of what "done" looks like, to verify shared understanding. If the agent's understanding differs from what was proposed, this is the moment to surface the mismatch — before work begins, not after.

*Escalation conditions.* Under what circumstances the agent will stop attempting and escalate. This is agreed upon at acceptance time, not discovered ad hoc. "I will attempt to reach location X. If I cannot find a path after 3 attempts, I will Report failure and request guidance."

*Estimated timeline or cost.* Not a hard deadline, but the agent's sense of how long or how many operations this should take. This helps the delegating agent detect when something has gone wrong — if a sub-task estimated at 30 seconds hasn't reported after 2 minutes, it's worth checking.

**Intelligence tier.** Acceptance is usually tactical. The sub-task has already been scoped by the strategic tier. The accepting agent needs to understand the task (which may require a cheap LLM call) but not re-reason about the whole problem. For trivially simple tasks ("move to location X"), acceptance can be mechanical — no reasoning needed, just begin execution.

**What makes a good Accept.** The restated completion criteria match the proposer's intent. Escalation conditions are specific, not vague. The agent doesn't accept tasks it cannot meaningfully attempt.

**Declining.** An agent can decline a task. This is not failure — it's a signal that the decomposition may be wrong, or that the task should go to a different agent. A decline should carry a reason: "I don't have enough information to do this," "this requires capabilities I don't have," or "I believe this sub-task is incorrectly scoped." A decline triggers reconsideration at the proposing agent.

---

### 3. Attempt

**What it is.** An agent performs a concrete action in the world and observes the result. This is where reasoning meets reality. Every Attempt produces information, whether it succeeds or fails.

**When it happens.** After an agent has Accepted a task and is executing it. Attempts are the leaf nodes of the problem-solving process — they're the things that actually change the world state.

**What it carries:**

*The action.* What the agent did. This must be concrete and observable: moved to a location, sent a message, checked a condition, searched an area.

*The intended outcome.* What the agent expected to happen, derived from the task's completion criteria. This is important because the comparison between intended and actual outcome is what drives learning.

*The actual outcome.* What actually happened. Success, failure, or partial/unexpected result.

*Observations.* Anything the agent noticed during the attempt that wasn't part of the intended task. "While moving to Bjorn's location, I noticed Cora was nearby at (12, 18)." Incidental observations can be as valuable as the primary result.

**Intelligence tier.** The action itself is mechanical — move, speak, wait, check. Interpreting an ambiguous outcome may require tactical intelligence. Recognising that an unexpected observation is significant may require tactical or strategic intelligence.

**What makes a good Attempt.** The agent has a clear expectation of what should happen (from the completion criteria). The outcome is observed and recorded honestly, including failures. Incidental observations are captured, not discarded.

**Attempt vs. Experiment.** Sometimes the point of an Attempt is to learn, not to achieve. "I'll try moving through this area to see if it's passable" is an exploratory attempt. The system should support this — not every attempt needs a success/failure judgment. Some attempts are information-gathering, and their value is in what they reveal.

---

### 4. Report

**What it is.** An agent shares information with one or more other agents. Reports are the communication fabric of the protocol — they're how agents coordinate without a central controller.

**When it happens.** After an Attempt completes (success or failure). When an agent observes something relevant to another agent's task. When an agent hits an escalation condition defined at Accept time. When an agent completes or abandons a sub-task. Periodically during long-running tasks (progress updates).

**Types of report:**

*Completion report.* "I finished sub-task X. Here's the outcome. Here's what I observed. The completion criteria [are met / are not met / are partially met]." This is the input the parent task needs to evaluate rollup — are the children done? Is the whole done?

*Failure report.* "I attempted X and it failed because of Y. I've exhausted my escalation conditions. I need guidance." This triggers re-planning at the strategic tier.

*Progress report.* "I'm working on X. Current state is Y. No blockers." This is lightweight and prevents other agents from assuming an idle or stuck state. Progress reports should be cheap — tactical or mechanical.

*Observation report.* "While doing X, I noticed Y, which may be relevant to agent Z's task." Unsolicited sharing of information. This is how incidental discoveries propagate through the system. An agent doesn't need to understand why an observation is relevant — just that it might be.

*Escalation report.* "I've encountered a situation that exceeds my ability to handle. Here's what I know, here's what I've tried, here's where I'm stuck." This is the signal for a higher intelligence tier to engage.

**What it carries:**

*Source.* Which agent is reporting.

*Subject.* What task or observation this relates to.

*Content.* The information being shared, debriefed to appropriate detail level. Not a raw dump — a distilled summary with key facts.

*Recipient(s).* Who needs this information. Can be a specific agent (the one who delegated the task), all agents working on the parent task, or broadcast (anyone who might find it useful).

*Urgency.* Whether this requires immediate attention (failure, blocker) or is informational (progress, observation).

**Intelligence tier.** Most reports are mechanical (state changes) or tactical (brief summarisation). Escalation reports may require tactical intelligence to frame the problem clearly for the strategic tier.

---

### 5. Question

**What it is.** An agent examines another agent's Proposal, plan, result, assumption, or reasoning and raises a specific concern. This is the primitive that distinguishes collaborative intelligence from parallel execution. Without Question, agents are workers. With Question, they are peers who can improve each other's thinking.

**When it happens.** After a Propose, before Acceptance — to challenge the plan before work begins. After a Report, if the results seem inconsistent or incomplete. During execution, if an agent notices that another agent's approach appears to be failing. At any time, if an agent's observations contradict another agent's assumptions.

**Types of question:**

*Completeness challenge.* "Your decomposition doesn't cover case X. What happens if Bjorn isn't where you expect him?" The proposal has a gap — a scenario that wasn't planned for.

*Criteria challenge.* "Your completion criteria for sub-task B don't guarantee the parent task's completion. Bjorn agreeing to come doesn't mean he'll actually arrive." The rollup logic has a gap.

*Assumption challenge.* "You're assuming Cora is near the pond, but I saw her heading north 5 minutes ago." The proposal is based on stale or incorrect information.

*Efficiency challenge.* "Instead of visiting each agent one by one, you could ask the first agent you find to help recruit others. This would be faster." There's a better approach than what was proposed.

*Result challenge.* "You reported sub-task B as complete, but I can observe that entity B is not actually at the target location." A reported outcome doesn't match observable reality.

*Consistency challenge.* "Your plan says to do X then Y, but Y depends on Z which isn't part of the plan." Internal logic error in the proposal.

**What it carries:**

*Target.* What specifically is being questioned — a Propose, a Report, an assumption, a criterion.

*The concern.* A specific, articulable problem. Not "I don't like this plan" but "Step 3 assumes Bjorn will accept, but Bjorn has previously declined similar requests." The concern should be concrete enough that the recipient can either address it or explain why it's not a problem.

*Evidence.* Why the questioner believes the concern is valid. An observation, a memory, a logical inference. Questions without evidence are noise.

*Suggested alternative (optional).* If the questioner has a better approach in mind, it can be included. But a Question doesn't require a solution — identifying a real problem is valuable even without a fix.

**Intelligence tier.** Question is almost always strategic. It requires understanding the full context of the proposal, identifying non-obvious gaps, and reasoning about what could go wrong. This is the most expensive primitive per invocation, but it's where the multi-agent system earns its value. A single well-placed Question that catches a flawed assumption before execution saves many wasted Attempts.

**What makes a good Question.** It is specific (targets a concrete element of the proposal). It is evidenced (explains why this is a concern). It is actionable (the recipient can respond by defending, revising, or acknowledging). It is timely (raised before work begins, not after resources are spent).

**When not to Question.** Trivial tasks with obvious approaches don't benefit from debate. If the cost of deliberation exceeds the cost of just trying and potentially failing, Attempt is more efficient than Question. The system should have a sense of when scrutiny adds value and when it adds delay. This judgment is itself a strategic-tier decision.

---

### 6. Revise

**What it is.** An agent updates a Proposal, plan, or approach in response to a Question, a failed Attempt, new information from a Report, or a changed understanding of the problem. Revise is how the system adapts without starting over.

**When it happens.** After a Question raises a valid concern that the original Proposal can't dismiss. After an Attempt fails and the current plan can't recover. After a Report reveals new information that changes the problem. After a sub-task's completion criteria turn out to be wrong or insufficient.

**What it carries:**

*What changed.* The specific elements of the original Proposal that were modified. Not a full restatement of everything — a delta. "Step 3 was 'ask Bjorn to come to (14,10)' — revised to 'ask Bjorn to come to (14,10) and verify his arrival before proceeding to step 4.'"

*Why it changed.* Which Question, Report, or observation triggered the revision. This creates a traceable reasoning chain — the system can look back and see why plans evolved.

*Updated completion criteria.* If the revision changes what "done" looks like for any sub-task or for the whole, the criteria must be explicitly updated. This is easy to forget and critical to get right — a revised plan with stale completion criteria will fail at verification.

*Impact on in-progress work.* If agents have already Accepted sub-tasks that are now changed, the revision must acknowledge this. Does agent B need to be notified that their task has changed? Does agent B need to stop what they're doing? Can the revision be applied without disrupting ongoing work?

**Intelligence tier.** Revise is typically strategic, since it involves re-reasoning about the problem. However, minor revisions to a plan (adjusting a target coordinate, adding a simple verification step) can be tactical if the structural approach hasn't changed.

**Revise vs. new Propose.** If the revision is so extensive that the original structure is unrecognisable, it should be a new Propose rather than a Revise. The distinction matters because a Revise carries the context of what was tried and why it failed, while a new Propose is evaluated from scratch. Agents who Accepted tasks under the old plan need to know whether they're getting an update or a cancellation.

---

### 7. Remember

**What it is.** The system stores a distilled lesson from a completed cycle of Propose → Accept → Attempt → Report (with optional Question and Revise along the way). Remember is what makes the system learn rather than repeat mistakes.

**When it happens.** After a task completes (success or failure). After a Question reveals a flawed assumption that was corrected. After an Attempt produces an unexpected observation. Periodically, when enough experience has accumulated to identify a pattern.

**What gets remembered:**

*Lessons.* "Moving to an occupied tile fails — target an adjacent tile instead." Actionable rules derived from experience. Lessons decay slowly and are retrieved when similar situations arise.

*Patterns.* "When delegating travel tasks, the accepting agent often agrees but then gets stuck because the destination is occupied." Higher-level observations about how the system behaves. Patterns inform future Proposals.

*Capabilities.* "Agent B is reliable for travel tasks but slow to accept social tasks." Observations about what different agents are good at. This informs future delegation decisions.

*Plans.* "The last time 'gather everyone' was the task, this decomposition worked: [steps]. It took N operations and completed in M time." Successful approaches cached for reuse. When a similar problem arrives, the Propose step can retrieve this plan rather than reasoning from scratch — dropping the intelligence tier from strategic to tactical or even mechanical.

*Failures.* "This approach to 'gather everyone' was tried and failed because of X." Equally valuable as successes. Prevents the system from repeating the same mistakes. Should be stored with the specific reason for failure, not just "it didn't work."

**Scope of memory:**

*Individual memory.* What a specific agent has experienced and learned. Relevant for that agent's future decisions. Private by default.

*Shared memory.* Lessons that are relevant to all agents. A lesson like "occupied tiles block pathfinding" is universal — every agent benefits from knowing it. Shared memories are created when a debrief produces a lesson that isn't agent-specific.

*Task memory.* The record of how a specific task was handled: the Proposal, the decomposition, the outcomes, the lessons. Attached to the task type, not to any individual agent. Retrieved when a similar task arrives in the future.

**Intelligence tier.** Storing raw facts is mechanical. Distilling lessons from experience is tactical (cheap summarisation) or strategic (identifying non-obvious patterns across multiple experiences). Retrieval is mostly mechanical (embedding similarity, keyword matching) with tactical judgment about relevance.

**Forgetting.** Not everything should be remembered forever. Lessons that are repeatedly confirmed become more durable. Lessons that are contradicted by later experience should be revised or discarded. Observations that are never retrieved should decay. The memory system needs a principle for what to keep and what to let go — not just accumulation but curation.

---

## How the Primitives Compose

The primitives are not a pipeline. They're a vocabulary. Agents combine them in whatever sequence the problem demands. But there are common patterns:

### Simple Task
```
Propose (decompose + criteria) → Accept → Attempt → Report → Remember
```
One agent, one pass, no debate. Appropriate for well-understood problems.

### Delegated Task
```
Propose (decompose + criteria)
  → Handoff (sub-task A) → Accept → Attempt → Report
  → Handoff (sub-task B) → Accept → Attempt → Report
→ Verify rollup → Remember
```
One strategic decomposition, multiple tactical executions in parallel. The proposing agent waits for Reports and verifies that the children's completion satisfies the parent's criteria.

### Contested Task
```
Propose (decompose + criteria)
  → Question (gap identified)
  → Revise (fill gap)
  → Question (efficiency challenge)
  → Revise (adopt better approach)
→ Accept → Attempt → Report → Remember
```
Multiple rounds of refinement before work begins. More expensive up front but produces better plans. Appropriate for complex or high-stakes problems.

### Exploratory Task
```
Attempt (explore) → Report (observations)
Attempt (explore) → Report (observations)
  → Propose (hypothesis based on collected observations)
  → Attempt (test hypothesis) → Report
  → Question (alternative interpretation)
  → Revise → Attempt → Report → Remember
```
No decomposition up front because the problem isn't understood yet. The system gathers information first, then forms and tests hypotheses.

### Recovery
```
(ongoing task)
  → Attempt fails → Report (failure)
  → Escalate to strategic tier
  → Briefing (assemble relevant context + failure history)
  → Propose (new approach) or Revise (adjust existing plan)
  → Accept → Attempt → Report → Remember
```
The system detects that the current approach isn't working and adapts.

### Verification
```
(sub-task reported complete)
  → Question (verify result independently)
  → If confirmed: parent task proceeds
  → If contradicted: Report (inconsistency) → Revise parent plan
```
One agent checks another's work before the parent task treats a sub-task as done. This catches cases where "Bjorn agreed" was reported as completion but Bjorn hasn't actually arrived.

---

## Principles

**Intelligence flows downward, information flows upward.** Strategic tier produces plans and criteria that flow down to tactical and mechanical tiers. Results, observations, and failures flow up from mechanical through tactical to strategic. Each upward transition includes a debrief that compresses the information.

**Escalation is a signal, not a failure.** When a tactical agent escalates to the strategic tier, it means the problem was under-specified, not that the agent is incompetent. Frequent escalation from the same kind of sub-task is a signal that the Propose step isn't reducing ambiguity enough.

**Challenge before commitment.** The cheapest time to find a flaw in a plan is before anyone starts executing it. The system should bias toward Questioning proposals before Accepting them, especially for expensive or irreversible sub-tasks.

**Define done before starting.** No sub-task should be Accepted without completion criteria. No parent task should delegate sub-tasks without rollup logic. "I'll know it when I see it" is not a completion criterion.

**Remember failures as carefully as successes.** A remembered failure with a clear cause is more valuable than a remembered success with no explanation. The system learns more from "this didn't work because X" than from "this worked."

**Minimum viable intelligence.** Use the cheapest tier that can handle each operation. Don't invoke strategic reasoning for tactical decisions. Don't invoke tactical reasoning for mechanical operations. The protocol's efficiency depends on correctly matching intelligence tier to task complexity.

**Context is curated, not accumulated.** Every reasoning invocation should receive a briefing tailored to its specific question. Passing everything the system knows into every prompt is wasteful and degrades quality. The context management operations — Briefing, Debriefing, Handoff — are as important as the reasoning itself.
