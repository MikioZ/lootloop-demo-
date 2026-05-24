# LootLoop Threat Model / Audit Checklist

## 1. Protocol Overview

LootLoop is a Solana on-chain quest reward settlement protocol.

At a high level:

- A publisher creates a quest and funds `reward_pool` and `deposit_pool` PDAs.
- Users submit proof URIs into an ordered on-chain submission queue.
- A reviewer or verifier approves or rejects each submission.
- Approval automatically pays the full `reward_per_completion`.
- If `reward_pool` cannot pay one full reward, the quest enters irreversible `Closing`.
- Pending submissions are protected by `deposit_pool` and remain reviewable in FIFO order.
- AutoVerified quests use an authorized verifier's Ed25519 signature over a bound `VerificationResult`.
- A quest-scoped `UsedProof` PDA prevents the same `external_proof_hash` from being successfully reused within the same Quest.

The protocol goal is not to prove all real-world work on-chain. It is to make funding, review order, settlement, and verifier-signed approval transparent and enforceable by the program.

## 2. Assets

| Asset | Why it matters | Who may attack | Impact if compromised |
| --- | --- | --- | --- |
| `reward_pool` funds | Normal reward funding for approved submissions. | Publisher, malicious reviewer, malicious submitter, wrong PDA caller, program bug. | Rewards stolen, paid to wrong account, or incorrectly routed during settlement. |
| `deposit_pool` funds | Guarantee backing for pending approved submissions. | Publisher, malicious submitter, settlement bug, wrong PDA caller. | Full-payment invariant fails; submitters lose expected reward protection. |
| `fee_vault` funds | Holds protocol fees and early-close cancellation fees. | Future admin/governance, wrong PDA caller, program bug. | Protocol revenue loss or governance dispute. |
| `public_goods_pool` funds | Receives early-close and reward-depletion residual funds. | Publisher seeking refund, future governance, program bug. | Public goods funds misrouted or locked without governance clarity. |
| Submitter reward entitlement | Approved submissions should receive exactly one full reward. | Publisher, reviewer, verifier, malicious competing submitter. | Users do work without receiving guaranteed payment. |
| Quest state integrity | Status, counters, closing reason, and totals drive all protocol behavior. | Any caller with malformed accounts, program bug, stale frontend. | Invalid state transitions, incorrect settlement, broken queue. |
| Submission queue order | FIFO review protects fairness and prevents selective approval. | Reviewer, publisher, malicious submitter, frontend. | Later submissions approved before earlier ones; pending users bypassed. |
| UserProgress correctness | Prevents duplicate OneTime completion and same-cycle Recurring submissions. | Submitter, stale client, program bug. | Queue spam, duplicate rewards, or false blocking of legitimate users. |
| Verifier signing authority | AutoVerified approval trusts the configured verifier key. | Compromised verifier, malicious publisher, leaked private key. | Fraudulent auto approvals and payouts. |
| UsedProof replay protection | Prevents one external proof from paying repeatedly within a Quest. | Submitter, verifier service bug, replay attacker. | Duplicate payout for same off-chain proof. |
| Frontend user clarity / anti-misoperation | Users must understand quest status, fees, Closing, and verifier signature flow. | Stale UI, malicious fork, wallet/network mismatch. | Users sign wrong transaction or misunderstand guarantees. |

## 3. Actors

| Actor | Permissions | Trust level | Possible malicious behavior |
| --- | --- | --- | --- |
| Publisher | Creates quests, funds Open quests, closes quests, receives expired refunds. | Partially trusted for configuration, not trusted to override protocol rules. | Underfund rewards, close early, set bad verifier/reviewer, choose risky queue size. |
| Submitter | Submits proof while quest is Open; receives rewards if approved. | Untrusted. | Duplicate proofs, replay external proof hash, spam queue, use stale/off-chain history as false evidence. |
| Reviewer | Manual approve/reject; reject AutoVerified pending submissions. | Trusted role but may be malicious or negligent. | Reject valid submissions, attempt out-of-order review, approve invalid proof in Manual mode. |
| Authorized Verifier | Signs AutoVerified `VerificationResult`. | Trusted for off-chain truth under one quest. | Sign incorrect result, reuse proof hash, leak key, sign with excessive TTL. |
| Frontend Client | Derives PDAs, displays state, builds transactions. | Untrusted convenience layer. | Pass wrong PDAs, hide warnings, display stale state, build incorrect transactions. |
| Off-chain Verifier Service | Reads external APIs and signs results. | Trusted only if signature matches `authorized_verifier`; still outside chain. | Misread API data, accept manipulated data, fail replay prevention, leak private key. |
| Protocol / Program | Enforces on-chain state transitions and fund transfers. | Trusted code after audit and correct deployment. | Bugs can break invariants or route funds incorrectly. |
| Future Admin / Governance | May later control vault withdrawals or verifier registry. | Not implemented yet; future trusted role. | Governance capture, unsafe upgrades, wrong treasury withdrawal. |
| Malicious User | Any public caller. | Untrusted. | Account substitution, replay, queue spam, wrong instruction ordering, stale state exploitation. |
| Compromised Verifier | Attacker controlling verifier private key. | High-risk adversary. | Validly signs fraudulent AutoVerified approvals until key is rotated or quest is closed. |

