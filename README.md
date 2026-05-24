# LootLoop

LootLoop is an on-chain quest reward settlement protocol on Solana, supporting manual review and verifier-signed auto-review for one-time and recurring tasks.

## Problem

Task reward systems often depend on informal promises or centralized platforms:

- Contributors cannot verify that reward funds actually exist before doing the work.
- Review and payout states are opaque.
- Long-running recurring tasks are hard to fund and guarantee over time.
- Quantifiable tasks such as workouts, study sessions, GitHub activity, or attendance lack a composable settlement layer.
- Reward distribution usually mixes human judgment, off-chain proof, and custodial payment flows.

## Solution

LootLoop turns quest rewards into PDA-managed settlement flows:

- `reward_pool` holds normal reward funding.
- `deposit_pool` backs approved pending submissions if reward funding runs out.
- Submissions enter an ordered queue and must be reviewed by `next_review_index`.
- Approval is also settlement: `approve_submission` and `auto_approve_submission` pay automatically.
- `Closing` stops new submissions while preserving review and payment for existing pending submissions.
- Quests support `Manual` and `AutoVerified` review modes.
- Auto-Review v1 verifies Ed25519 signatures from an authorized verifier.
- Quest-scoped `UsedProof` PDA prevents the same external proof hash from being reused within one quest.

## Core Features

- OneTime and Recurring quests share one task engine.
- PDA-managed `reward_pool` and `deposit_pool`.
- Full-payment guarantee for approved pending submissions.
- Ordered review by `next_submission_index` and `next_review_index`.
- Manual reviewer / publisher approval and rejection.
- AutoVerified review using verifier-signed Ed25519 messages.
- Quest-scoped `UsedProof` replay protection.
- `fee_vault` for protocol fees.
- `public_goods_pool` for early-close and reward-depletion settlement.
- Frontend Quest List, Quest Detail, Submitter Tools, Reviewer Tools, Publisher Tools, and Protocol State Viewer.

## Architecture Overview

### Accounts

- `Quest`: publisher, reviewer, mode, review mode, status, funding totals, queue indices, settlement reason, metadata, verifier configuration.
- `Submission`: queue-indexed proof record with submitter, cycle, status, payout breakdown, timestamps, and proof URI.
- `UserProgress`: per-quest user progress, OneTime completion, pending flag, and recent 32-cycle Recurring window.
- `RewardPool PDA`: quest reward funding.
- `DepositPool PDA`: quest guarantee funding.
- `UsedProof PDA`: quest-scoped replay guard for AutoVerified external proof hashes.
- `FeeVault PDA`: global protocol fee vault.
- `PublicGoodsPool PDA`: global pool for early-close and reward-depletion residual funds.

### PDA Seeds

| Account | Seeds |
| --- | --- |
| Quest | `[b"quest", publisher, quest_id]` |
| Submission | `[b"submission", quest, submission_index]` |
| UserProgress | `[b"user_progress", quest, user]` |
| RewardPool | `[b"reward_pool", quest]` |
| DepositPool | `[b"deposit_pool", quest]` |
| UsedProof | `[b"used_proof", quest, external_proof_hash]` |
| FeeVault | `[b"fee_vault"]` |
| PublicGoodsPool | `[b"public_goods_pool"]` |

## Fund Flow

### Create Quest

`create_quest` initializes the Quest, reward pool, deposit pool, fee vault, and public goods pool as needed.

- `initial_reward_funding` enters `reward_pool`.
- A 2% fee on reward funding enters `fee_vault`.
- `deposit_amount` enters `deposit_pool`.
- Reward funding and deposit amounts must be integer multiples of `reward_per_completion`.
- Deposit must satisfy `(queue_max + 1) * reward_per_completion`.

### Fund Quest

`fund_quest` is allowed only while the quest is `Open`.

- Additional reward funding enters `reward_pool`.
- Reward funding pays an extra 2% fee to `fee_vault`.
- Additional deposit enters `deposit_pool`.
- Duration can be extended, never shortened.
- `Closing` is irreversible and cannot be reopened by funding.

### Approve Submission

Approval pays one full `reward_per_completion` automatically.

- If `reward_pool` has a full reward and the quest is `Open`, payment comes from `reward_pool`.
- If `reward_pool` lacks one full reward, the quest enters `Closing` with `RewardPoolDepleted`, and payment comes fully from `deposit_pool`.
- If the quest is already `Closing`, approved pending submissions are paid fully from `deposit_pool`.
- There is no `claim_reward` instruction and no `PartiallyPaid` status.

### Reward Pool Depleted

Reward depletion is treated as an early close caused by publisher funding responsibility.

- New submissions stop immediately.
- Existing pending submissions remain reviewable in FIFO order.
- Settlement sends remaining reward to `public_goods_pool`.
- Remaining deposit pays a 1% cancellation fee, then goes to `public_goods_pool`.

### Early Close

