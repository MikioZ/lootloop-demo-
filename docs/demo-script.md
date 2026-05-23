# LootLoop Demo Script

## 0. Frontend navigation

Open the React devnet demo and start on `Dashboard`. Use `Refresh` to load Quest accounts from the program, then filter by Open, Closing, Closed, Manual, AutoVerified, OneTime, or Recurring. Use `View` to open `Quest Detail`, or copy a Quest PDA and paste it into any tool tab.

`Quest Detail` is the hub for a selected quest. It shows funding, queue, timing, verifier settings, and the connected wallet's `UserProgress`. The same selected Quest PDA is reused by `Submitter Tools`, `Reviewer Tools`, `Publisher Tools`, and `Protocol State`.

The app supports `/quest/:questPda` links for demos, but it remains a devnet demo UI rather than production software.

## 1. Publisher creates a quest and funds PDA pools

In `Create Quest`, the publisher calls `create_quest` with a `quest_id`, mode, metadata URI, reviewer Pubkey, reward per completion, initial reward funding, deposit amount, duration, period, and queue size.

The program creates the Quest PDA, derives a RewardPool PDA and DepositPool PDA, and collects a 2% fee into the FeeVault PDA. Reward funding and deposit funding must both be integer multiples of `reward_per_completion`, and the initial deposit must cover `(queue_max + 1)` full rewards.

The publisher also chooses a review mode:

- `Manual`: reviewer or publisher approves submissions.
- `AutoVerified`: the quest stores an `authorized_verifier`, a verification template type, a `template_config_hash`, and a schema/config URI.

Demo point: rewards and guarantees exist on-chain before anyone starts working.

## 2. Submitter submits proof URI

In `Submitter Tools`, the submitter calls `submit_proof` with a proof URI, such as a GitHub pull request, IPFS link, Arweave link, or hash.

The program creates a Submission PDA derived from the Quest and the next chain-enforced `submission_index`.

For a Recurring quest, the program computes the current cycle from Solana `Clock`:

```text
current_cycle_index = (now - quest.start_at) / quest.period_seconds
```

The user cannot pass a historical or future `cycle_index`. The proof is always for the current cycle. The on-chain `UserProgress` window records only the recent 32 cycles as empty/rejected, pending, or approved.

The UI shows the connected wallet's `UserProgress` PDA, OneTime completion flag, current cycle state, queue fullness, and whether the user can submit.

Demo point: the work proof is attached to an ordered on-chain review queue, and recurring eligibility is based only on current on-chain state.

## 3. Manual reviewer approves submission

In `Reviewer Tools`, the reviewer, or the publisher, loads `next_review_index` and calls `approve_submission`.

The program checks that the signer is authorized, the Quest is reviewable, the Submission belongs to the Quest, and the Submission index matches `next_review_index`.

If approved, the program automatically pays the submitter one full `reward_per_completion`. There is no `claim_reward` step and no `PartiallyPaid` status.

If the quest is `Open` and `reward_pool` has a full reward, payment comes from `reward_pool`. If `reward_pool` cannot pay one full reward, the quest enters irreversible `Closing` with `closing_reason = RewardPoolDepleted`, and the current approval is paid fully from `deposit_pool`. While `Closing`, approved pending submissions are also paid fully from `deposit_pool`.

Demo point: approval is not just a private decision; it is also the payout event.

## 3b. AutoVerified verifier approves submission

Auto-Review v1 is a signature simulation flow. The Solana program does not read Strava, Garmin, GitHub, or study-platform APIs.

The off-chain verifier reads the external data, decides whether the proof passes, then signs a `LootLoopAutoReviewV1` verification result bound to:

- program id
- quest
- submission index
- submitter
- cycle index
- template type
- template config hash
- external proof hash
- verified_at
- expiry
- nonce

For AutoVerified quests, `Reviewer Tools` hides manual approve and shows the Auto Approve panel. The operator pastes a verifier-server signature; real verifier private keys must not be hardcoded in the frontend.

The transaction order is optional ComputeBudget instructions, then a native Ed25519 verification instruction, then `auto_approve_submission`. The Ed25519 instruction must be immediately before auto approval. The LootLoop program reads the instructions sysvar, confirms the signer is `authorized_verifier`, confirms the signed Borsh message matches the provided result, enforces a maximum 3600-second verification TTL, checks the quest-scoped `UsedProof` PDA does not already exist, and then runs the same approve-and-pay logic as manual approval.

On success, LootLoop creates `[b"used_proof", quest, external_proof_hash]`. That prevents the same external proof from being used twice in one quest, even by another submitter. Different quests can still reuse the same hash, so the verifier service should keep its own replay checks.

Demo point: automatic approval is still queue-ordered and still pays from PDA pools; only the completion judgment is delegated to a signed off-chain verifier.

## 4. Reviewer can reject to release the queue slot

The reviewer can call `reject_submission` for the current `next_review_index`.

The Submission becomes `Rejected`, `pending_count` decreases, and the same user can resubmit later with a new Submission index. For Recurring quests, rejection clears the current cycle's pending state; approval marks that cycle approved and fully paid, blocking another proof in the same cycle.

Demo point: the queue cannot be clogged forever by rejected proof.

## 5. Publisher can close and settle

In `Publisher Tools`, the publisher can call `fund_quest`, `close_quest`, and `settle_quest`.

Funding shows the 2% fee and validates that reward funding and additional deposit are integer multiples of `reward_per_completion`. Fund is only enabled while the quest is `Open`.

The publisher calls `close_quest`.

If there are pending submissions, the Quest enters `Closing` and no longer accepts new submissions. `fund_quest` is disabled once the quest is `Closing`; the state cannot return to `Open`. After pending submissions are reviewed, `settle_quest` distributes remaining funds by `closing_reason`:

- Early manual close or reward-pool depletion: remaining reward goes to `public_goods_pool`; remaining deposit pays 1% fee and then goes to `public_goods_pool`.
- Expired close: remaining reward and deposit return to publisher.

Demo point: the entire quest lifecycle is visible on-chain from funding to ordered review to settlement.

## 6. Local long-term recurring history

The chain intentionally stores only the recent 32-cycle `UserProgress` window. A client or indexer may keep longer history for UX:

- quest address
- cycle index
- proof URI
- submitted and reviewed timestamps
- result
- reward amount
- transaction signature

These off-chain records are for display, search, and stats only. They are not protocol credentials and cannot affect submission eligibility, reward payment, review order, or settlement.

Roadmap items include `PeriodProgress` PDA, `UserCycle` PDA, an off-chain indexer, and verifiable long-term history queries.

## 7. Auto-Review roadmap

Current MVP limitations:

- no real Strava, Garmin, GitHub, or study platform adapter
- no verifier registry
- no multi-verifier threshold
- no global `UsedProof` registry
- replay prevention beyond a single quest remains verifier-side

Future work:

- global `UsedProof` option
- verifier registry
- key rotation
- multi-verifier threshold
- Strava adapter
- GitHub adapter
- study platform adapter
- TEE / ZK proof based verifier