## 4. Trust Boundaries

### On-chain program trusts

- Transaction signers.
- PDA seeds and bumps.
- Anchor account constraints.
- Native Ed25519 verification instruction execution and instructions sysvar parsing.
- Solana `Clock` sysvar.
- On-chain account state owned by the program.

### On-chain program does not trust

- Frontend UI.
- User input.
- `proof_uri` contents.
- Off-chain local history.
- External API data directly.
- Verifier server responses unless the signature matches `quest.authorized_verifier` and the signed message matches the provided `VerificationResult`.

### Auto-Review boundary

- The verifier is responsible for deciding whether external data is real and sufficient.
- The chain verifies only signer authority, message binding, expiration, TTL, FIFO order, and UsedProof uniqueness.
- `UsedProof` is quest-scoped replay protection, not global proof deduplication.
- `external_proof_hash` semantics are defined by the verifier/template pair, not by the on-chain program.

## 5. Core Invariants

| Invariant | Why it matters | Where enforced | Which test should cover it | Remaining risk |
| --- | --- | --- | --- | --- |
| `pending_count <= queue_max` | Bounds queue liability and deposit risk. | `submit_proof` queue check; approve/reject decrement. | Queue full test; reject release test. | Large queue choices can still be capital inefficient. |
| `next_review_index <= next_submission_index` | Prevents reviewing nonexistent future submissions. | Submission PDA derivation and FIFO checks. | FIFO review tests; settle review-index test. | Future instructions must preserve index monotonicity. |
| Submissions reviewed in FIFO order | Review order must not be controlled off-chain. | `submission.submission_index == quest.next_review_index`. | Manual, AutoVerified, and reject out-of-order tests. | Stale UI can confuse users but cannot bypass chain check. |
| `Approved` means full `reward_per_completion` paid | Status must imply payment completed. | `approve_and_pay_submission`; no partial status. | Reward pool payment, deposit fallback, Closing payment tests. | Deposit pool invariant must remain intact. |
| No partial payment | Prevents ambiguous submitter entitlement. | No `PartiallyPaid`; approval fails if deposit cannot pay. | Full-payment tests; insufficient-deposit invariant tests. | Unexpected lamport movement could break assumptions. |
| `submit_proof` only allowed in `Open` | Closing must stop new work. | `submit_proof` status check. | Closing/Closed submit rejection tests. | Frontend must refresh stale status. |
| `fund_quest` only allowed in `Open` | Closing must not be reversible. | `fund_quest` status check. | Fund-after-Closing tests. | Publisher cannot repair after accidental close. |
| `Closing` is irreversible | Settlement phase must be predictable. | No instruction restores `Open`. | Fund-after-Closing; submit-after-Closing tests. | Future instructions must not add reopening without redesign. |
| `Closed` is terminal | Prevents post-settlement mutation. | Instruction status checks. | Closed-state rejection tests. | Future instructions must preserve terminal semantics. |
| Reward pool depletion triggers `Closing` | Underfunding stops new submissions while pending remains protected. | `approve_and_pay_submission`. | Reward depletion tests. | Incorrect balance reading or PDA mismatch would be critical. |
| Closing approvals paid only from `deposit_pool` | Pending submissions remain guaranteed after reward depletion/close. | `approve_and_pay_submission`. | Closing auto/manual deposit payment tests. | Deposit pool must retain enough lamports. |
| `settle_quest` requires `pending_count == 0` | Prevents closing before pending users are handled. | `settle_quest` checks. | Pending settlement rejection tests. | Counter mismatch bugs would be critical. |
| `settle_quest` requires `next_review_index == next_submission_index` | Prevents unreviewed queued submissions from being skipped. | `settle_quest` checks. | Unreviewed submissions remaining tests. | Index corruption would be critical. |
| AutoVerified requires valid verifier signature | Prevents arbitrary users from auto approving. | Ed25519 instruction parsing, signer/message checks. | Wrong signer, tamper, missing/non-adjacent Ed25519 tests. | Verifier key compromise remains high risk. |
| AutoVerified signature binds quest / submitter / submission_index / cycle_index / template_config_hash | Prevents cross-context replay. | `VerificationResult` field checks. | Wrong quest, submitter, index, cycle, template hash tests. | Binding does not prove external data truth. |
| UsedProof prevents same `external_proof_hash` reuse in same Quest | Blocks repeated payout from same external proof. | `UsedProof` PDA `init` with quest/hash seed. | UsedProof replay tests. | Not global across quests. |
| Recurring current cycle only; no historical backfill | Avoids stale proof games and simple cycle replay. | Cycle computed from `Clock`; no cycle arg. | Current-cycle and duplicate-cycle tests. | 32-cycle window intentionally drops old protocol history. |
| OneTime approve prevents future submissions by same user | Ensures one-time tasks remain one-time. | `UserProgress.one_time_completed`. | OneTime duplicate-after-approve test. | Account corruption would affect eligibility. |

