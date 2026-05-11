# LootLoop v0.2 Flow

LootLoop v0.2 is a single-winner on-chain quest reward protocol. A publisher creates a quest, locks a reward, pays a separate platform fee, receives proof submissions before expiry, approves one submitter, and lets the approved submitter claim the reward.

## Complete User Flow

1. Publisher creates a quest with `create_quest`.
2. The reward is locked in the quest Vault PDA.
3. The publisher pays an additional 2% platform fee into the Fee Vault PDA.
4. Submitters submit proof URI values with `submit_proof` before the quest expires.
5. The reviewer or publisher approves one pending submission with `approve_submission` before the quest expires.
6. The approved submitter claims the reward with `claim_reward`.
7. The quest becomes `Completed`.

Alternative flows:

- The publisher can call `top_up_quest` to add more reward and optionally extend the deadline.
- The publisher can call `cancel_quest` while the quest is not `Approved`, `Completed`, or `Cancelled`.
- If cancellation happens before expiry, the remaining reward goes to the Public Goods Pool PDA.
- If cancellation happens after expiry, the remaining reward returns to the publisher.

All time checks use Solana `Clock`. Frontend time is never trusted by the program.

All amounts are lamports. The program does not use floating point math.

## PDA Seeds

### Quest PDA

```text
[b"quest", publisher.key().as_ref(), quest_id.to_le_bytes()]
```

Purpose: stores one quest created by a publisher.

Uniqueness:

- Same publisher and same `quest_id` derive the same Quest PDA.
- Same publisher and different `quest_id` derive different Quest PDA values.
- Different publishers can reuse the same `quest_id` without collision.

### Vault PDA

```text
[b"vault", quest.key().as_ref()]
```

Purpose: stores the quest reward lamports.

Each Quest PDA has one reward Vault PDA.

### Submission PDA

```text
[b"submission", quest.key().as_ref(), submitter.key().as_ref()]
```

Purpose: stores one submitter's proof for one quest.

This means one submitter can submit only once per quest in the current MVP.

### Fee Vault PDA

```text
[b"fee_vault"]
```

Purpose: receives platform fees from `create_quest` and `top_up_quest`.

The current version only supports receiving fees. There is no fee withdrawal instruction yet.

### Public Goods Pool PDA

```text
[b"public_goods_pool"]
```

Purpose: receives remaining quest rewards when a publisher cancels before expiry.

The current version only supports receiving funds. There is no withdrawal or governance instruction yet.

## State Machine

### Open

The quest is active.

Allowed actions:

- `submit_proof`, if not expired
- `approve_submission`, if not expired and a pending submission exists
- `top_up_quest`
- `cancel_quest`

### Approved

One submission has been approved.

Allowed actions:

- `claim_reward` by the approved submitter

Not allowed:

- `submit_proof`
- `approve_submission`
- `cancel_quest`
- `top_up_quest`

Reason: once a winner is approved, the publisher should not be able to take or redirect the reward.

### Completed

The approved submitter has claimed the reward.

This is a terminal state.

No further submit, approve, cancel, top-up, or claim actions are allowed.

### Cancelled

The publisher has cancelled the quest.

This is a terminal state.

No further submit, approve, cancel, top-up, or claim actions are allowed.

## Fee Rules

Fee rate:

```text
2% = 200 basis points
```

Formula:

```text
fee = amount * 200 / 10_000
```

Rules:

- `create_quest` charges 2% on `reward_amount`.
- `top_up_quest` charges 2% on `top_up_amount`.
- Fees are not deducted from the reward.
- The publisher pays the reward and the fee separately.

Example:

```text
reward_amount = 1 SOL
quest vault receives 1 SOL
fee vault receives 0.02 SOL
publisher pays 1.02 SOL plus transaction and rent costs
```

## Instruction Details

## `create_quest`

Purpose:

Create a new Quest PDA, lock the initial reward, set the quest deadline, and collect the platform fee.

Inputs:

- `quest_id: u64`
- `metadata_uri: String`
- `reviewer: Pubkey`
- `reward_amount: u64`
- `duration_seconds: u64`

Accounts:

- `quest`: initialized Quest PDA
- `vault`: reward Vault PDA
- `fee_vault`: global Fee Vault PDA
- `publisher`: signer and payer
- `system_program`

Permission checks:

- `publisher` must sign.

Validation:

- `metadata_uri.len() <= MAX_METADATA_URI_LEN`
- `reward_amount >= MIN_REWARD_AMOUNT`
- `duration_seconds >= MIN_QUEST_DURATION_SECONDS`, currently 1 minute
- fee calculation must not overflow
- `expires_at = Clock::get()?.unix_timestamp + duration_seconds`

State changes:

- `quest_id` is stored.
- `publisher` is stored.
- `reviewer` is stored.
- `reward_amount` is stored.
- `total_funded_amount = reward_amount`
- `total_fee_paid = fee_amount`
- `created_at = Clock now`
- `expires_at = created_at + duration_seconds`
- `cancelled_at = 0`
- `status = Open`
- `approved_submitter = None`
- `submission_count = 0`
- `reward_claimed = false`
- PDA bumps are stored.
- `metadata_uri` is stored.

Fund flow:

```text
publisher -> quest vault: reward_amount
publisher -> fee vault: reward_amount * 2%
```

## `submit_proof`

Purpose:

Create a Submission PDA for a submitter's proof URI.

Inputs:

- `proof_uri: String`

Accounts:

