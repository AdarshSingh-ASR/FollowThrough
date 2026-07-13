# Devpost submission draft

## Project name

FollowThrough

## Tagline

The Slack accountability agent that turns “I’ll do it” into done.

## Track

New Slack Agent

## Inspiration

Teams do not usually fail because nobody made a plan. They fail because small promises disappear into the conversation: “I’ll send the deck by Friday,” “let’s circle back next week,” “I can review that tomorrow.” The commitment lives in Slack, while the accountability system lives somewhere else—or nowhere at all.

We wanted to close that gap without creating a surveillance bot or another task-management chore.

## What it does

FollowThrough watches only the Slack conversations it has access to and detects explicit commitments that contain an owner, an action, and a natural-language deadline. It replies in the source thread with a compact Block Kit card showing what it understood.

Crucially, nothing is tracked until a person clicks **Track it**. Once confirmed, FollowThrough remembers the minimal commitment metadata and privately nudges the owner when the deadline approaches. The owner can mark it **Done**, **Snooze 1 day**, or jump back to the source context.

People can view their commitments from App Home, `/followthrough`, mentions, or Slack's native Agent Messages surface. Team leads can ask for a team pulse without creating a public leaderboard or shame mechanic.

## How we built it

- Slack native Agent Messages experience through `agent_view`
- Gemini 3.5 Flash primary extraction with Groq strict structured-output failover
- Slack Real-time Search through `assistant.search.context` for user-triggered live context queries
- Bolt for JavaScript running over Socket Mode
- Slack Events API for conversation signals
- Block Kit for confirmation, nudges, dashboard cards, and one-click actions
- App Home, slash commands, mentions, and DMs for multi-surface interaction
- `chrono-node` for natural-language date parsing
- Zod validation plus deterministic safe rules when both Gemini and Groq are unavailable
- A small persistence adapter that stores only confirmed commitment metadata
- A scheduler that handles due-soon and overdue nudges with a cooldown
- An MCP client plus replaceable tracker server that synchronizes normalized commitment state
- Recipient-aware private follow-up, fuzzy-deadline clarification, weekly digests, and opt-in escalation
- Node's built-in test runner for commitment detection and false-positive guards

## Why it is an agent

FollowThrough is goal-oriented and partially autonomous: it observes conversations, identifies a possible future obligation, pauses at the boundary of its authority for human confirmation, maintains long-term commitment state, decides when follow-up is appropriate, and gives the user tools to close or reschedule the loop.

It uses Slack's native agent surface and follows Slack's agent principles: visible reasoning, human-in-the-loop control, minimal disruption, clear failure boundaries, and traceable source context.

## Challenges

The hardest part was balancing helpfulness with trust. An accountability product can easily become a surveillance or public-shaming product. We intentionally require confirmation, send nudges privately, avoid ranking individuals, and retain no original message body.

Natural language is also ambiguous. “Let's circle back next week” might be a real commitment or a polite suggestion. We expose a confidence score and make dismissal one click instead of pretending the detector is infallible.

## Accomplishments

- End-to-end loop from conversational promise to private nudge to completion
- Native Slack experience across channel threads, Agent Messages, App Home, DMs, mentions, and slash commands
- Human confirmation as a first-class product interaction
- Minimal-data architecture with traceable source permalinks
- A universal use case that applies to product, sales, support, education, nonprofit, and volunteer teams

## What we learned

Accountability is more effective when it feels like memory, not management. The best UX was not a large dashboard; it was a small, well-timed confirmation in the thread where the promise was made and a respectful private follow-up when it mattered.

## What's next

Next we would add structured LLM extraction for implicit and multi-part promises, editable confirmation modals, per-channel policies, quiet hours, team-specific nudge cadences, encrypted multi-tenant storage, and privacy-preserving completion analytics.

## Potential impact

Every team makes commitments, so the addressable workflow is universal. FollowThrough can reduce missed handoffs, unblock decisions sooner, and create lightweight reliability without demanding a new system of record. It is especially valuable for teams where coordination cost is high and project-management overhead is unaffordable.

## Three-minute demo script

### 0:00–0:20 — Hook

“Teams make hundreds of promises in Slack. Most never become tasks. FollowThrough turns the promise already in the conversation into a lightweight accountability loop.”

### 0:20–0:55 — Detect and confirm

1. In `#launch`, post: `I'll send the revised launch deck tomorrow at 3pm.`
2. Show the in-thread card: owner, extracted action, due date, confidence.
3. Say: “FollowThrough does not silently track people. A human confirms first.”
4. Click **Track it**.

### 0:55–1:25 — Universal and low-friction

1. Post: `Let's circle back next week.`
2. Dismiss it with **Not a commitment** to demonstrate correction.
3. Open App Home and show the clean personal dashboard.

### 1:25–1:55 — Native agent experience

1. Open FollowThrough's Messages tab.
2. Click “My commitments” or ask: `What do I owe?`
3. Ask: `Give me the team pulse.`
4. Emphasize that the same state is available conversationally, via App Home, and `/followthrough`.

### 1:55–2:30 — Nudge and close the loop

1. Use a demo deadline two minutes away with a five-minute lead window.
2. Show the private DM nudge with **Done**, **Snooze 1 day**, and source context.
3. Click **Done** and show the updated state.
4. Say: “Nudges are private. There is no leaderboard and no public shame.”

### 2:30–2:50 — Architecture and trust

Show `docs/architecture.svg`. Explain Events API → detector → human confirmation → minimal store → scheduler → Slack surfaces. Call out that original message bodies are not retained.

### 2:50–3:00 — Close

“FollowThrough works for literally any team because every team makes promises. It adds accountability without adding another place to work.”

## Submission checklist

- [ ] Select **New Slack Agent** track
- [ ] Paste and polish this description
- [ ] Upload a ~3 minute video with working Slack footage
- [ ] Upload `docs/architecture.png`
- [ ] Add the Slack developer sandbox URL
- [ ] Give sandbox access to `slackhack@salesforce.com` and `testing@devpost.com`
- [ ] Add screenshots/GIF showing detection, confirmation, Home, nudge, and completion
- [ ] Confirm the Devpost project is submitted before July 14, 2026 at 5:30 AM IST