## 6. Attack Scenarios

| Attack | Impact | Current mitigation | Remaining risk | Future mitigation |
| --- | --- | --- | --- | --- |
| Publisher underfunds `reward_pool` | New work could enter when reward pool is low. | Required deposit; reward depletion triggers `Closing`; pending approvals paid from deposit. | Publisher capital planning still matters. | Better frontend warnings and funding health dashboards. |
| Publisher closes early to avoid paying | Submitters may lose chance to submit new proof. | Pending submissions remain reviewable; EarlyManual settlement penalizes residual deposit. | Valid future work cannot enter after close. | Reputation layer and publisher analytics. |
| Publisher tries to settle before pending reviewed | Pending submitters could be skipped. | `pending_count == 0` and review index catch-up required. | Counter corruption would be critical. | Formal verification or invariant tests. |
| Submitter submits duplicate proof in same cycle | Queue spam and duplicate rewards. | `UserProgress` current cycle pending/approved states. | Rejected proof can resubmit by design. | Per-template proof quality checks. |
| Submitter reuses same external proof hash | Multiple rewards for same external proof. | Quest-scoped `UsedProof`. | Reuse across quests allowed. | Global UsedProof option after semantics are defined. |
| Submitter tries to skip queue | Later submission approved first. | FIFO `next_review_index` check. | None if indices are intact. | Queue index monitoring in indexer. |
| Reviewer tries to approve out of order | Selective or unfair review. | FIFO check. | Reviewer can still reject valid first submission. | Appeal/reputation layer. |
| Reviewer rejects valid submissions maliciously | Submitter loses reward despite valid proof. | Rejection is transparent and frees retry state. | Protocol cannot judge Manual proof truth. | Multi-reviewer, disputes, staking, reputation. |
| AutoVerified signature replay across submissions | Same signed result pays another submission. | Signature binds submission index, submitter, cycle, quest. | None for bound fields. | Continue expanding signature tests for future fields. |
| AutoVerified signature replay across quests | Same signed result pays another quest. | Signature binds quest and program id. | Same external proof hash can be used in different quest with new valid signature. | Global UsedProof if product requires cross-quest uniqueness. |
| Wrong verifier signs proof | Unauthorized auto approval. | Signer pubkey must equal `quest.authorized_verifier`. | None unless authorized verifier is compromised. | Verifier registry and key rotation. |
| Verifier key compromised | Fraudulent AutoVerified approvals. | None after valid signature except quest closure/reviewer rejection. | Critical until key rotation exists. | Registry, revocation, rotation, threshold verification. |
| `VerificationResult.expires_at` too long | Old signatures remain usable. | TTL capped by `MAX_VERIFICATION_TTL_SECONDS`. | One hour still may be long for some templates. | Template-specific TTL policies. |
| `VerificationResult` from future | Pre-signed future claims. | `verified_at <= now`. | Chain clock granularity. | Conservative frontend/verifier timestamp policy. |
| Frontend passes wrong PDA | Account substitution or failed tx. | Anchor PDA seeds and ownership constraints. | User confusion from errors. | Better UI validation and simulation messages. |
| `UsedProof` PDA already exists | Replay attempt. | Anchor `init` fails; frontend maps to readable error. | Error shape may differ by wallet/RPC. | Custom preflight lookup and clearer logs. |
| Closing task accepts new submissions | New users enter unsupported liability state. | `submit_proof` requires `Open`. | Stale frontend button state. | Real-time indexer updates. |
| Closing task funded and reopened | Publisher reverses settlement state. | `fund_quest` requires `Open`; no reopen instruction. | None unless future instruction adds reopen. | Explicit governance review for lifecycle changes. |
| Recurring 32-cycle window overwrite edge case | User duplicate state could be lost incorrectly. | Window only guards current/recent cycles; current cycle is chain-computed. | Long-term history not on-chain. | `UserCycle` or `PeriodProgress` PDA if needed. |
| Off-chain local history used as false evidence | User claims eligibility from local data. | Protocol ignores local history. | UI/social disputes. | Signed indexer attestations for display only, not settlement. |
| Devnet/mainnet/program ID mismatch | Wrong program or wrong IDL transactions. | Program id in signature; frontend constant; Anchor IDL. | Human deployment mistakes. | Environment banners and deployment checklist. |
| Fee vault / public goods pool withdrawal governance not implemented | Funds accumulate without policy. | No withdrawal instruction means no direct drain. | Funds locked; future governance risk. | Treasury/governance design before mainnet. |

