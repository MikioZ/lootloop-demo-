# LootLoop v0.3 Flow

LootLoop v0.3 replaces the old escrow + `claim_reward` model with a unified quest engine. Approval is now the settlement event: when a reviewer approves a submission, the program immediately pays the submitter from PDA-managed pools.

## State Machine

- `Open`: accepts new proof submissions, reviews, and funding.
- `Closing`: stops new submissions but keeps pending submissions reviewable.
- `Closed`: terminal state.
- `closing_reason`: records why the quest entered `Closing`: `None`, `EarlyManual`, `RewardPoolDepleted`, or `Expired`.

## PDA Seeds

- Quest PDA: `[b"quest", publisher, quest_id]`
- RewardPool PDA: `[b"reward_pool", quest]`
- DepositPool PDA: `[b"deposit_pool", quest]`
- Submission PDA: `[b"submission", quest, submission_index]`
- UserProgress PDA: `[b"user_progress", quest, user]`
- FeeVault PDA: `[b"fee_vault"]`
- PublicGoodsPool PDA: `[b"public_goods_pool"]`

## Instructions

### `create_quest`

Purpose: create a `OneTime` or `Recurring` quest and fund the initial pools.

Inputs:

- `quest_id`
- `mode`
- `review_mode`
- `verification_template`
- `template_config_hash`
- `verification_schema_uri`
- `authorized_verifier`
- `metadata_uri`
- `reviewer`
- `reward_per_completion`
- `initial_reward_funding`
- `deposit_amount`
- `duration_seconds`
- `period_seconds`
- `queue_max`

Checks:

- `duration_seconds >= 60`
- `reward_per_completion >= 0.001 SOL`
- `initial_reward_funding >= 0.001 SOL`
- `initial_reward_funding % reward_per_completion == 0`
- `deposit_amount % reward_per_completion == 0`
- `deposit_amount >= (queue_max + 1) * reward_per_completion`
- `Recurring` requires `period_seconds > 0`
- `OneTime` requires `period_seconds == 0`
- `AutoVerified` requires a non-default `authorized_verifier`
- `AutoVerified` requires a non-zero `template_config_hash`
- `verification_schema_uri` must fit the URI length limit

Fund flow:

- `initial_reward_funding` goes to `reward_pool`
- `deposit_amount` goes to `deposit_pool`
- `initial_reward_funding * 2%` goes to `fee_vault`

### `submit_proof`

Purpose: enqueue a proof submission.

Checks:

- Quest must be `Open`
- Current time must be before `expires_at`
- `pending_count < queue_max`
- One-time users cannot have a pending or completed submission
- Recurring users cannot submit twice in the same cycle
- Recurring submissions are always for the current on-chain cycle; the frontend cannot pass `cycle_index`

State changes:

- Creates `Submission` with `submission_index = quest.next_submission_index`
- Stores `Submission.cycle_index` from the program-computed current cycle
- Increments `next_submission_index`, `total_submissions`, and `pending_count`
- Updates `UserProgress`

Recurring cycle calculation:

```text
current_cycle_index = (Clock::get()?.unix_timestamp - quest.start_at) / quest.period_seconds
```

Historical catch-up submissions and future-cycle submissions are not supported. Qualification is always based on Solana `Clock` and current on-chain `UserProgress`.

### `approve_submission`

Purpose: manually approve the next queued submission and automatically pay the submitter.

Checks:

- Quest must use `ReviewMode::Manual`
- Caller must be reviewer or publisher
- Quest must be `Open` or `Closing`
- Submission must be `Pending`
- `submission_index == quest.next_review_index`

Fund flow:

- If the quest is `Open` and `reward_pool` has at least one full reward, pay the full reward from `reward_pool`
- If the quest is `Open` and `reward_pool` lacks one full reward, set `closing_reason = RewardPoolDepleted`, enter `Closing`, and pay the full reward from `deposit_pool`
- If the quest is already `Closing`, pay approved pending submissions fully from `deposit_pool`
- If `deposit_pool` cannot pay the full guaranteed reward, fail with `InsufficientDepositForGuaranteedPayment`

State changes:

- `Approved` means reviewed and fully paid
- Increments `next_review_index`
- Decrements `pending_count`
- Updates totals and `UserProgress`
- There is no `PartiallyPaid` status.

### `auto_approve_submission`

Purpose: automatically approve the next queued submission after verifying an authorized verifier signature.

Checks:

- Quest must use `ReviewMode::AutoVerified`
- Quest must be `Open` or `Closing`
- Submission must be `Pending`
- `submission_index == quest.next_review_index`
- `submission.quest == quest.key()`
- `submission.submitter == verification_result.submitter`
- `submission.cycle_index == verification_result.cycle_index`
- `verification_result.quest == quest.key()`
- `verification_result.submission_index == submission.submission_index`
- `verification_result.template_type == quest.verification_template`
- `verification_result.template_config_hash == quest.template_config_hash`
- `verification_result.passed == true`
- `verification_result.expires_at >= Clock::get()?.unix_timestamp`
- The previous transaction instruction must be a native Ed25519 verification instruction
- The Ed25519 signer must equal `quest.authorized_verifier`
- The signed message must equal the serialized `VerificationResult`

