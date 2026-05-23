# LootLoop Demo Walkthrough

This walkthrough works for localnet testing or a devnet demo deployment. The frontend is configured for devnet by default; Anchor tests should use localnet.

## 1. Start Local Validator Or Use Devnet

For local tests:

```bash
anchor test --provider.cluster localnet
```

For a devnet demo, make sure the configured wallet and upgrade authority have SOL.

## 2. Build And Deploy

```bash
yarn install
anchor build
```

Deploy or upgrade only when you intentionally want to update the devnet program.

## 3. Start Frontend

```bash
cd app
npm install
npm run dev
```

Open the local Vite URL and connect a Solana wallet.

## 4. Create Manual OneTime Quest

Open `Create Quest`.

- Set `mode = OneTime`.
- Set `review_mode = Manual`.
- Enter `quest_id`, `metadata_uri`, reviewer, reward amount, reward funding, deposit, queue size, and duration.
- Confirm `deposit_required` and 2% fee.
- Create the quest.

The UI displays the Quest PDA, RewardPool PDA, DepositPool PDA, and share link.

## 5. Submit Proof

Open `Submitter Tools`.

- Load the Quest PDA.
- Enter a proof URI.
- Submit proof.

The UI shows the created Submission PDA and pending status.

## 6. Manual Approve

Open `Reviewer Tools`.

- Load the Quest PDA.
- The UI fetches `next_review_index`.
- Review the proof URI.
- Click `Approve`.

## 7. Verify Automatic Reward Payment

Open `Quest Detail` or `Protocol State`.

Check:

- `total_paid_amount`
- `total_approved`
- `reward_pool` balance decreased
- Submission status is `Approved`

The submitter does not call `claim_reward`; approval paid automatically.

## 8. Create AutoVerified Recurring Quest

Open `Create Quest`.

- Set `mode = Recurring`.
- Set a positive recurring period.
- Set `review_mode = AutoVerified`.
- Choose a verification template.
- Enter `authorized_verifier`, `template_config_hash`, and `verification_schema_uri`.
- Create the quest.

## 9. Submit Proof

Open `Submitter Tools`.

- Load the AutoVerified quest.
- Submit proof URI.
- Note the current cycle index shown by the UI.

The user cannot enter a historical or future cycle.

## 10. Generate Mock Verifier Signature

Auto-Review v1 expects an off-chain verifier to sign the Borsh-serialized `VerificationResult`.

The signed result must bind:

- domain
- program id
- quest
- submission index
- submitter
- cycle index
- template type
- template config hash
- external proof hash
- verified value
- pass result
- `verified_at`
- `expires_at`
- nonce

Do not put a real verifier private key in the frontend. Use a local script or verifier server to generate the signature, then paste it into the Auto Approve panel.

## 11. Auto Approve

Open `Reviewer Tools`.

- Load the AutoVerified quest.
- Confirm the pending submission.
- Enter `verified_value`, `external_proof_hash`, `verified_at`, `expires_at`, nonce, and verifier signature.
- Click `Auto Approve`.

The transaction includes the native Ed25519 verification instruction immediately before `auto_approve_submission`.

## 12. Verify UsedProof

After successful Auto Approve, a UsedProof PDA is created:

```text
[b"used_proof", quest, external_proof_hash]
```

This records the quest, external proof hash, submission index, submitter, cycle index, and used timestamp.

## 13. Demonstrate Duplicate external_proof_hash Failure

Submit another proof under the same quest.

Try to auto approve using the same `external_proof_hash`.

Expected result:

```text
This external proof has already been used for this quest.
```

The same hash may be used in a different quest because the MVP replay protection is quest-scoped.

## 14. Demonstrate reward_pool Depletion -> Closing

Create a quest with enough deposit but limited reward funding.

Submit multiple proofs and approve them until the reward pool cannot pay one full reward.

Expected result:

- Quest enters `Closing`.
- `closing_reason = RewardPoolDepleted`.
- New submissions are disabled.
- Pending approvals continue from `deposit_pool`.

## 15. Demonstrate Settle

After `pending_count == 0`, open `Publisher Tools`.

- For reward depletion or early manual close, settlement routes remaining reward and deposit to public goods paths.
- For expired close, settlement refunds remaining reward and deposit to publisher.

Click `Settle Quest` and verify the final state is `Closed`.
