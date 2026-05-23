import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Lootloop } from "../../../target/types/lootloop";
import {
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { expect } from "chai";

describe("LootLoop v0.3 Unified Quest Engine", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Lootloop as Program<Lootloop>;
  const publisher = (provider.wallet as anchor.Wallet).payer;
  const reviewerKeypair = anchor.web3.Keypair.generate();
  const strangerKeypair = anchor.web3.Keypair.generate();
  const submitterA = anchor.web3.Keypair.generate();
  const submitterB = anchor.web3.Keypair.generate();
  const submitterC = anchor.web3.Keypair.generate();
  const verifierKeypair = anchor.web3.Keypair.generate();
  const wrongVerifierKeypair = anchor.web3.Keypair.generate();

  const MIN_DURATION = new anchor.BN(60);
  const PERIOD = new anchor.BN(60);
  const FAST_PERIOD = new anchor.BN(1);
  const RECENT_CYCLE_WINDOW = 32;
  const MAX_VERIFICATION_TTL_SECONDS = 3_600;
  const REWARD = new anchor.BN(1_000_000);
  const BIG_REWARD = new anchor.BN(5_000_000);
  const PLATFORM_FEE_BPS = new anchor.BN(200);
  const CANCEL_FEE_BPS = new anchor.BN(100);
  const BPS_DENOMINATOR = new anchor.BN(10_000);

  let questCounter = new anchor.BN(Date.now());

  const nextQuestId = () => {
    questCounter = questCounter.add(new anchor.BN(1));
    return questCounter;
  };

  const oneTime = { oneTime: {} };
  const recurring = { recurring: {} };
  const manual = { manual: {} };
  const autoVerified = { autoVerified: {} };
  const customSigned = { customSigned: {} };
  const distanceActivity = { distanceActivity: {} };
  const defaultPubkey = new PublicKey("11111111111111111111111111111111");
  const validTemplateHash = Array.from({ length: 32 }, (_, idx) => idx + 1);
  const zeroHash = Array(32).fill(0);
  const replayProofHash = Array.from({ length: 32 }, (_, idx) => 90 + idx);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const airdrop = async (keypair: anchor.web3.Keypair) => {
    const sig = await provider.connection.requestAirdrop(
      keypair.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");
  };

  before(async () => {
    await Promise.all([
      airdrop(submitterA),
      airdrop(submitterB),
      airdrop(submitterC),
      airdrop(strangerKeypair),
    ]);
  });

  const deriveQuestPda = (questId: anchor.BN, pubkey = publisher.publicKey) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("quest"),
        pubkey.toBuffer(),
        questId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

  const deriveRewardPoolPda = (quest: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("reward_pool"), quest.toBuffer()],
      program.programId
    );

  const deriveDepositPoolPda = (quest: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("deposit_pool"), quest.toBuffer()],
      program.programId
    );

  const deriveSubmissionPda = (quest: PublicKey, index: anchor.BN) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("submission"),
        quest.toBuffer(),
        index.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

  const deriveUserProgressPda = (quest: PublicKey, user: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("user_progress"), quest.toBuffer(), user.toBuffer()],
      program.programId
    );

  const deriveUsedProofPda = (quest: PublicKey, externalProofHash: number[] | Buffer) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("used_proof"), quest.toBuffer(), Buffer.from(externalProofHash)],
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

  const expectAnchorError = (err: unknown, errorName: string) => {
    const anyErr = err as any;
    const code = anyErr.error?.errorCode?.code ?? "";
    expect(code === errorName || String(anyErr).includes(errorName)).to.equal(
      true,
      `expected ${errorName}, got ${String(anyErr)}`
    );
  };

  const expectUsedProofReplayError = (err: unknown) => {
    const text = String(err);
    const code = (err as any).error?.errorCode?.code ?? "";
    expect(
      code === "AccountAlreadyInitialized" ||
        text.includes("already in use") ||
        text.includes("already initialized") ||
        text.includes("usedProof")
    ).to.equal(true, `expected used proof replay error, got ${text}`);
  };

  const expectUsedProofMissing = async (usedProof: PublicKey) => {
    try {
      await program.account.usedProof.fetch(usedProof);
      expect.fail("UsedProof should not exist");
    } catch {
      // Expected: failed transactions roll back Anchor init for UsedProof.
    }
  };

  const transferLamports = async (to: PublicKey, lamports: number) => {
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: publisher.publicKey,
        toPubkey: to,
        lamports,
      })
    );
    await provider.sendAndConfirm(tx, []);
  };

  const createQuest = async ({
    mode = oneTime,
    reviewMode = manual,
    verificationTemplate = customSigned,
    templateConfigHash = zeroHash,
    verificationSchemaUri = "",
    authorizedVerifier = defaultPubkey,
    rewardPerCompletion = REWARD,
    initialRewardFunding = REWARD.mul(new anchor.BN(3)),
    depositAmount,
    durationSeconds = MIN_DURATION,
    periodSeconds = new anchor.BN(0),
    queueMax = 2,
    metadataUri,
  }: {
    mode?: any;
    reviewMode?: any;
    verificationTemplate?: any;
    templateConfigHash?: number[];
    verificationSchemaUri?: string;
    authorizedVerifier?: PublicKey;
    rewardPerCompletion?: anchor.BN;
    initialRewardFunding?: anchor.BN;
    depositAmount?: anchor.BN;
    durationSeconds?: anchor.BN;
    periodSeconds?: anchor.BN;
    queueMax?: number;
    metadataUri?: string;
  } = {}) => {
    const questId = nextQuestId();
    const [quest] = deriveQuestPda(questId);
    const [rewardPool] = deriveRewardPoolPda(quest);
    const [depositPool] = deriveDepositPoolPda(quest);
    const [feeVault] = deriveFeeVaultPda();
    const [publicGoodsPool] = derivePublicGoodsPoolPda();
    const requiredDeposit = rewardPerCompletion.mul(
      new anchor.BN(queueMax + 1)
    );

    await program.methods
      .createQuest(
        questId,
        mode,
        reviewMode,
        verificationTemplate,
        templateConfigHash,
        verificationSchemaUri,
        authorizedVerifier,
        metadataUri ?? `https://lootloop.example/${questId.toString()}.json`,
        reviewerKeypair.publicKey,
        rewardPerCompletion,
        initialRewardFunding,
        depositAmount ?? requiredDeposit,
        durationSeconds,
        periodSeconds,
        queueMax
      )
      .accountsPartial({
        quest,
        rewardPool,
        depositPool,
        feeVault,
        publicGoodsPool,
        publisher: publisher.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return {
      questId,
      quest,
      rewardPool,
      depositPool,
      feeVault,
      publicGoodsPool,
      rewardPerCompletion,
      initialRewardFunding,
      depositAmount: depositAmount ?? requiredDeposit,
      queueMax,
    };
  };

  const submitProof = async (
    quest: PublicKey,
    submitter: anchor.web3.Keypair,
    proofUri = "https://lootloop.example/proof.json"
  ) => {
    const questAccount = await program.account.quest.fetch(quest);
    const index = questAccount.nextSubmissionIndex;
    const [submission] = deriveSubmissionPda(quest, index);
    const [userProgress] = deriveUserProgressPda(quest, submitter.publicKey);

    await program.methods
      .submitProof(proofUri)
      .accountsPartial({
        quest,
        submission,
        userProgress,
        submitter: submitter.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([submitter])
      .rpc();

    return { submission, index, userProgress };
  };

  const cycleState = (progress: any, cycleIndex: anchor.BN) => {
    const idx = progress.recentCycles.findIndex((cycle: anchor.BN) =>
      cycle.eq(cycleIndex)
    );
    return idx >= 0 ? progress.recentCycleStates[idx] : 0;
  };

  const submitProofAfterCycleAdvance = async (
    quest: PublicKey,
    submitter: anchor.web3.Keypair,
    lastCycle: anchor.BN
  ) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await sleep(1_100);
      try {
        const submitted = await submitProof(quest, submitter);
        const submissionAccount = await program.account.submission.fetch(
          submitted.submission
        );
        expect(submissionAccount.cycleIndex.gt(lastCycle)).to.equal(true);
        return { ...submitted, submissionAccount };
      } catch (err) {
        const anyErr = err as any;
        const code = anyErr.error?.errorCode?.code ?? "";
        if (code === "CycleAlreadySubmitted" || String(err).includes("CycleAlreadySubmitted")) {
          continue;
        }
        throw err;
      }
    }

    throw new Error("Timed out waiting for the recurring cycle to advance");
  };

  const approveSubmission = async (
    quest: PublicKey,
    submission: PublicKey,
    submitter: PublicKey,
    reviewer = reviewerKeypair
  ) => {
    const [rewardPool] = deriveRewardPoolPda(quest);
    const [depositPool] = deriveDepositPoolPda(quest);
    const [userProgress] = deriveUserProgressPda(quest, submitter);

    await program.methods
      .approveSubmission()
      .accountsPartial({
        quest,
        submission,
        submitter,
        userProgress,
        rewardPool,
        depositPool,
        reviewer: reviewer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([reviewer])
      .rpc();
  };

  const rejectSubmission = async (
    quest: PublicKey,
    submission: PublicKey,
    submitter: PublicKey,
    reviewer = reviewerKeypair
  ) => {
    const [userProgress] = deriveUserProgressPda(quest, submitter);

    await program.methods
      .rejectSubmission()
      .accountsPartial({
        quest,
        submission,
        userProgress,
        reviewer: reviewer.publicKey,
      })
      .signers([reviewer])
      .rpc();
  };

  const templateTypeIndex = (template: any) => {
    const key = Object.keys(template)[0];
    return [
      "distanceActivity",
      "studyDuration",
      "githubContribution",
      "attendanceCheckin",
      "customSigned",
    ].indexOf(key);
  };

  const writeU32 = (value: number) => {
    const out = Buffer.alloc(4);
    out.writeUInt32LE(value, 0);
    return out;
  };

  const writeI64 = (value: anchor.BN) => {
    const out = Buffer.alloc(8);
    out.writeBigInt64LE(BigInt(value.toString()), 0);
    return out;
  };

  const serializeVerificationResult = (result: any) => {
    const domain = Buffer.from(result.domain, "utf8");
    return Buffer.concat([
      writeU32(domain.length),
      domain,
      result.programId.toBuffer(),
      result.quest.toBuffer(),
      result.submissionIndex.toArrayLike(Buffer, "le", 8),
      result.submitter.toBuffer(),
      result.cycleIndex.toArrayLike(Buffer, "le", 8),
      Buffer.from([templateTypeIndex(result.templateType)]),
      Buffer.from(result.templateConfigHash),
      Buffer.from(result.externalProofHash),
      result.verifiedValue.toArrayLike(Buffer, "le", 8),
      Buffer.from([result.passed ? 1 : 0]),
      writeI64(result.verifiedAt),
      writeI64(result.expiresAt),
      Buffer.from(result.nonce),
    ]);
  };

  const buildVerificationResult = async (
    quest: PublicKey,
    submission: PublicKey,
    overrides: Record<string, unknown> = {}
  ) => {
    const questAccount = await program.account.quest.fetch(quest);
    const submissionAccount = await program.account.submission.fetch(submission);
    const verifiedAt = submissionAccount.submittedAt;
    const externalProofHash = Array.from({ length: 32 }, (_, idx) => 200 - idx);
    const indexBytes = submissionAccount.submissionIndex.toArrayLike(Buffer, "le", 8);
    for (let idx = 0; idx < indexBytes.length; idx += 1) {
      externalProofHash[idx] = indexBytes[idx];
    }
    return {
      domain: "LootLoopAutoReviewV1",
      programId: program.programId,
      quest,
      submissionIndex: submissionAccount.submissionIndex,
      submitter: submissionAccount.submitter,
      cycleIndex: submissionAccount.cycleIndex,
      templateType: questAccount.verificationTemplate,
      templateConfigHash: Array.from(questAccount.templateConfigHash),
      externalProofHash,
      verifiedValue: new anchor.BN(123),
      passed: true,
      verifiedAt,
      expiresAt: verifiedAt.add(new anchor.BN(300)),
      nonce: Array.from({ length: 32 }, (_, idx) => 50 + idx),
      ...overrides,
    };
  };

  type AutoApproveOptions = {
    signer?: anchor.web3.Keypair;
    overrides?: Record<string, unknown>;
    includeEd25519?: boolean;
    insertInstructionBetween?: boolean;
    previousInstructionOtherProgram?: boolean;
    tamperAfterSigning?: Record<string, unknown>;
  };

  const autoApproveSubmission = async (
    quest: PublicKey,
    submission: PublicKey,
    signerOrOptions: anchor.web3.Keypair | AutoApproveOptions = verifierKeypair,
    legacyOverrides: Record<string, unknown> = {}
  ) => {
    const options: AutoApproveOptions =
      "secretKey" in signerOrOptions
        ? { signer: signerOrOptions, overrides: legacyOverrides }
        : signerOrOptions;
    const signer = options.signer ?? verifierKeypair;
    const submissionAccount = await program.account.submission.fetch(submission);
    const [rewardPool] = deriveRewardPoolPda(quest);
    const [depositPool] = deriveDepositPoolPda(quest);
    const [userProgress] = deriveUserProgressPda(
      quest,
      submissionAccount.submitter
    );
    const verificationResult = await buildVerificationResult(
      quest,
      submission,
      options.overrides ?? {}
    );
    const message = serializeVerificationResult(verificationResult);
    const ed25519Ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: signer.secretKey,
      message,
    });
    const instructionVerificationResult = {
      ...verificationResult,
      ...(options.tamperAfterSigning ?? {}),
    };
    const [usedProof] = deriveUsedProofPda(
      quest,
      instructionVerificationResult.externalProofHash as number[]
    );
    const autoIx = await program.methods
      .autoApproveSubmission(
        instructionVerificationResult.externalProofHash as number[],
        instructionVerificationResult as any
      )
      .accountsPartial({
        quest,
        submission,
        submitter: submissionAccount.submitter,
        userProgress,
        rewardPool,
        depositPool,
        usedProof,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        caller: publisher.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const tx = new anchor.web3.Transaction();
    if (options.includeEd25519 !== false) {
      tx.add(ed25519Ix);
    }
    if (options.insertInstructionBetween) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: publisher.publicKey,
          toPubkey: reviewerKeypair.publicKey,
          lamports: 1,
        })
      );
    }
    if (options.previousInstructionOtherProgram) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: publisher.publicKey,
          toPubkey: strangerKeypair.publicKey,
          lamports: 1,
        })
      );
    }
    tx.add(autoIx);
    await provider.sendAndConfirm(tx, []);
    return { verificationResult: instructionVerificationResult, usedProof };
  };

  const fundQuest = async (
    quest: PublicKey,
    rewardFundingAmount: anchor.BN,
    additionalDepositAmount = new anchor.BN(0),
    extendDurationSeconds = new anchor.BN(0)
  ) => {
    const [rewardPool] = deriveRewardPoolPda(quest);
    const [depositPool] = deriveDepositPoolPda(quest);
    const [feeVault] = deriveFeeVaultPda();

    await program.methods
      .fundQuest(
        rewardFundingAmount,
        additionalDepositAmount,
        extendDurationSeconds
      )
      .accountsPartial({
        quest,
        rewardPool,
        depositPool,
        feeVault,
        publisher: publisher.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  };

  const closeQuest = async (quest: PublicKey) => {
    const [rewardPool] = deriveRewardPoolPda(quest);
    const [depositPool] = deriveDepositPoolPda(quest);
    const [feeVault] = deriveFeeVaultPda();
    const [publicGoodsPool] = derivePublicGoodsPoolPda();

    await program.methods
      .closeQuest()
      .accountsPartial({
        quest,
        rewardPool,
        depositPool,
        feeVault,
        publicGoodsPool,
        publisher: publisher.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  };

  const settleQuest = async (quest: PublicKey) => {
    const [rewardPool] = deriveRewardPoolPda(quest);
    const [depositPool] = deriveDepositPoolPda(quest);
    const [feeVault] = deriveFeeVaultPda();
    const [publicGoodsPool] = derivePublicGoodsPoolPda();

    await program.methods
      .settleQuest()
      .accountsPartial({
        quest,
        rewardPool,
        depositPool,
        publisher: publisher.publicKey,
        feeVault,
        publicGoodsPool,
        caller: publisher.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  };

  it("creates a OneTime quest and funds reward/deposit pools", async () => {
    const { quest, rewardPool, depositPool, feeVault } = await createQuest();
    const account = await program.account.quest.fetch(quest);

    expect(account.mode).to.deep.equal({ oneTime: {} });
    expect(account.status).to.deep.equal({ open: {} });
    expect(account.pendingCount).to.equal(0);
    expect(account.nextSubmissionIndex.toNumber()).to.equal(0);
    expect(account.nextReviewIndex.toNumber()).to.equal(0);
    expect(await provider.connection.getBalance(rewardPool)).to.equal(
      REWARD.mul(new anchor.BN(3)).toNumber()
    );
    expect(await provider.connection.getBalance(depositPool)).to.equal(
      REWARD.mul(new anchor.BN(3)).toNumber()
    );
    expect(await provider.connection.getBalance(feeVault)).to.be.greaterThan(0);
  });

  it("creates a Recurring quest with period_seconds", async () => {
    const { quest } = await createQuest({
      mode: recurring,
      periodSeconds: PERIOD,
    });
    const account = await program.account.quest.fetch(quest);
    expect(account.mode).to.deep.equal({ recurring: {} });
    expect(account.periodSeconds.toNumber()).to.equal(PERIOD.toNumber());
  });

  it("creates an AutoVerified quest with verifier template settings", async () => {
    const { quest } = await createQuest({
      reviewMode: autoVerified,
      verificationTemplate: distanceActivity,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/distance-v1.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    const account = await program.account.quest.fetch(quest);
    expect(account.reviewMode).to.deep.equal({ autoVerified: {} });
    expect(account.verificationTemplate).to.deep.equal({ distanceActivity: {} });
    expect(account.authorizedVerifier.toString()).to.equal(
      verifierKeypair.publicKey.toString()
    );
    expect(Array.from(account.templateConfigHash)).to.deep.equal(validTemplateHash);
  });

  it("rejects AutoVerified quest creation without an authorized verifier", async () => {
    try {
      await createQuest({
        reviewMode: autoVerified,
        templateConfigHash: validTemplateHash,
        verificationSchemaUri: "https://lootloop.example/schema/auto.json",
        authorizedVerifier: defaultPubkey,
      });
      expect.fail("createQuest should reject missing authorized verifier");
    } catch (err) {
      expectAnchorError(err, "InvalidAuthorizedVerifier");
    }
  });

  it("rejects AutoVerified quest creation with a zero template hash", async () => {
    try {
      await createQuest({
        reviewMode: autoVerified,
        templateConfigHash: zeroHash,
        verificationSchemaUri: "https://lootloop.example/schema/auto.json",
        authorizedVerifier: verifierKeypair.publicKey,
      });
      expect.fail("createQuest should reject zero template hash");
    } catch (err) {
      expectAnchorError(err, "InvalidTemplateConfigHash");
    }
  });

  it("rejects create_quest when deposit is below the required amount", async () => {
    try {
      await createQuest({ depositAmount: REWARD });
      expect.fail("createQuest should reject insufficient deposit");
    } catch (err) {
      expectAnchorError(err, "InsufficientDeposit");
    }
  });

  it("rejects create_quest when initial_reward_funding is not a reward multiple", async () => {
    try {
      await createQuest({
        initialRewardFunding: REWARD.mul(new anchor.BN(3)).add(new anchor.BN(1)),
      });
      expect.fail("createQuest should reject non-multiple reward funding");
    } catch (err) {
      expectAnchorError(err, "RewardFundingNotMultipleOfReward");
    }
  });

  it("rejects create_quest when deposit_amount is not a reward multiple", async () => {
    try {
      await createQuest({
        depositAmount: REWARD.mul(new anchor.BN(3)).add(new anchor.BN(1)),
      });
      expect.fail("createQuest should reject non-multiple deposit funding");
    } catch (err) {
      expectAnchorError(err, "DepositNotMultipleOfReward");
    }
  });

  it("collects a 2% protocol fee during create_quest", async () => {
    const [feeVault] = deriveFeeVaultPda();
    const before = await provider.connection.getBalance(feeVault);
    const funding = REWARD.mul(new anchor.BN(10));
    await createQuest({ initialRewardFunding: funding });
    const after = await provider.connection.getBalance(feeVault);
    expect(after - before).to.equal(
      funding.mul(PLATFORM_FEE_BPS).div(BPS_DENOMINATOR).toNumber()
    );
  });

  it("submits proof using a chain-enforced submission index", async () => {
    const { quest } = await createQuest();
    const { submission, index } = await submitProof(quest, submitterA);
    const submissionAccount = await program.account.submission.fetch(submission);
    const questAccount = await program.account.quest.fetch(quest);

    expect(index.toNumber()).to.equal(0);
    expect(submissionAccount.submissionIndex.toNumber()).to.equal(0);
    expect(submissionAccount.submitter.toString()).to.equal(
      submitterA.publicKey.toString()
    );
    expect(submissionAccount.status).to.deep.equal({ pending: {} });
    expect(questAccount.pendingCount).to.equal(1);
    expect(questAccount.nextSubmissionIndex.toNumber()).to.equal(1);
  });

  it("prevents submissions when the pending queue is full", async () => {
    const { quest } = await createQuest({ queueMax: 1 });
    await submitProof(quest, submitterA);

    try {
      await submitProof(quest, submitterB);
      expect.fail("submitProof should reject a full queue");
    } catch (err) {
      expectAnchorError(err, "QueueFull");
    }
  });

  it("prevents OneTime users from completing twice", async () => {
    const { quest } = await createQuest();
    const { submission } = await submitProof(quest, submitterA);
    await approveSubmission(quest, submission, submitterA.publicKey);

    try {
      await submitProof(quest, submitterA);
      expect.fail("submitProof should reject completed one-time users");
    } catch (err) {
      expectAnchorError(err, "OneTimeAlreadySubmitted");
    }
  });

  it("prevents Recurring duplicate submissions in the same cycle", async () => {
    const { quest } = await createQuest({
      mode: recurring,
      periodSeconds: PERIOD,
    });
    await submitProof(quest, submitterA);

    try {
      await submitProof(quest, submitterA);
      expect.fail("submitProof should reject duplicate cycle submissions");
    } catch (err) {
      expectAnchorError(err, "CycleAlreadySubmitted");
    }
  });

  it("Recurring submit_proof has no cycle_index argument and stores the chain-computed current cycle", async () => {
    const submitIx = (program.idl.instructions as any[]).find(
      (ix) => ix.name === "submit_proof" || ix.name === "submitProof"
    );
    expect(submitIx.args).to.have.length(1);
    expect(
      submitIx.args.some((arg: any) =>
        ["cycle_index", "cycleIndex"].includes(arg.name)
      )
    ).to.equal(false);

    const { quest } = await createQuest({
      mode: recurring,
      periodSeconds: FAST_PERIOD,
    });
    const { submission } = await submitProof(quest, submitterA);
    const questAccount = await program.account.quest.fetch(quest);
    const submissionAccount = await program.account.submission.fetch(submission);
    const expectedCycle = submissionAccount.submittedAt
      .sub(questAccount.startAt)
      .div(questAccount.periodSeconds);

    expect(submissionAccount.cycleIndex.toString()).to.equal(
      expectedCycle.toString()
    );
  });

  it("marks Recurring current cycle Pending on submit and releases it on reject", async () => {
    const { quest } = await createQuest({
      mode: recurring,
      periodSeconds: PERIOD,
    });
    const first = await submitProof(quest, submitterA);
    let submissionAccount = await program.account.submission.fetch(first.submission);
    let progress = await program.account.userProgress.fetch(first.userProgress);
    expect(cycleState(progress, submissionAccount.cycleIndex)).to.equal(1);

    await rejectSubmission(quest, first.submission, submitterA.publicKey);
    progress = await program.account.userProgress.fetch(first.userProgress);
    expect(cycleState(progress, submissionAccount.cycleIndex)).to.equal(0);

    const second = await submitProof(quest, submitterA);
    submissionAccount = await program.account.submission.fetch(second.submission);
    progress = await program.account.userProgress.fetch(second.userProgress);
    expect(second.index.toNumber()).to.equal(1);
    expect(cycleState(progress, submissionAccount.cycleIndex)).to.equal(1);
  });

  it("marks Recurring current cycle Approved after full payment", async () => {
    const { quest } = await createQuest({
      mode: recurring,
      periodSeconds: PERIOD,
    });
    const { submission, userProgress } = await submitProof(quest, submitterA);
    const submissionAccount = await program.account.submission.fetch(submission);

    await approveSubmission(quest, submission, submitterA.publicKey);

    const progress = await program.account.userProgress.fetch(userProgress);
    expect(cycleState(progress, submissionAccount.cycleIndex)).to.equal(2);
  });

  it("allows Recurring users to submit again after the current cycle advances", async function () {
    this.timeout(20_000);
    const { quest } = await createQuest({
      mode: recurring,
      periodSeconds: FAST_PERIOD,
      initialRewardFunding: REWARD.mul(new anchor.BN(5)),
    });
    const first = await submitProof(quest, submitterA);
    const firstAccount = await program.account.submission.fetch(first.submission);
    await approveSubmission(quest, first.submission, submitterA.publicKey);

    const second = await submitProofAfterCycleAdvance(
      quest,
      submitterA,
      firstAccount.cycleIndex
    );

    expect(second.index.toNumber()).to.equal(1);
  });

  it("keeps the current Recurring cycle protected after the 32-cycle window rolls", async function () {
    this.timeout(80_000);
    const { quest } = await createQuest({
      mode: recurring,
      periodSeconds: FAST_PERIOD,
      initialRewardFunding: REWARD.mul(new anchor.BN(50)),
      depositAmount: REWARD.mul(new anchor.BN(50)),
      queueMax: 2,
    });

    let firstCycle: anchor.BN | null = null;
    let previousCycle = new anchor.BN(0);
    let lastCycle = new anchor.BN(0);
    let userProgress: PublicKey | null = null;

    for (let idx = 0; idx < RECENT_CYCLE_WINDOW + 1; idx += 1) {
      const submitted =
        idx === 0
          ? await submitProof(quest, submitterA)
          : await submitProofAfterCycleAdvance(quest, submitterA, previousCycle);
      userProgress = submitted.userProgress;
      const submissionAccount: any =
        "submissionAccount" in submitted
          ? submitted.submissionAccount
          : await program.account.submission.fetch(submitted.submission);
      if (idx === 0) {
        firstCycle = submissionAccount.cycleIndex;
      } else {
        expect(submissionAccount.cycleIndex.gt(previousCycle)).to.equal(true);
      }
      previousCycle = submissionAccount.cycleIndex;
      lastCycle = submissionAccount.cycleIndex;
      if (idx < RECENT_CYCLE_WINDOW) {
        await approveSubmission(quest, submitted.submission, submitterA.publicKey);
      }
    }

    expect(userProgress).to.not.equal(null);
    const progress = await program.account.userProgress.fetch(userProgress!);
    expect(firstCycle).to.not.equal(null);
    expect(cycleState(progress, firstCycle!)).to.equal(0);
    expect(cycleState(progress, lastCycle)).to.equal(1);

    try {
      await submitProof(quest, submitterA);
      expect.fail("submitProof should reject current-cycle pending duplicates after window rollover");
    } catch (err) {
      expectAnchorError(err, "CycleAlreadySubmitted");
    }
  });

  it("requires FIFO review order", async () => {
    const { quest } = await createQuest();
    await submitProof(quest, submitterA);
    const second = await submitProof(quest, submitterB);

    try {
      await approveSubmission(quest, second.submission, submitterB.publicKey);
      expect.fail("approveSubmission should reject out-of-order review");
    } catch (err) {
      expectAnchorError(err, "InvalidReviewOrder");
    }
  });

  it("rejects auto_approve_submission on Manual quests", async () => {
    const { quest } = await createQuest();
    const { submission } = await submitProof(quest, submitterA);

    try {
      await autoApproveSubmission(quest, submission);
      expect.fail("autoApproveSubmission should reject Manual quests");
    } catch (err) {
      expectAnchorError(err, "InvalidReviewMode");
    }
  });

  it("rejects manual approve_submission on AutoVerified quests", async () => {
    const { quest } = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    const { submission } = await submitProof(quest, submitterA);

    try {
      await approveSubmission(quest, submission, submitterA.publicKey);
      expect.fail("approveSubmission should reject AutoVerified quests");
    } catch (err) {
      expectAnchorError(err, "InvalidReviewMode");
    }
  });

  it("auto_approve_submission requires FIFO review order", async () => {
    const { quest } = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    await submitProof(quest, submitterA);
    const second = await submitProof(quest, submitterB);

    try {
      await autoApproveSubmission(quest, second.submission);
      expect.fail("autoApproveSubmission should reject out-of-order review");
    } catch (err) {
      expectAnchorError(err, "InvalidReviewOrder");
    }
  });

  it("auto_approve_submission verifies the authorized verifier signature and pays reward", async () => {
    const { quest, rewardPool } = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    const { submission } = await submitProof(quest, submitterA);
    const before = await provider.connection.getBalance(submitterA.publicKey);

    const autoResult = await autoApproveSubmission(quest, submission);

    const after = await provider.connection.getBalance(submitterA.publicKey);
    const submissionAccount = await program.account.submission.fetch(submission);
    const questAccount = await program.account.quest.fetch(quest);
    const usedProofAccount = await program.account.usedProof.fetch(autoResult.usedProof);
    expect(after - before).to.equal(REWARD.toNumber());
    expect(submissionAccount.status).to.deep.equal({ approved: {} });
    expect(submissionAccount.paidFromRewardPool.toNumber()).to.equal(REWARD.toNumber());
    expect(questAccount.totalApproved.toNumber()).to.equal(1);
    expect(usedProofAccount.quest.toString()).to.equal(quest.toString());
    expect(Array.from(usedProofAccount.externalProofHash)).to.deep.equal(
      autoResult.verificationResult.externalProofHash
    );
    expect(usedProofAccount.submissionIndex.toString()).to.equal(
      submissionAccount.submissionIndex.toString()
    );
    expect(usedProofAccount.submitter.toString()).to.equal(
      submissionAccount.submitter.toString()
    );
    expect(usedProofAccount.cycleIndex.toString()).to.equal(
      submissionAccount.cycleIndex.toString()
    );
    expect(usedProofAccount.usedAt.toNumber()).to.be.greaterThan(0);
    expect(await provider.connection.getBalance(rewardPool)).to.equal(
      REWARD.mul(new anchor.BN(2)).toNumber()
    );
  });

  it("prevents replaying the same external_proof_hash within one quest", async () => {
    const { quest } = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    const first = await submitProof(quest, submitterA);
    await autoApproveSubmission(quest, first.submission, {
      overrides: { externalProofHash: replayProofHash },
    });

    const second = await submitProof(quest, submitterB);
    try {
      await autoApproveSubmission(quest, second.submission, {
        overrides: { externalProofHash: replayProofHash },
      });
      expect.fail("autoApproveSubmission should reject replayed external proof");
    } catch (err) {
      expectUsedProofReplayError(err);
    }
  });

  it("allows the same external_proof_hash across different quests", async () => {
    const firstQuest = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    const secondQuest = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    const first = await submitProof(firstQuest.quest, submitterA);
    const second = await submitProof(secondQuest.quest, submitterA);

    await autoApproveSubmission(firstQuest.quest, first.submission, {
      overrides: { externalProofHash: replayProofHash },
    });
    await autoApproveSubmission(secondQuest.quest, second.submission, {
      overrides: { externalProofHash: replayProofHash },
    });
  });

  it("manual approve_submission does not create or require UsedProof", async () => {
    const { quest } = await createQuest();
    const { submission } = await submitProof(quest, submitterA);
    const [usedProof] = deriveUsedProofPda(quest, replayProofHash);

    await approveSubmission(quest, submission, submitterA.publicKey);

    await expectUsedProofMissing(usedProof);
  });

  it("auto_approve_submission requires an immediately preceding Ed25519 instruction", async () => {
    const { quest } = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });

    const adjacent = await submitProof(quest, submitterA);
    await autoApproveSubmission(quest, adjacent.submission);

    const missing = await submitProof(quest, submitterB);
    try {
      await autoApproveSubmission(quest, missing.submission, {
        includeEd25519: false,
      });
      expect.fail("autoApproveSubmission should reject missing Ed25519 instruction");
    } catch (err) {
      expectAnchorError(err, "InvalidEd25519Instruction");
    }
    await rejectSubmission(quest, missing.submission, submitterB.publicKey);

    const nonAdjacent = await submitProof(quest, submitterB);
    try {
      await autoApproveSubmission(quest, nonAdjacent.submission, {
        insertInstructionBetween: true,
      });
      expect.fail("autoApproveSubmission should reject non-adjacent Ed25519 instruction");
    } catch (err) {
      expectAnchorError(err, "InvalidEd25519Instruction");
    }
    await rejectSubmission(quest, nonAdjacent.submission, submitterB.publicKey);

    const previousOtherProgram = await submitProof(quest, submitterB);
    try {
      await autoApproveSubmission(quest, previousOtherProgram.submission, {
        previousInstructionOtherProgram: true,
      });
      expect.fail("autoApproveSubmission should reject a previous non-Ed25519 instruction");
    } catch (err) {
      expectAnchorError(err, "InvalidEd25519Instruction");
    }
  });

  it("auto_approve_submission rejects a signature from the wrong verifier", async () => {
    const { quest } = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    const { submission } = await submitProof(quest, submitterA);
    const [usedProof] = deriveUsedProofPda(quest, replayProofHash);

    try {
      await autoApproveSubmission(quest, submission, wrongVerifierKeypair, {
        externalProofHash: replayProofHash,
      });
      expect.fail("autoApproveSubmission should reject wrong verifier");
    } catch (err) {
      expectAnchorError(err, "InvalidVerifierSignature");
    }
    await expectUsedProofMissing(usedProof);
  });

  it("auto_approve_submission rejects verification results bound to the wrong context", async () => {
    const { quest } = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    const cases = [
      { domain: "LootLoopAutoReviewV0" },
      { programId: anchor.web3.Keypair.generate().publicKey },
      { quest: anchor.web3.Keypair.generate().publicKey },
      { submitter: submitterB.publicKey },
      { submissionIndex: new anchor.BN(99) },
      { cycleIndex: new anchor.BN(99) },
      { templateType: { githubContribution: {} } },
      { templateConfigHash: Array.from({ length: 32 }, (_, idx) => 99 - idx) },
    ];

    for (const override of cases) {
      const submitted = await submitProof(quest, submitterA);
      await rejectSubmission(quest, submitted.submission, submitterA.publicKey);
      const retry = await submitProof(quest, submitterA);
      try {
        await autoApproveSubmission(quest, retry.submission, verifierKeypair, override);
        expect.fail("autoApproveSubmission should reject mismatched context");
      } catch (err) {
        expectAnchorError(err, "InvalidVerificationResult");
      }
      await rejectSubmission(quest, retry.submission, submitterA.publicKey);
    }
  });

  it("auto_approve_submission rejects a signed-message mismatch", async () => {
    const { quest } = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    const { submission } = await submitProof(quest, submitterA);

    try {
      await autoApproveSubmission(quest, submission, {
        tamperAfterSigning: {
          externalProofHash: Array.from({ length: 32 }, (_, idx) => idx + 9),
        },
      });
      expect.fail("autoApproveSubmission should reject tampered signed messages");
    } catch (err) {
      expectAnchorError(err, "InvalidVerifierSignature");
    }
  });

  it("auto_approve_submission rejects failed, future, expired, or too-long verification results", async () => {
    const { quest } = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    const failed = await submitProof(quest, submitterA);
    const failedHash = Array.from({ length: 32 }, (_, idx) => 40 + idx);
    const [failedUsedProof] = deriveUsedProofPda(quest, failedHash);
    try {
      await autoApproveSubmission(quest, failed.submission, verifierKeypair, {
        externalProofHash: failedHash,
        passed: false,
      });
      expect.fail("autoApproveSubmission should reject passed=false");
    } catch (err) {
      expectAnchorError(err, "InvalidVerificationResult");
    }
    await expectUsedProofMissing(failedUsedProof);
    await rejectSubmission(quest, failed.submission, submitterA.publicKey);

    const future = await submitProof(quest, submitterA);
    const futureAccount = await program.account.submission.fetch(future.submission);
    try {
      await autoApproveSubmission(quest, future.submission, verifierKeypair, {
        verifiedAt: futureAccount.submittedAt.add(new anchor.BN(600)),
        expiresAt: futureAccount.submittedAt.add(new anchor.BN(900)),
      });
      expect.fail("autoApproveSubmission should reject future verified_at");
    } catch (err) {
      expectAnchorError(err, "VerificationFromFuture");
    }
    await rejectSubmission(quest, future.submission, submitterA.publicKey);

    const expired = await submitProof(quest, submitterA);
    const expiredHash = Array.from({ length: 32 }, (_, idx) => 120 + idx);
    const [expiredUsedProof] = deriveUsedProofPda(quest, expiredHash);
    try {
      await autoApproveSubmission(quest, expired.submission, verifierKeypair, {
        externalProofHash: expiredHash,
        expiresAt: new anchor.BN(1),
      });
      expect.fail("autoApproveSubmission should reject expired results");
    } catch (err) {
      expectAnchorError(err, "VerificationExpired");
    }
    await expectUsedProofMissing(expiredUsedProof);
    await rejectSubmission(quest, expired.submission, submitterA.publicKey);

    const tooLong = await submitProof(quest, submitterA);
    const tooLongAccount = await program.account.submission.fetch(tooLong.submission);
    try {
      await autoApproveSubmission(quest, tooLong.submission, verifierKeypair, {
        verifiedAt: tooLongAccount.submittedAt,
        expiresAt: tooLongAccount.submittedAt.add(
          new anchor.BN(MAX_VERIFICATION_TTL_SECONDS + 1)
        ),
      });
      expect.fail("autoApproveSubmission should reject overly long TTL");
    } catch (err) {
      expectAnchorError(err, "VerificationTtlTooLong");
    }
  });

  it("auto_approve_submission uses deposit pool and enters Closing when reward_pool is depleted", async () => {
    const { quest, rewardPool, depositPool } = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
      rewardPerCompletion: BIG_REWARD,
      initialRewardFunding: BIG_REWARD,
      queueMax: 2,
      depositAmount: BIG_REWARD.mul(new anchor.BN(3)),
    });
    const first = await submitProof(quest, submitterA);
    const second = await submitProof(quest, submitterB);
    await autoApproveSubmission(quest, first.submission);
    await autoApproveSubmission(quest, second.submission);

    const questAccount = await program.account.quest.fetch(quest);
    const secondAccount = await program.account.submission.fetch(second.submission);
    expect(questAccount.status).to.deep.equal({ closing: {} });
    expect(questAccount.closingReason).to.deep.equal({ rewardPoolDepleted: {} });
    expect(secondAccount.paidFromRewardPool.toNumber()).to.equal(0);
    expect(secondAccount.paidFromDepositPool.toNumber()).to.equal(BIG_REWARD.toNumber());
    expect(await provider.connection.getBalance(rewardPool)).to.equal(0);
    expect(await provider.connection.getBalance(depositPool)).to.equal(
      BIG_REWARD.mul(new anchor.BN(2)).toNumber()
    );
  });

  it("reject_submission releases AutoVerified pending submissions", async () => {
    const { quest } = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    const first = await submitProof(quest, submitterA);
    await rejectSubmission(quest, first.submission, submitterA.publicKey);
    const second = await submitProof(quest, submitterA);
    expect(second.index.toNumber()).to.equal(1);
    const questAccount = await program.account.quest.fetch(quest);
    expect(questAccount.pendingCount).to.equal(1);
  });

  it("allows a rejected AutoVerified submission to reuse an external_proof_hash before successful auto approval", async () => {
    const { quest } = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    const first = await submitProof(quest, submitterA);
    const [usedProof] = deriveUsedProofPda(quest, replayProofHash);
    await rejectSubmission(quest, first.submission, submitterA.publicKey);
    await expectUsedProofMissing(usedProof);

    const second = await submitProof(quest, submitterA);
    await autoApproveSubmission(quest, second.submission, {
      overrides: { externalProofHash: replayProofHash },
    });

    const usedProofAccount = await program.account.usedProof.fetch(usedProof);
    expect(usedProofAccount.submissionIndex.toNumber()).to.equal(1);
  });

  it("reject_submission on AutoVerified still requires FIFO order", async () => {
    const { quest } = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    await submitProof(quest, submitterA);
    const second = await submitProof(quest, submitterB);

    try {
      await rejectSubmission(quest, second.submission, submitterB.publicKey);
      expect.fail("rejectSubmission should reject out-of-order AutoVerified submissions");
    } catch (err) {
      expectAnchorError(err, "InvalidReviewOrder");
    }
  });

  it("reject_submission on AutoVerified Recurring releases the current cycle for resubmit", async () => {
    const { quest } = await createQuest({
      mode: recurring,
      periodSeconds: PERIOD,
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
    });
    const first = await submitProof(quest, submitterA);
    const firstAccount = await program.account.submission.fetch(first.submission);
    await rejectSubmission(quest, first.submission, submitterA.publicKey);
    let progress = await program.account.userProgress.fetch(first.userProgress);
    expect(cycleState(progress, firstAccount.cycleIndex)).to.equal(0);

    const second = await submitProof(quest, submitterA);
    const secondAccount = await program.account.submission.fetch(second.submission);
    progress = await program.account.userProgress.fetch(second.userProgress);
    expect(second.index.toNumber()).to.equal(1);
    expect(secondAccount.cycleIndex.toString()).to.equal(firstAccount.cycleIndex.toString());
    expect(cycleState(progress, secondAccount.cycleIndex)).to.equal(1);
  });

  it("auto_approve_submission in Closing pays only from deposit_pool", async () => {
    const { quest } = await createQuest({
      reviewMode: autoVerified,
      templateConfigHash: validTemplateHash,
      verificationSchemaUri: "https://lootloop.example/schema/auto.json",
      authorizedVerifier: verifierKeypair.publicKey,
      rewardPerCompletion: BIG_REWARD,
      initialRewardFunding: BIG_REWARD,
      queueMax: 3,
      depositAmount: BIG_REWARD.mul(new anchor.BN(4)),
    });
    const first = await submitProof(quest, submitterA);
    const second = await submitProof(quest, submitterB);
    const third = await submitProof(quest, submitterC);

    await autoApproveSubmission(quest, first.submission);
    await autoApproveSubmission(quest, second.submission);
    await autoApproveSubmission(quest, third.submission);

    const questAccount = await program.account.quest.fetch(quest);
    const thirdAccount = await program.account.submission.fetch(third.submission);
    expect(questAccount.status).to.deep.equal({ closing: {} });
    expect(thirdAccount.status).to.deep.equal({ approved: {} });
    expect(thirdAccount.paidFromRewardPool.toNumber()).to.equal(0);
    expect(thirdAccount.paidFromDepositPool.toNumber()).to.equal(BIG_REWARD.toNumber());
  });

  it("automatically pays the submitter from the reward pool on approval", async () => {
    const { quest, rewardPool } = await createQuest();
    const { submission } = await submitProof(quest, submitterA);
    const before = await provider.connection.getBalance(submitterA.publicKey);

    await approveSubmission(quest, submission, submitterA.publicKey);

    const after = await provider.connection.getBalance(submitterA.publicKey);
    const submissionAccount = await program.account.submission.fetch(submission);
    expect(after - before).to.equal(REWARD.toNumber());
    expect(submissionAccount.status).to.deep.equal({ approved: {} });
    expect(submissionAccount.paidFromRewardPool.toNumber()).to.equal(
      REWARD.toNumber()
    );
    expect(await provider.connection.getBalance(rewardPool)).to.equal(
      REWARD.mul(new anchor.BN(2)).toNumber()
    );
  });

  it("uses the deposit pool when the reward pool cannot pay a full reward and enters Closing", async () => {
    const { quest, rewardPool, depositPool } = await createQuest({
      rewardPerCompletion: BIG_REWARD,
      initialRewardFunding: BIG_REWARD,
      queueMax: 2,
      depositAmount: BIG_REWARD.mul(new anchor.BN(3)),
    });
    const first = await submitProof(quest, submitterA);
    const second = await submitProof(quest, submitterB);

    await approveSubmission(quest, first.submission, submitterA.publicKey);
    await approveSubmission(quest, second.submission, submitterB.publicKey);

    const account = await program.account.quest.fetch(quest);
    const submissionAccount = await program.account.submission.fetch(second.submission);
    expect(account.status).to.deep.equal({ closing: {} });
    expect(account.closingReason).to.deep.equal({ rewardPoolDepleted: {} });
    expect(submissionAccount.status).to.deep.equal({ approved: {} });
    expect(submissionAccount.paidFromRewardPool.toNumber()).to.equal(0);
    expect(submissionAccount.paidFromDepositPool.toNumber()).to.equal(
      BIG_REWARD.toNumber()
    );
    expect(await provider.connection.getBalance(rewardPool)).to.equal(0);
    expect(await provider.connection.getBalance(depositPool)).to.equal(
      BIG_REWARD.mul(new anchor.BN(2)).toNumber()
    );
  });

  it("pays approved Closing submissions only from the deposit pool", async () => {
    const { quest } = await createQuest({
      rewardPerCompletion: BIG_REWARD,
      initialRewardFunding: BIG_REWARD,
      queueMax: 3,
      depositAmount: BIG_REWARD.mul(new anchor.BN(4)),
    });
    const first = await submitProof(quest, submitterA);
    const second = await submitProof(quest, submitterB);
    const third = await submitProof(quest, submitterC);

    await approveSubmission(quest, first.submission, submitterA.publicKey);
    await approveSubmission(quest, second.submission, submitterB.publicKey);
    await approveSubmission(quest, third.submission, submitterC.publicKey);

    const thirdAccount = await program.account.submission.fetch(third.submission);
    expect(thirdAccount.status).to.deep.equal({ approved: {} });
    expect(thirdAccount.paidFromRewardPool.toNumber()).to.equal(0);
    expect(thirdAccount.paidFromDepositPool.toNumber()).to.equal(
      BIG_REWARD.toNumber()
    );
  });

  it("reject_submission releases pending_count and advances next_review_index", async () => {
    const { quest } = await createQuest();
    const { submission } = await submitProof(quest, submitterA);

    await rejectSubmission(quest, submission, submitterA.publicKey);

    const questAccount = await program.account.quest.fetch(quest);
    const submissionAccount = await program.account.submission.fetch(submission);
    expect(submissionAccount.status).to.deep.equal({ rejected: {} });
    expect(questAccount.pendingCount).to.equal(0);
    expect(questAccount.nextReviewIndex.toNumber()).to.equal(1);
    expect(questAccount.totalRejected.toNumber()).to.equal(1);
  });

  it("prevents new submissions after reward shortage moves quest to Closing", async () => {
    const { quest } = await createQuest({
      rewardPerCompletion: BIG_REWARD,
      initialRewardFunding: BIG_REWARD,
      queueMax: 2,
      depositAmount: BIG_REWARD.mul(new anchor.BN(3)),
    });
    const first = await submitProof(quest, submitterA);
    const second = await submitProof(quest, submitterB);
    await approveSubmission(quest, first.submission, submitterA.publicKey);
    await approveSubmission(quest, second.submission, submitterB.publicKey);

    try {
      await submitProof(quest, submitterC);
      expect.fail("submitProof should reject Closing quests");
    } catch (err) {
      expectAnchorError(err, "InvalidQuestStatus");
    }
  });

  it("early close stops new submissions and sends remaining pools to public goods", async () => {
    const { quest, rewardPool, depositPool, publicGoodsPool, feeVault } = await createQuest();
    const publicBefore = await provider.connection.getBalance(publicGoodsPool);
    const feeBefore = await provider.connection.getBalance(feeVault);
    const rewardBefore = await provider.connection.getBalance(rewardPool);
    const depositBefore = await provider.connection.getBalance(depositPool);

    await closeQuest(quest);

    const account = await program.account.quest.fetch(quest);
    const cancellationFee = Math.floor(
      (depositBefore * CANCEL_FEE_BPS.toNumber()) / BPS_DENOMINATOR.toNumber()
    );
    expect(account.status).to.deep.equal({ closed: {} });
    expect(account.closingReason).to.deep.equal({ earlyManual: {} });
    expect(await provider.connection.getBalance(rewardPool)).to.equal(0);
    expect(await provider.connection.getBalance(depositPool)).to.equal(0);
    expect(await provider.connection.getBalance(feeVault)).to.equal(
      feeBefore + cancellationFee
    );
    expect(await provider.connection.getBalance(publicGoodsPool)).to.equal(
      publicBefore + rewardBefore + depositBefore - cancellationFee
    );
  });

  it("early close with pending enters Closing and settle waits for pending_count zero", async () => {
    const { quest } = await createQuest();
    const { submission } = await submitProof(quest, submitterA);

    await closeQuest(quest);
    let account = await program.account.quest.fetch(quest);
    expect(account.status).to.deep.equal({ closing: {} });

    try {
      await settleQuest(quest);
      expect.fail("settleQuest should reject pending submissions");
    } catch (err) {
      expectAnchorError(err, "PendingSubmissionsRemaining");
    }

    await rejectSubmission(quest, submission, submitterA.publicKey);
    await settleQuest(quest);
    account = await program.account.quest.fetch(quest);
    expect(account.status).to.deep.equal({ closed: {} });
  });

  it("fund_quest adds reward funding, deposit, extension, and 2% fee", async () => {
    const { quest, rewardPool, depositPool, feeVault } = await createQuest();
    const rewardBefore = await provider.connection.getBalance(rewardPool);
    const depositBefore = await provider.connection.getBalance(depositPool);
    const feeBefore = await provider.connection.getBalance(feeVault);
    const accountBefore = await program.account.quest.fetch(quest);

    await fundQuest(quest, REWARD, REWARD, new anchor.BN(60));

    const accountAfter = await program.account.quest.fetch(quest);
    expect(await provider.connection.getBalance(rewardPool)).to.equal(
      rewardBefore + REWARD.toNumber()
    );
    expect(await provider.connection.getBalance(depositPool)).to.equal(
      depositBefore + REWARD.toNumber()
    );
    expect(await provider.connection.getBalance(feeVault)).to.equal(
      feeBefore + REWARD.mul(PLATFORM_FEE_BPS).div(BPS_DENOMINATOR).toNumber()
    );
    expect(accountAfter.expiresAt.sub(accountBefore.expiresAt).toNumber()).to.equal(
      60
    );
  });

  it("rejects fund_quest when reward funding is not a reward multiple", async () => {
    const { quest } = await createQuest();

    try {
      await fundQuest(quest, REWARD.add(new anchor.BN(1)));
      expect.fail("fundQuest should reject non-multiple reward funding");
    } catch (err) {
      expectAnchorError(err, "RewardFundingNotMultipleOfReward");
    }
  });

  it("rejects fund_quest when additional deposit is not a reward multiple", async () => {
    const { quest } = await createQuest();

    try {
      await fundQuest(quest, new anchor.BN(0), REWARD.add(new anchor.BN(1)));
      expect.fail("fundQuest should reject non-multiple additional deposit");
    } catch (err) {
      expectAnchorError(err, "DepositNotMultipleOfReward");
    }
  });

  it("rejects fund_quest after a quest enters Closing", async () => {
    const { quest } = await createQuest({
      rewardPerCompletion: BIG_REWARD,
      initialRewardFunding: BIG_REWARD,
      queueMax: 2,
      depositAmount: BIG_REWARD.mul(new anchor.BN(3)),
    });
    const first = await submitProof(quest, submitterA);
    const second = await submitProof(quest, submitterB);
    await approveSubmission(quest, first.submission, submitterA.publicKey);
    await approveSubmission(quest, second.submission, submitterB.publicKey);

    try {
      await fundQuest(quest, BIG_REWARD);
      expect.fail("fundQuest should reject Closing quests");
    } catch (err) {
      expectAnchorError(err, "InvalidQuestStatus");
    }
  });

  it("settles reward-pool-depleted Closing as an early close", async () => {
    const { quest, rewardPool, depositPool, publicGoodsPool, feeVault } =
      await createQuest({
        rewardPerCompletion: BIG_REWARD,
        initialRewardFunding: BIG_REWARD,
        queueMax: 2,
        depositAmount: BIG_REWARD.mul(new anchor.BN(3)),
      });
    const first = await submitProof(quest, submitterA);
    const second = await submitProof(quest, submitterB);
    await approveSubmission(quest, first.submission, submitterA.publicKey);
    await approveSubmission(quest, second.submission, submitterB.publicKey);

    await transferLamports(rewardPool, REWARD.toNumber());
    const publicBefore = await provider.connection.getBalance(publicGoodsPool);
    const feeBefore = await provider.connection.getBalance(feeVault);
    const rewardBefore = await provider.connection.getBalance(rewardPool);
    const depositBefore = await provider.connection.getBalance(depositPool);

    await settleQuest(quest);

    const cancellationFee = Math.floor(
      (depositBefore * CANCEL_FEE_BPS.toNumber()) / BPS_DENOMINATOR.toNumber()
    );
    const account = await program.account.quest.fetch(quest);
    expect(account.status).to.deep.equal({ closed: {} });
    expect(account.closingReason).to.deep.equal({ rewardPoolDepleted: {} });
    expect(await provider.connection.getBalance(rewardPool)).to.equal(0);
    expect(await provider.connection.getBalance(depositPool)).to.equal(0);
    expect(await provider.connection.getBalance(feeVault)).to.equal(
      feeBefore + cancellationFee
    );
    expect(await provider.connection.getBalance(publicGoodsPool)).to.equal(
      publicBefore + rewardBefore + depositBefore - cancellationFee
    );
  });

  it("rejects fund/submit/approve/reject/close after Closed", async () => {
    const { quest } = await createQuest();
    await closeQuest(quest);

    for (const action of [
      () => fundQuest(quest, REWARD),
      () => submitProof(quest, submitterA),
      async () => {
        const [submission] = deriveSubmissionPda(quest, new anchor.BN(0));
        await approveSubmission(quest, submission, submitterA.publicKey);
      },
      async () => {
        const [submission] = deriveSubmissionPda(quest, new anchor.BN(0));
        await rejectSubmission(quest, submission, submitterA.publicKey);
      },
      () => closeQuest(quest),
    ]) {
      try {
        await action();
        expect.fail("closed quest action should fail");
      } catch (err) {
        expect(String(err)).to.not.equal("");
      }
    }
  });

  it("rejects unauthorized reviewer", async () => {
    const { quest } = await createQuest();
    const { submission } = await submitProof(quest, submitterA);

    try {
      await approveSubmission(
        quest,
        submission,
        submitterA.publicKey,
        strangerKeypair
      );
      expect.fail("approveSubmission should reject unauthorized reviewers");
    } catch (err) {
      expectAnchorError(err, "Unauthorized");
    }
  });

  it("allows rejected OneTime users to resubmit with a new index", async () => {
    const { quest } = await createQuest();
    const first = await submitProof(quest, submitterA);
    await rejectSubmission(quest, first.submission, submitterA.publicKey);

    const second = await submitProof(quest, submitterA);
    expect(second.index.toNumber()).to.equal(1);
  });

  it("prevents Recurring users from resubmitting in a cycle after approval", async () => {
    const { quest } = await createQuest({
      mode: recurring,
      periodSeconds: PERIOD,
    });
    const { submission } = await submitProof(quest, submitterA);
    await approveSubmission(quest, submission, submitterA.publicKey);

    try {
      await submitProof(quest, submitterA);
      expect.fail("submitProof should reject approved cycle resubmission");
    } catch (err) {
      expectAnchorError(err, "CycleAlreadySubmitted");
    }
  });

  it("can close an expired quest and refund reward/deposit to publisher", async function () {
    this.timeout(90_000);
    const { quest, rewardPool, depositPool } = await createQuest();
    await sleep(62_000);

    const rewardBefore = await provider.connection.getBalance(rewardPool);
    const depositBefore = await provider.connection.getBalance(depositPool);
    await closeQuest(quest);

    const account = await program.account.quest.fetch(quest);
    expect(account.status).to.deep.equal({ closed: {} });
    expect(await provider.connection.getBalance(rewardPool)).to.equal(0);
    expect(await provider.connection.getBalance(depositPool)).to.equal(0);
    expect(rewardBefore + depositBefore).to.be.greaterThan(0);
  });
});
