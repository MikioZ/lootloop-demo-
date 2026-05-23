# LootLoop Architecture

## High-Level Architecture

LootLoop is a Solana quest reward settlement protocol. A publisher creates a quest, pre-funds PDA pools, users submit proof URIs, and reviewers or verifier signatures approve or reject submissions in a strict queue.

The protocol separates four concerns:

- Eligibility and queueing: `submit_proof` creates ordered `Submission` PDAs.
- Review: Manual reviewers or AutoVerified verifier signatures decide whether a submission passes.
- Settlement: approval pays immediately from PDA pools.
- Lifecycle: quests move from `Open` to `Closing` to `Closed`.

The frontend is a React devnet demo that reads program accounts directly and provides role-specific tools for publishers, reviewers, and submitters.

## Account Model

### Quest

The primary quest state. It stores publisher, reviewer, mode, review mode, verifier settings, reward/deposit parameters, status, queue indices, counters, totals, and metadata URIs.

Important fields:

- `mode`: `OneTime` or `Recurring`
- `review_mode`: `Manual` or `AutoVerified`
- `status`: `Open`, `Closing`, or `Closed`
- `closing_reason`: `None`, `EarlyManual`, `RewardPoolDepleted`, or `Expired`
- `next_submission_index`
- `next_review_index`
- `pending_count`
- funding totals and payout totals

### Submission

An ordered proof record. Submissions are derived by `submission_index`, not by submitter, so multiple users can enter a chain-enforced queue.

Important fields:

- `submission_index`
- `submitter`
- `cycle_index`
- `proof_uri`
- `status`: `Pending`, `Approved`, or `Rejected`
- `paid_from_reward_pool`
- `paid_from_deposit_pool`

### UserProgress

Tracks a user under one quest.

- OneTime quests use `pending_one_time` and `one_time_completed`.
- Recurring quests use a recent 32-cycle window.
- Cycle state values are `0` empty/rejected, `1` pending, and `2` approved.

### RewardPool PDA

Stores normal quest reward funding. Approval pays from this pool while the quest is `Open` and the pool has at least one full reward.

### DepositPool PDA

Stores guarantee funding. If `reward_pool` cannot pay one full reward, the quest enters `Closing` and approved pending submissions are paid from `deposit_pool`.

### UsedProof PDA

Stores successful AutoVerified external proof usage. It prevents the same `external_proof_hash` from being used twice within one quest.

### FeeVault PDA

Global PDA that receives reward funding fees and early-close deposit cancellation fees.

### PublicGoodsPool PDA

Global PDA that receives early-close or reward-depletion residual funds.

## PDA Seeds

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

## Instruction List

- `create_quest`
- `submit_proof`
- `approve_submission`
- `auto_approve_submission`
- `reject_submission`
- `fund_quest`
- `close_quest`
- `settle_quest`

## State Machine

### Open

The quest accepts submissions, reviews, and funding.

Allowed operations:

- `submit_proof`
- `approve_submission` for Manual quests
- `auto_approve_submission` for AutoVerified quests
- `reject_submission`
- `fund_quest`
- `close_quest`

### Closing

The quest no longer accepts submissions or funding. Pending submissions must still be reviewed in FIFO order.

Allowed operations:

- `approve_submission` for Manual quests
- `auto_approve_submission` for AutoVerified quests
- `reject_submission`
- `settle_quest` once pending submissions are cleared

### Closed

Terminal state. No submit, approve, reject, fund, close, or settle operations should proceed.

## Submission Queue Model

Each `submit_proof` uses `quest.next_submission_index` to derive a `Submission` PDA.

Review must satisfy:

```text
submission.submission_index == quest.next_review_index
```

This makes off-chain queue views optional. The source of truth for review order is on-chain.

`reject_submission` advances `next_review_index` and releases `pending_count`, but does not pay. `approve_submission` and `auto_approve_submission` advance the queue and pay one full reward.

## Reward And Deposit Pools

Reward funding enters `reward_pool`. A 2% fee is paid separately to `fee_vault`.

Deposit funding enters `deposit_pool`. Deposit must be large enough to guarantee pending approved submissions:

```text
deposit_amount >= (queue_max + 1) * reward_per_completion
```

If reward funding is insufficient at approval time, the quest enters `Closing` and approved pending submissions are paid from `deposit_pool`.

## Manual Review Flow

1. User submits proof.
2. Reviewer or publisher loads `next_review_index`.
3. Reviewer calls `approve_submission` or `reject_submission`.
4. Approve pays automatically.
5. Reject releases the queue slot and user pending state.

Manual approve is rejected for AutoVerified quests.

## AutoVerified Review Flow

1. User submits proof.
2. Off-chain verifier checks external data.
3. Verifier signs a Borsh `VerificationResult`.
4. Transaction includes the native Ed25519 verification instruction immediately before `auto_approve_submission`.
5. Program checks signer, signed message, context bindings, pass result, expiration, TTL, FIFO order, and UsedProof uniqueness.
6. Program creates `UsedProof`.
7. Program calls the same approve-and-pay helper used by Manual review.

AutoVerified does not let the chain read external APIs directly.

## Closing / Settle Flow

Closing can happen by:

- Publisher early manual close.
- Reward pool depletion during approval.
- Expired close after `expires_at`.

Settlement depends on `closing_reason`, not the current wall clock at settlement time.

- `Expired`: remaining reward and deposit return to publisher.
- `EarlyManual` or `RewardPoolDepleted`: remaining reward goes to `public_goods_pool`; remaining deposit pays a 1% fee to `fee_vault`, then goes to `public_goods_pool`.

## Frontend Architecture

The React app is a devnet demo with tabs:

- Dashboard / Quest List
- Quest Detail
- Create Quest
- Submitter Tools
- Reviewer Tools
- Publisher Tools
- Protocol State Viewer

It reads Quest accounts with `program.account.quest.all()` and fetches details, pool balances, submissions, and user progress on demand. It does not replace on-chain authorization or validation; the program remains the source of truth.
