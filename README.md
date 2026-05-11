# LootLoop

LootLoop is an on-chain quest reward protocol on Solana.

LootLoop v0.2 lets a publisher create a quest, lock a SOL reward on-chain, pay a 2% platform fee, accept proof submissions before a deadline, approve one winner, and release the reward through a program-controlled vault.

## Problem

Many real-world and developer task rewards still rely on verbal promises, private agreements, or centralized platforms. This creates several trust gaps:

- Task completers cannot verify whether the reward actually exists.
- Publishers and completers lack a transparent shared task state.
- Review decisions are difficult to audit.
- Reward claiming is not recorded as a verifiable on-chain event.
- Cancelled or expired quests often have unclear reward handling.

LootLoop turns a task into an on-chain quest with explicit state, deadline, reward vault, fee vault, and cancellation rules.

## v0.2 User Flow

1. The publisher calls `create_quest` with metadata, reviewer, reward amount, and `duration_seconds`.
2. The program creates the Quest PDA, derives a reward Vault PDA, locks the reward, and sends an extra 2% fee to the Fee Vault PDA.
3. Before `expires_at`, users call `submit_proof` with a proof URI.
4. Before `expires_at`, the reviewer or publisher calls `approve_submission`.
5. The approved submitter calls `claim_reward`.
6. The quest becomes `Completed`.

Cancellation path:

- If the publisher cancels before `expires_at`, the remaining quest vault reward goes to the Public Goods Pool PDA.
- If the publisher cancels after `expires_at`, the remaining quest vault reward returns to the publisher.
- `Approved`, `Completed`, and `Cancelled` quests cannot be cancelled.

Top-up path:

- The publisher can call `top_up_quest` while the quest is still active.
- Top-up adds reward to the quest vault, optionally extends the deadline, and pays an extra 2% fee to the fee vault.

## Instructions

See [docs/flow.md](docs/flow.md) for detailed instruction inputs, accounts, permission checks, state changes, fund flow, PDA seeds, and state machine notes.

Current instructions:

- `create_quest`
- `submit_proof`
- `approve_submission`
- `claim_reward`
- `top_up_quest`
- `cancel_quest`

## PDA Seeds

- Quest PDA: `[b"quest", publisher, quest_id]`
- Vault PDA: `[b"vault", quest]`
- Submission PDA: `[b"submission", quest, submitter]`
- Fee Vault PDA: `[b"fee_vault"]`
- Public Goods Pool PDA: `[b"public_goods_pool"]`

## State Model

### Quest

Stores quest identity, publisher, reviewer, reward amount, cumulative funded amount, cumulative fee paid, creation time, expiry time, cancellation time, status, approved submitter, submission count, reward claim state, PDA bumps, and metadata URI.

### Submission

Stores the quest address, submitter, submission status, PDA bump, submitted timestamp, reviewed timestamp, and proof URI.

### QuestStatus

- `Open`: the quest is live and accepts proof submissions before expiry.
- `InReview`: reserved for a review phase.
- `Approved`: a submission has been approved and the reward is ready to claim.
- `Completed`: the reward has been claimed. This is terminal.
- `Cancelled`: the quest has been cancelled. This is terminal.

### SubmissionStatus

- `Pending`: proof has been submitted and awaits review.
- `Approved`: proof has been accepted.
- `Rejected`: reserved for a future reject flow.

## Fee Rules

- `create_quest` charges a 2% platform fee.
- `top_up_quest` charges a 2% platform fee.
- Fees are not deducted from the reward.
- The publisher pays `reward_amount` to the quest vault plus an additional fee to the fee vault.
- All amounts are integer lamports. No floating point math is used on-chain.

## Completed Features

- Quest creation with deadline
- Minimum quest duration of 1 minute
- Reward vault locking
- 2% platform fee vault
- Proof submission before expiry
- Reviewer or publisher approval before expiry
- Reward claiming by approved submitter
- Publisher top-up with optional deadline extension
- Publisher cancellation
- Public goods pool for pre-expiry cancellation
- Refund to publisher for post-expiry cancellation
- Duplicate claim prevention
- Basic permission checks
- String length limits for metadata and proof URIs
- Anchor test coverage
- Minimal React frontend demo

## How To Run

```bash
yarn install
anchor build
npx tsc --noEmit
anchor test
```

Frontend:

```bash
cd app
npm install
npm run dev
```

## Current Test Result

```text
26 passing
```

## Current Limitations

- `fee_vault` only receives fees; there is no withdraw instruction yet.
- `public_goods_pool` only receives cancelled rewards; there is no withdraw or governance instruction yet.
- Expiry checks use Solana Clock on-chain, but automated post-expiry tests are limited by local validator time-warp support.
- The current MVP is single-winner mode.
- Proof is currently stored as a URI or hash string.
- One user can submit proof only once per quest.
- The reviewer is currently a single Pubkey specified when the quest is created.

## Roadmap

- Fee vault and public goods pool governance
- `reject_submission`
- Multiple submissions or multi-winner modes
- Richer metadata schema
- IPFS, Arweave, and GitHub proof integrations
- Production-ready frontend flows