## 7. Auto-Review Specific Risks

Auto-Review v1 is a mock verifier signature flow. It is not yet a complete real-world external data verification system.

| Risk | Analysis | Current status | Future mitigation |
| --- | --- | --- | --- |
| Verifier key compromise | A stolen key can sign valid `VerificationResult` messages. | No registry or rotation yet. | Verifier registry, revocation, key rotation, threshold signatures. |
| Verifier service signs incorrect results | The chain cannot tell whether off-chain judgment was correct. | Verifier is trusted for data truth. | Auditable verifier logs, dispute process, multi-verifier threshold. |
| External API manipulation | API data may be spoofed, delayed, edited, or unavailable. | No real API adapters yet. | Adapter-specific validation, source-specific risk controls. |
| Manual data entry in fitness platforms | Fitness platforms may allow manual workouts. | Not handled by chain. | Adapter policy: reject manual entries or require trusted device source. |
| GitHub proof reuse | Same PR/commit/activity could be submitted repeatedly. | Quest-scoped `UsedProof` if hash is defined consistently. | GitHub adapter defines canonical proof hash and global dedup if needed. |
| Strava/Garmin privacy risks | Fitness proof may expose sensitive location or health data. | Not integrated yet. | Minimal proof hashes, privacy-preserving verifier, user consent design. |
| UsedProof only Quest-scoped | Same proof can be reused across quests with a new valid signature. | By design for MVP. | Optional global UsedProof after product semantics are decided. |
| No verifier registry yet | Each quest stores one verifier key directly. | MVP only. | Registry with allowed templates, metadata, rotation, and reputation. |
| No key rotation yet | Compromised verifier cannot be rotated for existing quests. | MVP only. | Quest/verifier registry design with revocation and replacement. |
| No multi-verifier threshold yet | One verifier is a single point of trust. | MVP only. | Threshold verifier signatures or quorum approval. |

## 8. Economic Risks

| Risk | Analysis |
| --- | --- |
| `reward_per_completion` too small | Rewards may be lower than user effort or transaction costs. |
| Fee too small compared with transaction cost | Protocol fee is economic policy, not necessarily enough to operate infrastructure. |
| `public_goods_pool` funds locked | Funds are intentionally received but no governance/withdrawal exists yet. |
| `fee_vault` withdrawal not implemented | Fees accumulate without treasury operations. |
| `deposit_pool` overcollateralization | `(queue_max + 1) * reward` improves safety but ties up publisher capital. |
| Publisher capital inefficiency | Long-running quests may require large deposits and repeated funding. |
| `queue_max` too large | Increases required deposit and potential pending liabilities. |
| Rent cost for many PDA accounts | Quest, Submission, UserProgress, and UsedProof accounts all require rent. |

## 9. Operational Risks

| Risk | Analysis |
| --- | --- |
| Devnet instability | Devnet RPC, airdrops, and deployed programs are unreliable for production assumptions. |
| RPC failures | Direct frontend reads can fail or return stale data. |
| Frontend wallet network mismatch | User may connect a wallet on the wrong cluster or interact with the wrong deployment. |
| Program upgrade authority risk | Upgrade authority can change code until governance/immutability is established. |
| IDL mismatch | Frontend may send wrong accounts/args if IDL is stale. |
| Indexer not implemented | Direct `program.account.quest.all()` does not scale. |
| Quest List direct account fetch | Fine for demo, risky for production UX/performance. |
| Large frontend bundle | Wallet and crypto dependencies make the app bundle large. |

