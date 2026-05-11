import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Lootloop } from "../../../target/types/lootloop";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("LootLoop", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Lootloop as Program<Lootloop>;
  const publisher = (provider.wallet as anchor.Wallet).payer;
  const reviewerKeypair = anchor.web3.Keypair.generate();
  const reviewer = reviewerKeypair.publicKey;
  const oneMinute = new anchor.BN(60);
  const platformFeeBps = new anchor.BN(200);
  const bpsDenominator = new anchor.BN(10_000);
  const minAmount = new anchor.BN(1_000_000);

  const deriveQuestPda = (questId: anchor.BN) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("quest"),
        publisher.publicKey.toBuffer(),
        questId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

  const deriveVaultPda = (quest: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), quest.toBuffer()],
      program.programId
    );

  const deriveFeeVaultPda = () =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("fee_vault")],
      program.programId
    );

  const derivePublicGoodsPoolPda = () =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("public_goods_pool")],
      program.programId
    );

  const deriveSubmissionPda = (quest: PublicKey, submitter: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("submission"), quest.toBuffer(), submitter.toBuffer()],
      program.programId
    );

  const createQuest = async (
    questId: anchor.BN,
    metadataUri: string,
    rewardAmount: anchor.BN,
    durationSeconds = oneMinute
  ) => {
    const [quest] = deriveQuestPda(questId);
    const [vault] = deriveVaultPda(quest);
    const [feeVault] = deriveFeeVaultPda();

    const signature = await program.methods
      .createQuest(questId, metadataUri, reviewer, rewardAmount, durationSeconds)
      .accountsPartial({
        quest,
        vault,
        feeVault,
        publisher: publisher.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { quest, vault, feeVault, signature };
  };

  const submitProof = async (quest: PublicKey, proofUri: string) => {
    const [submission] = deriveSubmissionPda(quest, publisher.publicKey);

    const signature = await program.methods
      .submitProof(proofUri)
      .accountsPartial({
        quest,
        submission,
        submitter: publisher.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { submission, signature };
  };

  const approveSubmission = async (
    quest: PublicKey,
    submission: PublicKey,
    reviewerSigner = reviewerKeypair
  ) => {
    const signature = await program.methods
      .approveSubmission()
      .accountsPartial({
        quest,
        submission,
        reviewer: reviewerSigner.publicKey,
      })
      .signers([reviewerSigner])
      .rpc();

    return { signature };
  };

  const claimReward = async (
    quest: PublicKey,
    submission: PublicKey,
    submitterSigner = publisher
  ) => {
    const [vault] = deriveVaultPda(quest);

    const builder = program.methods
      .claimReward()
      .accountsPartial({
        quest,
        submission,
        vault,
        submitter: submitterSigner.publicKey,
        systemProgram: SystemProgram.programId,
      });

    if (!submitterSigner.publicKey.equals(publisher.publicKey)) {
      builder.signers([submitterSigner]);
    }

    const signature = await builder.rpc();

    return { vault, signature };
  };

  const topUpQuest = async (
    quest: PublicKey,
    topUpAmount: anchor.BN,
    extendDurationSeconds = new anchor.BN(0),
    publisherSigner = publisher
  ) => {
    const [vault] = deriveVaultPda(quest);
    const [feeVault] = deriveFeeVaultPda();

    const builder = program.methods
      .topUpQuest(topUpAmount, extendDurationSeconds)
      .accountsPartial({
        quest,
        vault,
        feeVault,
        publisher: publisherSigner.publicKey,
        systemProgram: SystemProgram.programId,
      });

    if (!publisherSigner.publicKey.equals(publisher.publicKey)) {
      builder.signers([publisherSigner]);
    }

    const signature = await builder.rpc();
    return { vault, feeVault, signature };
  };

  const cancelQuest = async (quest: PublicKey, publisherSigner = publisher) => {
    const [vault] = deriveVaultPda(quest);
    const [publicGoodsPool] = derivePublicGoodsPoolPda();

    const builder = program.methods
      .cancelQuest()
      .accountsPartial({
        quest,
        vault,
        publicGoodsPool,
        publisher: publisherSigner.publicKey,
        systemProgram: SystemProgram.programId,
      });

    if (!publisherSigner.publicKey.equals(publisher.publicKey)) {
      builder.signers([publisherSigner]);
    }

    const signature = await builder.rpc();
    return { vault, publicGoodsPool, signature };
  };

  const expectAnchorError = (err: unknown, errorName: string) => {
    const anyErr = err as any;
    expect(
      anyErr.error?.errorCode?.code ?? anyErr.error?.errorCode?.number ?? ""
    ).to.satisfy((value: string | number) =>
      value === errorName || String(anyErr).includes(errorName)
    );
  };

  it("creates a Quest and stores the reward in the vault", async () => {
    const questId = new anchor.BN(1);
    const metadataUri = "https://lootloop.example/quests/1.json";
    const rewardAmount = new anchor.BN(0.25 * LAMPORTS_PER_SOL);
    const [quest] = deriveQuestPda(questId);
    const [vault] = deriveVaultPda(quest);
    const [feeVault] = deriveFeeVaultPda();
    const feeAmount = rewardAmount.mul(platformFeeBps).div(bpsDenominator);

    const vaultBalanceBefore = await provider.connection.getBalance(vault);
    const feeVaultBalanceBefore = await provider.connection.getBalance(feeVault);

    const tx = await program.methods
      .createQuest(questId, metadataUri, reviewer, rewardAmount, oneMinute)
      .accountsPartial({
        quest,
        vault,
        feeVault,
        publisher: publisher.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("✅ Create quest tx:", tx);

    const account = await program.account.quest.fetch(quest);
    expect(account.questId.toNumber()).to.equal(questId.toNumber());
    expect(account.publisher.toString()).to.equal(publisher.publicKey.toString());
    expect(account.reviewer.toString()).to.equal(reviewer.toString());
    expect(account.rewardAmount.toNumber()).to.equal(rewardAmount.toNumber());
    expect(account.totalFundedAmount.toNumber()).to.equal(rewardAmount.toNumber());
    expect(account.totalFeePaid.toNumber()).to.equal(feeAmount.toNumber());
    expect(account.createdAt.toNumber()).to.be.greaterThan(0);
    expect(account.expiresAt.toNumber()).to.equal(
      account.createdAt.add(oneMinute).toNumber()
    );
    expect(account.cancelledAt.toNumber()).to.equal(0);
    expect(account.status).to.deep.equal({ open: {} });
    expect(account.approvedSubmitter).to.equal(null);
    expect(account.submissionCount.toNumber()).to.equal(0);
    expect(account.rewardClaimed).to.equal(false);
    expect(account.metadataUri).to.equal(metadataUri);

    const vaultBalanceAfter = await provider.connection.getBalance(vault);
    expect(vaultBalanceBefore).to.equal(0);
    expect(vaultBalanceAfter).to.equal(rewardAmount.toNumber());
    expect(await provider.connection.getBalance(feeVault)).to.equal(
      feeVaultBalanceBefore + feeAmount.toNumber()
    );
  });

  it("fails when reward_amount is zero", async () => {
    try {
      await createQuest(
        new anchor.BN(100),
        "https://lootloop.example/quests/zero-reward.json",
        new anchor.BN(0)
      );
      expect.fail("createQuest should reject a zero reward");
    } catch (err) {
      expectAnchorError(err, "InvalidRewardAmount");
    }
  });

  it("fails when metadata_uri is too long", async () => {
    try {
      await createQuest(new anchor.BN(101), "x".repeat(201), new anchor.BN(1));
      expect.fail("createQuest should reject oversized metadata_uri");
    } catch (err) {
      expectAnchorError(err, "MetadataUriTooLong");
    }
  });

  it("fails when duration_seconds is shorter than one minute", async () => {
    try {
      await createQuest(
        new anchor.BN(102),
        "https://lootloop.example/quests/short-duration.json",
        minAmount,
        new anchor.BN(59)
      );
      expect.fail("createQuest should reject a duration shorter than one minute");
    } catch (err) {
      expectAnchorError(err, "DurationTooShort");
    }
  });

  it("allows the same publisher to create multiple quests with different quest_id values", async () => {
    const questIdTwo = new anchor.BN(2);
    const { quest: questOne } = {
      quest: deriveQuestPda(new anchor.BN(1))[0],
    };
    const { quest: questTwo } = await createQuest(
      questIdTwo,
      "https://lootloop.example/quests/2.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );

    expect(questOne.toString()).to.not.equal(questTwo.toString());

    const questOneAccount = await program.account.quest.fetch(questOne);
    const questTwoAccount = await program.account.quest.fetch(questTwo);

    expect(questOneAccount.questId.toNumber()).to.equal(1);
    expect(questTwoAccount.questId.toNumber()).to.equal(2);
  });

  it("lets a user submit proof for an open Quest", async () => {
    const { quest } = await createQuest(
      new anchor.BN(3),
      "https://lootloop.example/quests/3.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const proofUri = "https://github.com/lootloop/demo/pull/1";

    const { submission, signature } = await submitProof(quest, proofUri);
    console.log("✅ Submit proof tx:", signature);

    const submissionAccount = await program.account.submission.fetch(submission);
    expect(submissionAccount.quest.toString()).to.equal(quest.toString());
    expect(submissionAccount.submitter.toString()).to.equal(
      publisher.publicKey.toString()
    );
    expect(submissionAccount.status).to.deep.equal({ pending: {} });
    expect(submissionAccount.proofUri).to.equal(proofUri);
    expect(submissionAccount.submittedAt.toNumber()).to.be.greaterThan(0);
    expect(submissionAccount.reviewedAt.toNumber()).to.equal(0);

    const questAccount = await program.account.quest.fetch(quest);
    expect(questAccount.submissionCount.toNumber()).to.equal(1);
  });

  it("fails when proof_uri is too long", async () => {
    const { quest } = await createQuest(
      new anchor.BN(4),
      "https://lootloop.example/quests/4.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );

    try {
      await submitProof(quest, "x".repeat(201));
      expect.fail("submitProof should reject oversized proof_uri");
    } catch (err) {
      expectAnchorError(err, "ProofUriTooLong");
    }
  });

  it("fails when the same user submits proof twice for the same Quest", async () => {
    const { quest } = await createQuest(
      new anchor.BN(5),
      "https://lootloop.example/quests/5.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );

    await submitProof(quest, "https://github.com/lootloop/demo/pull/first");

    try {
      await submitProof(quest, "https://github.com/lootloop/demo/pull/second");
      expect.fail("submitProof should reject duplicate submissions");
    } catch (err) {
      expect(err).to.be.instanceOf(Error);
    }
  });

  it("lets the reviewer approve a pending submission", async () => {
    const { quest } = await createQuest(
      new anchor.BN(6),
      "https://lootloop.example/quests/6.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const { submission } = await submitProof(
      quest,
      "https://github.com/lootloop/demo/pull/approve"
    );

    const { signature } = await approveSubmission(quest, submission);
    console.log("✅ Approve submission tx:", signature);

    const submissionAccount = await program.account.submission.fetch(submission);
    expect(submissionAccount.status).to.deep.equal({ approved: {} });
    expect(submissionAccount.reviewedAt.toNumber()).to.be.greaterThan(0);

    const questAccount = await program.account.quest.fetch(quest);
    expect(questAccount.status).to.deep.equal({ approved: {} });
    expect(questAccount.approvedSubmitter?.toString()).to.equal(
      publisher.publicKey.toString()
    );
  });

  it("fails when a non-reviewer and non-publisher approves a submission", async () => {
    const { quest } = await createQuest(
      new anchor.BN(7),
      "https://lootloop.example/quests/7.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const { submission } = await submitProof(
      quest,
      "https://github.com/lootloop/demo/pull/unauthorized"
    );
    const unauthorized = anchor.web3.Keypair.generate();

    try {
      await approveSubmission(quest, submission, unauthorized);
      expect.fail("approveSubmission should reject unauthorized reviewers");
    } catch (err) {
      expectAnchorError(err, "Unauthorized");
    }
  });

  it("fails when approving the same submission twice", async () => {
    const { quest } = await createQuest(
      new anchor.BN(8),
      "https://lootloop.example/quests/8.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const { submission } = await submitProof(
      quest,
      "https://github.com/lootloop/demo/pull/double-approve"
    );

    await approveSubmission(quest, submission);

    try {
      await approveSubmission(quest, submission);
      expect.fail("approveSubmission should reject already approved submissions");
    } catch (err) {
      expectAnchorError(err, "InvalidSubmissionStatus");
    }
  });

  it("fails when approving a submission that belongs to another Quest", async () => {
    const { quest: sourceQuest } = await createQuest(
      new anchor.BN(9),
      "https://lootloop.example/quests/9.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const { quest: otherQuest } = await createQuest(
      new anchor.BN(10),
      "https://lootloop.example/quests/10.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const { submission } = await submitProof(
      sourceQuest,
      "https://github.com/lootloop/demo/pull/wrong-quest"
    );

    try {
      await approveSubmission(otherQuest, submission);
      expect.fail("approveSubmission should reject submissions from another Quest");
    } catch (err) {
      expectAnchorError(err, "InvalidSubmissionQuest");
    }
  });

  it("lets the approved submitter claim the reward", async () => {
    const rewardAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
    const { quest } = await createQuest(
      new anchor.BN(11),
      "https://lootloop.example/quests/11.json",
      rewardAmount
    );
    const { submission } = await submitProof(
      quest,
      "https://github.com/lootloop/demo/pull/claim"
    );
    await approveSubmission(quest, submission);

    const balanceBefore = await provider.connection.getBalance(
      publisher.publicKey
    );
    const { vault, signature } = await claimReward(quest, submission);
    console.log("✅ Claim reward tx:", signature);
    const balanceAfter = await provider.connection.getBalance(publisher.publicKey);

    expect(balanceAfter).to.be.greaterThan(
      balanceBefore + rewardAmount.toNumber() - 0.01 * LAMPORTS_PER_SOL
    );
    expect(await provider.connection.getBalance(vault)).to.equal(0);

    const questAccount = await program.account.quest.fetch(quest);
    expect(questAccount.rewardClaimed).to.equal(true);
    expect(questAccount.status).to.deep.equal({ completed: {} });
  });

  it("fails when claiming before approval", async () => {
    const { quest } = await createQuest(
      new anchor.BN(12),
      "https://lootloop.example/quests/12.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const { submission } = await submitProof(
      quest,
      "https://github.com/lootloop/demo/pull/unapproved"
    );

    try {
      await claimReward(quest, submission);
      expect.fail("claimReward should reject unapproved submissions");
    } catch (err) {
      expectAnchorError(err, "InvalidQuestStatus");
    }
  });

  it("fails when a non-approved submitter claims the reward", async () => {
    const { quest } = await createQuest(
      new anchor.BN(13),
      "https://lootloop.example/quests/13.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const { submission } = await submitProof(
      quest,
      "https://github.com/lootloop/demo/pull/wrong-claimer"
    );
    await approveSubmission(quest, submission);
    const wrongSubmitter = anchor.web3.Keypair.generate();

    try {
      await claimReward(quest, submission, wrongSubmitter);
      expect.fail("claimReward should reject non-approved submitters");
    } catch (err) {
      expectAnchorError(err, "InvalidSubmitter");
    }
  });

  it("fails when claiming the same reward twice", async () => {
    const { quest } = await createQuest(
      new anchor.BN(14),
      "https://lootloop.example/quests/14.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const { submission } = await submitProof(
      quest,
      "https://github.com/lootloop/demo/pull/double-claim"
    );
    await approveSubmission(quest, submission);
    await claimReward(quest, submission);

    try {
      await claimReward(quest, submission);
      expect.fail("claimReward should reject duplicate claims");
    } catch (err) {
      expectAnchorError(err, "InvalidQuestStatus");
    }
  });

  it("fails when claiming with a submission that belongs to another Quest", async () => {
    const { quest: sourceQuest } = await createQuest(
      new anchor.BN(15),
      "https://lootloop.example/quests/15.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const { submission: sourceSubmission } = await submitProof(
      sourceQuest,
      "https://github.com/lootloop/demo/pull/source-claim"
    );
    await approveSubmission(sourceQuest, sourceSubmission);

    const { quest: otherQuest } = await createQuest(
      new anchor.BN(16),
      "https://lootloop.example/quests/16.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const { submission: otherSubmission } = await submitProof(
      otherQuest,
      "https://github.com/lootloop/demo/pull/other-claim"
    );
    await approveSubmission(otherQuest, otherSubmission);

    try {
      await claimReward(otherQuest, sourceSubmission);
      expect.fail("claimReward should reject submissions from another Quest");
    } catch (err) {
      expectAnchorError(err, "InvalidSubmissionQuest");
    }
  });

  it("lets the publisher top up a Quest and extend its deadline", async () => {
    const initialReward = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
    const topUpAmount = new anchor.BN(0.05 * LAMPORTS_PER_SOL);
    const extension = new anchor.BN(30 * 60);
    const { quest, vault, feeVault } = await createQuest(
      new anchor.BN(17),
      "https://lootloop.example/quests/17.json",
      initialReward
    );
    const accountBefore = await program.account.quest.fetch(quest);
    const vaultBalanceBefore = await provider.connection.getBalance(vault);
    const feeVaultBalanceBefore = await provider.connection.getBalance(feeVault);
    const topUpFee = topUpAmount.mul(platformFeeBps).div(bpsDenominator);

    await topUpQuest(quest, topUpAmount, extension);

    const accountAfter = await program.account.quest.fetch(quest);
    expect(accountAfter.rewardAmount.toNumber()).to.equal(
      initialReward.add(topUpAmount).toNumber()
    );
    expect(accountAfter.totalFundedAmount.toNumber()).to.equal(
      initialReward.add(topUpAmount).toNumber()
    );
    expect(accountAfter.totalFeePaid.toNumber()).to.equal(
      accountBefore.totalFeePaid.add(topUpFee).toNumber()
    );
    expect(accountAfter.expiresAt.toNumber()).to.equal(
      accountBefore.expiresAt.add(extension).toNumber()
    );
    expect(await provider.connection.getBalance(vault)).to.equal(
      vaultBalanceBefore + topUpAmount.toNumber()
    );
    expect(await provider.connection.getBalance(feeVault)).to.equal(
      feeVaultBalanceBefore + topUpFee.toNumber()
    );
  });

  it("fails when a non-publisher tops up a Quest", async () => {
    const { quest } = await createQuest(
      new anchor.BN(18),
      "https://lootloop.example/quests/18.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const unauthorized = anchor.web3.Keypair.generate();

    try {
      await topUpQuest(quest, minAmount, new anchor.BN(0), unauthorized);
      expect.fail("topUpQuest should reject non-publishers");
    } catch (err) {
      expectAnchorError(err, "Unauthorized");
    }
  });

  it("fails when top_up_amount is below the minimum", async () => {
    const { quest } = await createQuest(
      new anchor.BN(19),
      "https://lootloop.example/quests/19.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );

    try {
      await topUpQuest(quest, minAmount.sub(new anchor.BN(1)));
      expect.fail("topUpQuest should reject top ups below the minimum");
    } catch (err) {
      expectAnchorError(err, "InvalidTopUpAmount");
    }
  });

  it("fails when topping up an approved Quest", async () => {
    const { quest } = await createQuest(
      new anchor.BN(20),
      "https://lootloop.example/quests/20.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const { submission } = await submitProof(
      quest,
      "https://github.com/lootloop/demo/pull/top-up-approved"
    );
    await approveSubmission(quest, submission);

    try {
      await topUpQuest(quest, minAmount);
      expect.fail("topUpQuest should reject approved quests");
    } catch (err) {
      expectAnchorError(err, "CannotTopUpApprovedQuest");
    }
  });

  it("lets the publisher cancel before expiry and sends the reward to public goods pool", async () => {
    const rewardAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
    const { quest, vault } = await createQuest(
      new anchor.BN(21),
      "https://lootloop.example/quests/21.json",
      rewardAmount
    );
    const [publicGoodsPool] = derivePublicGoodsPoolPda();
    const poolBalanceBefore = await provider.connection.getBalance(publicGoodsPool);

    const { publicGoodsPool: cancelledPool } = await cancelQuest(quest);

    expect(cancelledPool.toString()).to.equal(publicGoodsPool.toString());
    expect(await provider.connection.getBalance(vault)).to.equal(0);
    expect(await provider.connection.getBalance(publicGoodsPool)).to.equal(
      poolBalanceBefore + rewardAmount.toNumber()
    );

    const account = await program.account.quest.fetch(quest);
    expect(account.status).to.deep.equal({ cancelled: {} });
    expect(account.cancelledAt.toNumber()).to.be.greaterThan(0);
  });

  it("fails when a non-publisher cancels a Quest", async () => {
    const { quest } = await createQuest(
      new anchor.BN(22),
      "https://lootloop.example/quests/22.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const unauthorized = anchor.web3.Keypair.generate();

    try {
      await cancelQuest(quest, unauthorized);
      expect.fail("cancelQuest should reject non-publishers");
    } catch (err) {
      expectAnchorError(err, "Unauthorized");
    }
  });

  it("fails when cancelling an approved Quest", async () => {
    const { quest } = await createQuest(
      new anchor.BN(23),
      "https://lootloop.example/quests/23.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const { submission } = await submitProof(
      quest,
      "https://github.com/lootloop/demo/pull/cancel-approved"
    );
    await approveSubmission(quest, submission);

    try {
      await cancelQuest(quest);
      expect.fail("cancelQuest should reject approved quests");
    } catch (err) {
      expectAnchorError(err, "CannotCancelApprovedQuest");
    }
  });

  it("fails when cancelling or topping up a completed Quest", async () => {
    const { quest } = await createQuest(
      new anchor.BN(24),
      "https://lootloop.example/quests/24.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    const { submission } = await submitProof(
      quest,
      "https://github.com/lootloop/demo/pull/completed-terminal"
    );
    await approveSubmission(quest, submission);
    await claimReward(quest, submission);

    try {
      await cancelQuest(quest);
      expect.fail("cancelQuest should reject completed quests");
    } catch (err) {
      expectAnchorError(err, "QuestAlreadyCompleted");
    }

    try {
      await topUpQuest(quest, minAmount);
      expect.fail("topUpQuest should reject completed quests");
    } catch (err) {
      expectAnchorError(err, "QuestAlreadyCompleted");
    }
  });

  it("fails when submitting or topping up a cancelled Quest", async () => {
    const { quest } = await createQuest(
      new anchor.BN(25),
      "https://lootloop.example/quests/25.json",
      new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    );
    await cancelQuest(quest);

    try {
      await submitProof(quest, "https://github.com/lootloop/demo/pull/cancelled");
      expect.fail("submitProof should reject cancelled quests");
    } catch (err) {
      expectAnchorError(err, "InvalidQuestStatus");
    }

    try {
      await topUpQuest(quest, minAmount);
      expect.fail("topUpQuest should reject cancelled quests");
    } catch (err) {
      expectAnchorError(err, "QuestAlreadyCancelled");
    }

    try {
      await cancelQuest(quest);
      expect.fail("cancelQuest should reject already cancelled quests");
    } catch (err) {
      expectAnchorError(err, "QuestAlreadyCancelled");
    }
  });

});
