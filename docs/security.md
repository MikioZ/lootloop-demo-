# LootLoop Security Notes

## Protocol Invariants

- `pending_count <= queue_max`
- `next_review_index <= next_submission_index`
- Submissions must be reviewed in FIFO order.
- `Approved` means full payment completed.
- There is no partial payment state.
- `Closing` is irreversible.
- `Closed` is terminal.
- `fund_quest` is only allowed in `Open`.
- `submit_proof` is only allowed in `Open`.
- AutoVerified approval must verify the authorized verifier signature.
- Quest-scoped `UsedProof` prevents the same `external_proof_hash` from being reused within a Quest.

## Trust Boundaries

### On-Chain Program Trusts

- PDA derivations and account ownership.
- Solana Clock for timing.
- Quest state and counters.
- Instruction sysvar checks for the immediately previous Ed25519 verification instruction.
- Borsh serialization of `VerificationResult`.
- On-chain `UserProgress`, `Submission`, and `UsedProof` state.

### Verifier Responsibilities

The verifier is responsible for off-chain truth:

- Reading Strava, Garmin, GitHub, study, attendance, or custom data.
- Determining whether a user completed the task.
- Generating a signed `VerificationResult`.
- Preventing verifier-side replay for `external_proof_hash` and `nonce`.
- Protecting verifier private keys.

### Frontend Is Not Trusted

The frontend is a convenience layer. It can derive PDAs, estimate fees, and disable buttons, but all protocol rules must be enforced on-chain.

### Off-Chain History Is Not Trusted

Local client history, localStorage, IndexedDB, and indexer records are useful for display and analytics only. They are not accepted as protocol evidence for submit eligibility, review order, reward payment, settlement, or restoring user status.

## Known Risks

- Verifier key compromise could allow fraudulent AutoVerified approvals.
- External API data can be manipulated or interpreted incorrectly.
- No verifier registry yet.
- No verifier key rotation yet.
- No multi-verifier threshold yet.
- `UsedProof` is quest-scoped and does not deduplicate proofs globally.
- No real external API adapter has been implemented yet.
- Direct account fetching in the frontend is not scalable for a large production deployment.
- Protocol has not been externally audited.

## Future Mitigations

- Verifier registry with explicit trust policy.
- Key rotation and revocation.
- Multi-verifier threshold approval.
- Optional global `UsedProof` registry.
- Indexer for quests, submissions, used proofs, and user history.
- Formal audit checklist.
- External security audit.
- Bug bounty before production use.