## 10. Audit Checklist

### A. Account Validation

- [ ] Verify every instruction checks account ownership and intended relationships.
  - Risk: account substitution.
  - Relevant files: `programs/lootloop/src/instructions/*.rs`
  - Test coverage: wrong quest/submission and unauthorized tests.
- [ ] Confirm unchecked pool accounts are constrained by PDA seeds.
  - Risk: funds transferred from/to wrong account.
  - Relevant files: `approve_submission.rs`, `close_quest.rs`, `settle_quest.rs`, `fund_quest.rs`
  - Test coverage: fund/approve/settle flow tests.
- [ ] Confirm submitter account matches `submission.submitter` before payout.
  - Risk: payout theft.
  - Relevant files: `approve_submission.rs`
  - Test coverage: approve payout tests.

### B. PDA Seeds

- [ ] Confirm PDA seed constants match README/docs and frontend derivations.
  - Risk: IDL/frontend mismatch or wrong account creation.
  - Relevant files: `constants.rs`, `app/src/App.tsx`
  - Test coverage: create/submit/user progress/used proof tests.
- [ ] Confirm `UsedProof` seed includes quest and external proof hash.
  - Risk: replay protection scoped incorrectly.
  - Relevant files: `approve_submission.rs`, `state.rs`
  - Test coverage: same-quest replay and different-quest reuse tests.

### C. Signer Checks

- [ ] Publisher-only operations require publisher signer.
  - Risk: unauthorized fund/close.
  - Relevant files: `fund_quest.rs`, `close_quest.rs`
  - Test coverage: unauthorized reviewer and closed-state tests; add dedicated unauthorized publisher tests if missing.
- [ ] Manual approval requires reviewer or publisher.
  - Risk: arbitrary approval/rejection.
  - Relevant files: `approve_submission.rs`, `reject_submission.rs`
  - Test coverage: unauthorized reviewer tests.
- [ ] Auto approval caller does not replace verifier signature authority.
  - Risk: caller treated as verifier.
  - Relevant files: `approve_submission.rs`
  - Test coverage: wrong verifier signature tests.

### D. State Transitions

- [ ] Confirm `Open -> Closing -> Closed` only.
  - Risk: reopening or mutation after settlement.
  - Relevant files: `approve_submission.rs`, `close_quest.rs`, `settle_quest.rs`
  - Test coverage: Closing/Closed rejection tests.
- [ ] Confirm `closing_reason` is set once and drives settlement.
  - Risk: wrong fund routing.
  - Relevant files: `approve_submission.rs`, `close_quest.rs`, `settle_quest.rs`
  - Test coverage: reward depletion and expired close settlement tests.

### E. Fund Transfers

- [ ] All pool transfers use PDA signer seeds.
  - Risk: unauthorized or failed CPI transfers.
  - Relevant files: `approve_submission.rs`, `close_quest.rs`, `settle_quest.rs`
  - Test coverage: payout and settlement balance tests.
- [ ] Approved submissions always receive full `reward_per_completion`.
  - Risk: partial or underpayment.
  - Relevant files: `approve_submission.rs`
  - Test coverage: reward pool, deposit fallback, Closing payment tests.
- [ ] Protocol fees use checked math.
  - Risk: overflow or wrong fee.
  - Relevant files: `create_quest.rs`, `fund_quest.rs`
  - Test coverage: 2% fee tests.

### F. Review Queue

- [ ] All approve/reject paths require `submission_index == next_review_index`.
  - Risk: queue bypass.
  - Relevant files: `approve_submission.rs`, `reject_submission.rs`
  - Test coverage: FIFO tests.
- [ ] Approve/reject advances `next_review_index` exactly once.
  - Risk: stuck queue or skipped submissions.
  - Relevant files: `approve_submission.rs`, `reject_submission.rs`
  - Test coverage: reject and approve counter tests.

### G. Recurring Logic

- [ ] Recurring cycle is computed from `Clock`, not user input.
  - Risk: historical/future proof submission.
  - Relevant files: `submit_proof.rs`
  - Test coverage: no cycle arg and current-cycle tests.
- [ ] Pending and approved states block duplicate current-cycle submissions.
  - Risk: duplicate rewards or queue spam.
  - Relevant files: `state.rs`, `submit_proof.rs`, `approve_submission.rs`, `reject_submission.rs`
  - Test coverage: duplicate, approve block, reject resubmit tests.