Publisher can close an `Open` quest before expiration.

- If pending submissions exist, status becomes `Closing`.
- Pending submissions must be reviewed before settlement.
- Remaining reward goes to `public_goods_pool`.
- Remaining deposit pays a 1% cancellation fee to `fee_vault`, then goes to `public_goods_pool`.

### Expired Close

When `now >= expires_at`, expired close is not publisher default.

- Pending submissions still review in order.
- After pending clears, remaining reward and deposit return to publisher.

## Review Modes

### Manual

Manual quests are reviewed by the configured reviewer or publisher.

- `approve_submission`: validates FIFO order and pays automatically.
- `reject_submission`: rejects without payment and releases queue/user pending state.

### AutoVerified

AutoVerified quests are reviewed by `auto_approve_submission`.

- Manual approve is rejected for AutoVerified quests.
- `reject_submission` remains available to reviewer/publisher to release stale or invalid pending submissions.
- Auto approval uses the same approve-and-pay helper as Manual approval after signature validation.

## Auto-Review v1 Trust Model

Solana programs cannot directly access Strava, Garmin, GitHub, study platforms, or other external APIs.

Auto-Review v1 therefore verifies a signed result rather than external data itself:

- The verifier is responsible for checking off-chain data authenticity.
- The verifier signs a Borsh-serialized `VerificationResult`.
- The chain verifies the immediately preceding native Ed25519 instruction.
- The signer must equal `quest.authorized_verifier`.
- The signed message must bind program id, quest, submission index, submitter, cycle index, template type, template config hash, external proof hash, pass result, timestamps, and nonce.
- `verified_at <= now`, `expires_at > now`, and TTL is capped at 3600 seconds.
- `UsedProof` prevents the same `external_proof_hash` from being successfully reused within one quest.

Current MVP limitations:

- Auto-Review is a mock verifier-signature flow.
- There is no real Strava, Garmin, GitHub, or study-platform adapter yet.
- There is no verifier registry, key rotation, or multi-verifier threshold yet.
- `UsedProof` is quest-scoped, not global.

## Frontend Demo

The React app is a devnet demo, not a production UI.

- `Dashboard`: loads Quest accounts with `program.account.quest.all()`, filters by status, review mode, and quest mode.
- `Quest Detail`: displays core quest fields, verifier settings, pool balances, queue, time, and connected wallet `UserProgress`.
- `Create Quest`: creates Manual or AutoVerified OneTime / Recurring quests with funding and deposit validation.
- `Submitter Tools`: submits proof URI, shows current cycle and user duplicate-prevention state.
- `Reviewer Tools`: loads the next queued submission, supports Manual approve/reject, and AutoVerified mock signature approval.
- `Publisher Tools`: funds, closes, and settles quests with publisher permission hints.
- `Protocol State`: raw state viewer for quest, pools, counters, and 32-cycle window.

Quest detail links can be opened at:

```text
/quest/:questPda
```

## How To Run

Install dependencies:

```bash
yarn install
cd app && npm install
```

Build the Anchor program:

```bash
anchor build
```

Run tests on localnet:

```bash
anchor test --provider.cluster localnet
```

Run the frontend:

```bash
cd app
npm run dev
```

Build the frontend:

```bash
cd app
npm run build
```

The frontend is configured for Solana devnet:

```text
https://api.devnet.solana.com
```

## Test Result

Current Anchor test result:

```text
54 passing
```

Use `anchor test --provider.cluster localnet` for automated tests. Avoid default devnet tests unless the upgrade authority wallet is funded and deployment is intentional.

## Known Limitations

- Devnet/demo only; not audited and not production ready.
- No real Strava, Garmin, GitHub, or study-platform adapter yet.
- No verifier registry yet.
- No verifier key rotation yet.
- No multi-verifier threshold yet.
- Quest List currently uses direct account fetch; production needs an indexer.
- Recurring quests store only a recent 32-cycle window on-chain.
- Local client/off-chain history is display-only and is not protocol evidence.
- `fee_vault` and `public_goods_pool` receive funds but do not yet have governance/withdrawal instructions.
- Reviewer is currently a single Pubkey per quest.

## Roadmap

- GitHub verifier.
- Verifier registry.
- Verifier key rotation.
- Multi-verifier threshold.
- Global `UsedProof` option.
- Indexer for quests, submissions, used proofs, and user histories.
- Real data provider adapters for Strava, Garmin, GitHub, study platforms, and attendance.
- Multisig treasury controls.
- Public goods governance.
- Audit checklist, threat model review, and bug bounty.

## Documentation

- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Invariants](docs/invariants.md)
- [Threat Model / Audit Checklist](docs/threat-model.md)
- [Demo Walkthrough](docs/demo-walkthrough.md)
- [AI-Assisted Development](docs/ai-assisted-development.md)
- [Detailed Flow](docs/flow.md)
- [Demo Script](docs/demo-script.md)
