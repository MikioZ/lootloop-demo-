# LootLoop Demo Script

## 1. Publisher creates a quest and locks SOL reward

The publisher calls `create_quest` with a `quest_id`, `metadata_uri`, reviewer Pubkey, and `reward_amount`.

The program creates a Quest PDA and derives a vault PDA from the Quest address. The publisher transfers the reward amount into the vault during the same instruction.

Demo point: the reward exists on-chain before anyone starts working.

## 2. Submitter submits proof URI

The submitter calls `submit_proof` with a proof URI, such as a GitHub pull request, IPFS link, Arweave link, or hash.

The program creates a Submission PDA derived from the Quest and submitter addresses. This MVP allows one submission per user per quest.

Demo point: the work proof is attached to the quest as verifiable on-chain state.

## 3. Reviewer approves submission

The reviewer, or the publisher, calls `approve_submission`.

The program checks that the signer is authorized, the Quest is in a reviewable state, and the Submission belongs to the Quest. Then it marks the Submission as approved and records the approved submitter on the Quest.

Demo point: approval is not just a private decision; it becomes part of the on-chain workflow.

## 4. Submitter claims reward

The approved submitter calls `claim_reward`.

The program checks that the Quest and Submission are approved, that the signer is the approved submitter, and that the reward has not already been claimed.

The vault PDA signs the SOL transfer using PDA signer seeds:

```rust
&[
    VAULT_SEED,
    quest.key().as_ref(),
    &[quest.vault_bump],
]
```

Demo point: the protocol, not a centralized operator, releases the reward according to transparent rules.

## 5. Vault balance becomes 0 and Quest becomes Completed

After `claim_reward`, the vault balance becomes `0`, `quest.reward_claimed` becomes `true`, and `quest.status` becomes `Completed`.

Demo point: the entire quest lifecycle is visible on-chain from reward locking to final payout.