### H. Auto-Review Signature Verification

- [ ] Ed25519 instruction must be immediately previous.
  - Risk: signature confusion or wrong instruction parsing.
  - Relevant files: `approve_submission.rs`
  - Test coverage: missing, non-adjacent, previous-other-program tests.
- [ ] Signed message equals Borsh-serialized `VerificationResult`.
  - Risk: verifier signs one thing while program approves another.
  - Relevant files: `approve_submission.rs`, `app/src/App.tsx`, tests serialization helper.
  - Test coverage: signed-message mismatch tests.
- [ ] Signature binds all critical context fields.
  - Risk: replay across quest/user/submission/cycle/template.
  - Relevant files: `approve_submission.rs`, `state.rs`
  - Test coverage: wrong context tests.
- [ ] Timestamp and TTL checks are enforced.
  - Risk: stale or future signatures.
  - Relevant files: `constants.rs`, `approve_submission.rs`
  - Test coverage: expired, future, TTL-too-long tests.

### I. UsedProof Replay Protection

- [ ] `UsedProof` is initialized only for successful auto approval.
  - Risk: griefing by reserving proof hash on failed tx.
  - Relevant files: `approve_submission.rs`
  - Test coverage: wrong verifier/expired/failed pass no UsedProof tests.
- [ ] Same quest/hash cannot be reused.
  - Risk: duplicate payout.
  - Relevant files: `approve_submission.rs`
  - Test coverage: same-quest replay test.
- [ ] Different quests may reuse same hash by design.
  - Risk: product semantics unclear.
  - Relevant files: `approve_submission.rs`
  - Test coverage: different-quest reuse test.

### J. Closing / Settlement

- [ ] `settle_quest` requires no pending submissions.
  - Risk: skipped pending users.
  - Relevant files: `settle_quest.rs`
  - Test coverage: pending settlement rejection test.
- [ ] `settle_quest` requires review index caught up.
  - Risk: unreviewed submissions skipped.
  - Relevant files: `settle_quest.rs`
  - Test coverage: unreviewed submissions remaining tests.
- [ ] Settlement routes funds by `closing_reason`.
  - Risk: wrong recipient.
  - Relevant files: `close_quest.rs`, `settle_quest.rs`
  - Test coverage: early close, reward depletion, expired close tests.

### K. Frontend Safety

- [ ] SOL inputs are converted to lamports before integer-multiple checks.
  - Risk: JS floating point false validation.
  - Relevant files: `app/src/App.tsx`
  - Test coverage: TypeScript build; manual UI validation.
- [ ] Auto Approve panel does not hardcode verifier private keys.
  - Risk: verifier key leak.
  - Relevant files: `app/src/App.tsx`
  - Test coverage: manual review; code inspection.
- [ ] Quest List and Detail clearly show status and Closing consequences.
  - Risk: user misoperation.
  - Relevant files: `app/src/App.tsx`
  - Test coverage: build; manual UX review.

### L. Documentation / User Warnings

- [ ] README states devnet/demo limitation.
  - Risk: users mistake project for audited production protocol.
  - Relevant files: `README.md`
  - Test coverage: documentation review.
- [ ] Auto-Review trust model is explicit.
  - Risk: users believe chain verifies real-world data directly.
  - Relevant files: `README.md`, `docs/security.md`, this document.
  - Test coverage: documentation review.
- [ ] 32-cycle Recurring limitation is documented.
  - Risk: users expect permanent on-chain history.
  - Relevant files: `README.md`, `docs/flow.md`, `docs/invariants.md`
  - Test coverage: documentation review.

## 11. Risk Rating Summary

### Critical

- Verifier key compromise.
- Incorrect fund transfer.
- Settlement before pending submissions are reviewed.
- Signature verification bypass.

### High

- UsedProof bypass.
- Queue order bypass.
- Closing state bug.
- UserProgress duplicate bug.

### Medium

- Lack of verifier registry.
- Lack of key rotation.
- Direct account fetch scalability.
- Recurring 32-cycle limitation.

### Low

- Frontend bundle size.
- UI error clarity.
- Devnet airdrop friction.

## 12. Recommended Next Steps

1. Manual audit using this checklist.
2. Verifier registry and key rotation design.
3. GitHub verifier adapter.
4. Indexer for quests, submissions, users, pools, and UsedProof accounts.
5. Global UsedProof option only after product semantics are decided.
6. Public goods and fee vault governance.
7. Third-party security review before mainnet.