Signed message format:

- `domain`: `LootLoopAutoReviewV1`
- `program_id`
- `quest`
- `submission_index`
- `submitter`
- `cycle_index`
- `template_type`
- `template_config_hash`
- `external_proof_hash`
- `verified_value`
- `passed`
- `verified_at`
- `expires_at`
- `nonce`

Fund flow:

- Reuses the same approve-and-pay helper as `approve_submission`
- Pays a full `reward_per_completion`
- If `reward_pool` lacks one full reward, enters `Closing` with `RewardPoolDepleted` and pays from `deposit_pool`

Design boundary:

- The chain does not call Strava, Garmin, GitHub, or learning-platform APIs.
- The verifier is responsible for off-chain data authenticity.
- The chain only verifies the authorized verifier signature and context binding.
- MVP does not create a `UsedProof` PDA; `external_proof_hash` replay prevention is verifier-side for now.

### `reject_submission`

Purpose: reject the next queued submission without payment.

Checks:

- Caller must be reviewer or publisher
- Quest must not be `Closed`
- Submission must be `Pending`
- `submission_index == quest.next_review_index`

State changes:

- Submission becomes `Rejected`
- Increments `next_review_index`
- Decrements `pending_count`
- Allows the same user to resubmit later

### `fund_quest`

Purpose: add reward funding, add deposit, and/or extend expiry.

Checks:

- Caller must be publisher
- Quest must be `Open`
- Reward funding is either `0` or at least `0.001 SOL`
- Reward funding, when non-zero, must be a multiple of `reward_per_completion`
- Additional deposit, when non-zero, must be a multiple of `reward_per_completion`
- Extension cannot be negative

Fund flow:

- Reward funding goes to `reward_pool`
- Extra deposit goes to `deposit_pool`
- Reward funding pays an extra 2% fee to `fee_vault`

### `close_quest`

Purpose: start quest closure.

Checks:

- Caller must be publisher
- Quest must be `Open`

Rules:

- If pending submissions remain, quest becomes `Closing`
- If no pending submissions remain, settlement happens immediately
- Early close sets `closing_reason = EarlyManual`
- Expired close sets `closing_reason = Expired`
- Early close sends remaining reward to `public_goods_pool` and sends remaining deposit minus 1% fee to `public_goods_pool`
- Expired close returns remaining reward and deposit to publisher

### `settle_quest`

Purpose: finalize a `Closing` quest after all pending submissions are reviewed.

Checks:

- Quest must be `Closing`
- `pending_count == 0`
- `next_review_index == next_submission_index`
- Publisher account must match `quest.publisher`

Rules:

- Uses `closing_reason`, not current wall-clock time, to choose settlement
- `EarlyManual` or `RewardPoolDepleted`: remaining reward goes to `public_goods_pool`; remaining deposit pays 1% fee to `fee_vault`, then goes to `public_goods_pool`
- `Expired`: remaining reward and deposit return to publisher
- Anyone can call, but funds always settle to the recorded publisher, fee vault, or public goods pool

## Current Tests

The Anchor suite covers create, submit, FIFO approve, reject, deposit fallback, closing, settlement, closed-state rejection, recurring duplicate prevention, expired close, and AutoVerified signature approval.

Current localnet result:

```text
45 passing
```

## Recurring 32-Cycle Window

`UserProgress` stores a fixed recent-cycle window:

- `recent_cycles[32]`
- `recent_cycle_states[32]`
- state `0`: empty or rejected
- state `1`: pending
- state `2`: approved and fully paid

The window is a protocol duplicate-prevention cache for the current and recent cycles. On submit, the program prunes states older than 32 cycles relative to the current cycle, checks the current cycle state, then writes `Pending`. On approval, the submitted cycle becomes `Approved` if it is still inside the recent window. On rejection, the submitted cycle becomes empty/rejected, allowing resubmission in the same current cycle with a new `submission_index`.

The chain does not store long-term per-user recurring history beyond this window. A frontend may keep local or indexed history with:

- quest address
- cycle index
- proof URI
- submitted/reviewed timestamps
- result
- reward amount
- transaction signature

Those off-chain records are for display, query, and analytics only. They are not accepted by the protocol for submit eligibility, reward payment, review, settlement, or restoring a user's status.

Roadmap:

- `PeriodProgress` PDA
- `UserCycle` PDA
- off-chain indexer
- verifiable long-term history queries

## Auto-Review Roadmap

- verifier registry
- multi-verifier threshold
- `UsedProof` PDA
- Strava adapter
- GitHub adapter
- study platform adapter
- TEE / ZK proof based verifier
