# LootLoop

LootLoop is an on-chain quest reward protocol on Solana.

LootLoop v0.3 is a Unified Quest Engine: one-time quests and recurring quests share the same queue, review, funding, and settlement model. Review approval automatically pays the submitter from PDA-managed pools; the old `claim_reward` flow has been removed.

## Core Flow

1. Publisher calls `create_quest`, chooses `OneTime` or `Recurring`, sets reward, queue size, duration, and reviewer.
2. Funds enter the Quest `reward_pool`; guarantee funds enter the Quest `deposit_pool`; a separate 2% fee enters `fee_vault`.
3. Users call `submit_proof`; each submission receives a chain-enforced `submission_index`.
4. Manual quests are reviewed in FIFO order using `approve_submission` or `reject_submission`.
5. AutoVerified quests are reviewed in FIFO order using `auto_approve_submission`, after an authorized verifier signs a bound verification result.
6. Approval automatically pays the submitter the full `reward_per_completion`.
7. If `reward_pool` cannot pay one full reward, the quest enters irreversible `Closing` and pending approvals are fully paid from `deposit_pool`.
8. Publisher can call `fund_quest` only while the quest is `Open`.
9. Publisher can call `close_quest`; when pending submissions are cleared, `settle_quest` finalizes the pools using `closing_reason`.

## Instructions

- `create_quest`
- `submit_proof`
- `approve_submission`
- `auto_approve_submission`
- `reject_submission`
- `fund_quest`
- `close_quest`
- `settle_quest`

## PDA Seeds

- Quest PDA: `[b"quest", publisher, quest_id]`
- RewardPool PDA: `[b"reward_pool", quest]`
- DepositPool PDA: `[b"deposit_pool", quest]`
- Submission PDA: `[b"submission", quest, submission_index]`
- UserProgress PDA: `[b"user_progress", quest, user]`
- FeeVault PDA: `[b"fee_vault"]`
- PublicGoodsPool PDA: `[b"public_goods_pool"]`

## State Machine

- `Open`: accepts new submissions, reviews, and funding.
- `Closing`: no new submissions; pending submissions can still be reviewed in order.
- `Closed`: terminal state; no submit, approve, reject, fund, close, or settle again.
- `closing_reason`: `None`, `EarlyManual`, `RewardPoolDepleted`, or `Expired`; settlement uses this value, not the time of the settle transaction.

## Funding Rules

- `create_quest` and `fund_quest` charge a 2% protocol fee on reward funding.
- The fee is paid separately and is not deducted from the reward pool.
- `initial_reward_funding`, `reward_funding_amount`, `deposit_amount`, and `additional_deposit_amount` must be integer multiples of `reward_per_completion`.
- `deposit_amount >= (queue_max + 1) * reward_per_completion`.
- Approval pays the full `reward_per_completion` automatically:
  - `Open` and `reward_pool` has a full reward: pay from `reward_pool`
  - `Open` and `reward_pool` lacks a full reward: enter `Closing` with `RewardPoolDepleted` and pay the full reward from `deposit_pool`
  - `Closing`: pay approved pending submissions fully from `deposit_pool`
- There is no `PartiallyPaid` state. If `deposit_pool` cannot satisfy a full guaranteed payment, approval fails with `InsufficientDepositForGuaranteedPayment`.
- Early close or reward depletion sends remaining reward to `public_goods_pool`; remaining deposit pays a 1% fee and then goes to `public_goods_pool`.
- Expired close refunds remaining reward and deposit to publisher.

## Review Modes

- `Manual`: reviewer or publisher calls `approve_submission`.
- `AutoVerified`: an authorized verifier signs a structured verification result, then anyone can submit `auto_approve_submission` with the matching Ed25519 verification instruction.
- Manual approve is rejected for AutoVerified quests with `InvalidReviewMode`.
- Auto approve is rejected for Manual quests with `InvalidReviewMode`.
- `reject_submission` remains available to reviewer/publisher in both modes to release invalid or stale pending submissions.

Auto-Review v1 is a signature simulation layer. The Solana program does not read Strava, Garmin, GitHub, or study-platform APIs. A verifier reads off-chain data, decides whether the proof passes, and signs a result bound to:

- domain `LootLoopAutoReviewV1`
- program id
- quest
- submission index
- submitter
- cycle index
- verification template type
- template config hash
- external proof hash
- verified_at
- passed flag
- expiry
- nonce

The program verifies the immediately previous native Ed25519 instruction through the instructions sysvar, checks the signer equals `authorized_verifier`, checks the signed Borsh message matches the provided result, enforces `verified_at <= now`, `expires_at > now`, and `expires_at - verified_at <= 3600`, then reuses the same approve-and-pay logic as manual approval.

Transaction order for Auto-Review v1 must be:

1. Optional ComputeBudget instructions.
2. Native Ed25519 verification instruction.
3. `auto_approve_submission`.

The Ed25519 instruction must be directly adjacent to `auto_approve_submission`.

Auto-Review v1 also creates a quest-scoped `UsedProof` PDA at `[b"used_proof", quest, external_proof_hash]` after a successful auto approval. The same `external_proof_hash` can only be successfully used once within the same quest, even by a different submitter. Different quests may reuse the same `external_proof_hash`; global replay protection is not part of this MVP. Manual review does not use `UsedProof`.

The verifier service should still keep its own replay controls for `external_proof_hash` and `nonce`. The chain binds verifier results to the program, quest, submitter, submission index, cycle index, template config hash, and nonce to reduce cross-context replay risk.

Auto-Review roadmap:

- global `UsedProof` option
- verifier registry
- key rotation
- multi-verifier threshold
- Strava adapter
- GitHub adapter
- study platform adapter
- TEE / ZK proof based verifier

## Recurring Cycle Window

- Recurring quests only accept proof for the current cycle.
- The program computes `current_cycle_index = (Clock::get()?.unix_timestamp - quest.start_at) / quest.period_seconds`.
- Users cannot submit a historical cycle or future cycle from the frontend; `submit_proof` has no `cycle_index` argument.
- `UserProgress` stores only the recent 32-cycle on-chain window.
- The window records protocol states for duplicate prevention: `0` empty/rejected, `1` pending, `2` approved/paid.
- Pending or approved in the current cycle blocks another submission in that same cycle.
- Rejected resets the current cycle state to empty, so the user may resubmit with a new `submission_index`.
- Older history beyond the 32-cycle window is not a protocol credential. A client, localStorage, IndexedDB, or indexer may keep long-term records for display, search, and stats only.
- The protocol only trusts on-chain state for submit eligibility, review, reward payment, and settlement.

Future roadmap:

- `PeriodProgress` PDA
- `UserCycle` PDA
- off-chain indexer
- verifiable long-term history queries

## Completed Features

- Unified one-time and recurring quest model
- Queue-indexed submissions
- FIFO review enforced on-chain
- Automatic reward payout on approval
- Deposit-backed compensation
- Reject flow that releases queue slots
- Publisher funding and deadline extension
- Early close and settle flow
- Fee vault and public goods pool PDAs
- User progress tracking for one-time and recurring duplicate prevention
- Manual and AutoVerified review modes
- Ed25519 verifier-signature auto approval
- Quest-scoped UsedProof replay protection
- React devnet frontend with dashboard, quest detail, submitter, reviewer, publisher, and state-viewer tabs

## Frontend Demo

The React app is still a devnet demo, not a production UI. It is organized into product-facing tabs:

- `Dashboard`: loads Quest accounts with `program.account.quest.all()`, supports status/mode/review filters, and lets users view or copy Quest PDAs.
- `Quest Detail`: shows publisher, reviewer, mode, review mode, verifier settings, queue, timing, pool balances, totals, and the connected wallet's `UserProgress`.
- `Create Quest`: creates Manual or AutoVerified quests with deposit, fee, duration, recurring period, and integer-multiple funding validation.
- `Submitter Tools`: submits a proof URI for the selected quest, shows current cycle and duplicate-prevention state, and disables submission when the queue is full, expired, closed, pending, or approved.
- `Reviewer Tools`: loads `next_review_index`, displays the current Submission, supports Manual approve/reject, and shows the Auto Approve mock verifier-signature panel for AutoVerified quests.
- `Publisher Tools`: funds Open quests, closes quests, and settles Closing quests with publisher permission hints.
- `Protocol State`: raw state viewer for Quest, pools, counters, and the 32-cycle user window.

Quest detail links can be opened at `/quest/:questPda`.

## How To Run

```bash
yarn install
cargo fmt
anchor build
npx tsc --noEmit
anchor test --provider.cluster localnet
```

Frontend:

```bash
cd app
npm install
npm run dev
```

The frontend is configured for Solana devnet:

```text
https://api.devnet.solana.com
```

## Current Test Result

```text
45 passing
```

`anchor test` with the current devnet provider requires the upgrade authority wallet to have enough SOL to deploy or upgrade the program. Use localnet for automated tests, or fund the devnet upgrade authority before deploying.

## Current Limitations

- `fee_vault` only receives fees; there is no withdraw instruction yet.
- `public_goods_pool` only receives funds; there is no governance or withdrawal instruction yet.
- Recurring duplicate prevention uses a fixed recent-cycle window.
- Auto-Review v1 is a verifier signature mock flow and does not integrate real external APIs yet.
- Auto-Review v1 does not yet store used external proof hashes on-chain.
- The reviewer is currently a single Pubkey specified when the quest is created.
- Proof is currently stored as a URI or hash string.
- Frontend is a hackathon demo UI, not a production app.