- `quest`: existing Quest account
- `submission`: initialized Submission PDA
- `submitter`: signer and payer
- `system_program`

Permission checks:

- `submitter` must sign.

Validation:

- Quest must be `Open`.
- Quest must not be expired.
- `proof_uri.len() <= MAX_PROOF_URI_LEN`
- Submission PDA must not already exist.

State changes:

- Creates the Submission account.
- `submission.quest = quest`
- `submission.submitter = submitter`
- `submission.status = Pending`
- `submission.submitted_at = Clock now`
- `submission.reviewed_at = 0`
- `submission.proof_uri = proof_uri`
- `quest.submission_count += 1`

Fund flow:

- No reward movement.
- Submitter pays rent for the Submission account.

## `approve_submission`

Purpose:

Approve a pending submission and mark the quest as ready for reward claim.

Inputs:

- None.

Accounts:

- `quest`: existing Quest account
- `submission`: existing Submission account
- `reviewer`: signer

Permission checks:

- Signer must be `quest.reviewer` or `quest.publisher`.

Validation:

- Quest must be `Open` or `InReview`.
- Quest must not be expired.
- Submission must be `Pending`.
- Submission must belong to the provided Quest.
- Quest reward must not be claimed.
- Quest must not already have an approved submitter.

State changes:

- `submission.status = Approved`
- `submission.reviewed_at = Clock now`
- `quest.status = Approved`
- `quest.approved_submitter = Some(submission.submitter)`

Fund flow:

- No fund movement.

## `claim_reward`

Purpose:

Let the approved submitter claim the locked reward from the quest vault.

Inputs:

- None.

Accounts:

- `quest`: existing Quest account
- `submission`: existing Submission account
- `vault`: reward Vault PDA
- `submitter`: signer
- `system_program`

Permission checks:

- `submitter` must sign.
- `submitter` must be the approved submitter.

Validation:

- Quest must be `Approved`.
- Submission must be `Approved`.
- Submission must belong to the provided Quest.
- Submission submitter must equal the signer.
- `quest.approved_submitter` must equal the signer.
- `quest.reward_claimed` must be false.
- Vault balance must be at least `quest.reward_amount`.

State changes:

- `quest.reward_claimed = true`
- `quest.status = Completed`

Fund flow:

```text
quest vault -> approved submitter: quest.reward_amount
```

The Vault PDA signs with:

```text
[b"vault", quest.key().as_ref(), &[quest.vault_bump]]
```

Expiry note:

`claim_reward` does not block on expiry. Once a submission is approved, the approved submitter should still be able to claim.

## `top_up_quest`

Purpose:

Let the publisher add more reward and optionally extend the deadline.

Inputs:

- `top_up_amount: u64`
- `extend_duration_seconds: u64`

Accounts:

- `quest`: existing Quest account
- `vault`: reward Vault PDA
- `fee_vault`: global Fee Vault PDA
- `publisher`: signer
- `system_program`

Permission checks:

- Signer must be `quest.publisher`.

Validation:

- Quest must be `Open` or `InReview`.
- Quest must not be `Approved`.
- Quest must not be `Completed`.
- Quest must not be `Cancelled`.
- `quest.reward_claimed` must be false.
- `top_up_amount >= MIN_TOP_UP_AMOUNT`
- fee calculation must not overflow.
- New deadline must not be earlier than the old deadline.
- If the quest is already expired, the extension must push `expires_at` after current Solana Clock time.

State changes:

- `quest.reward_amount += top_up_amount`
- `quest.total_funded_amount += top_up_amount`
- `quest.total_fee_paid += fee_amount`
- `quest.expires_at += extend_duration_seconds`

Fund flow:

```text
publisher -> quest vault: top_up_amount
publisher -> fee vault: top_up_amount * 2%
```

## `cancel_quest`

Purpose:

Let the publisher cancel an unapproved, unfinished quest and route the remaining reward according to expiry.

Inputs:

- None.

Accounts:

- `quest`: existing Quest account
- `vault`: reward Vault PDA
- `public_goods_pool`: Public Goods Pool PDA
- `publisher`: signer
- `system_program`

Permission checks:

- Signer must be `quest.publisher`.

Validation:

- Quest must not be `Approved`.
- Quest must not be `Completed`.
- Quest must not be `Cancelled`.
- Quest must be `Open` or `InReview`.
- `quest.reward_claimed` must be false.

State changes:

- `quest.status = Cancelled`
- `quest.cancelled_at = Clock now`

Fund flow:

If current Solana Clock time is before or equal to `expires_at`:

```text
quest vault -> public goods pool: remaining vault balance
```

If current Solana Clock time is after `expires_at`:

```text
quest vault -> publisher: remaining vault balance
```

The Vault PDA signs with:

```text
[b"vault", quest.key().as_ref(), &[quest.vault_bump]]
```

## Current Test Result

```text
26 passing
```

Covered areas include:

- Quest creation
- Fee vault collection on create
- Minimum duration validation
- Proof submission
- Submission approval
- Reward claim
- Top-up success and failure cases
- Cancellation before expiry into public goods pool
- Cancellation permission checks
- Approved, Completed, and Cancelled terminal behavior

## Current Limitations

- `fee_vault` only receives funds. There is no withdraw instruction yet.
- `public_goods_pool` only receives funds. There is no withdrawal or governance instruction yet.
- Automated post-expiry tests are limited by local validator time-warp support.
- The current protocol is single-winner mode.
- Proof data is represented as a URI or hash string.
- A submitter can submit only once per quest.
