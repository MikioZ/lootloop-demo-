import { useEffect, useMemo, useState } from "react";
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { Buffer } from "buffer";

import idl from "./idl/lootloop.json";
import type { Lootloop } from "../../target/types/lootloop";

type Language = "en" | "zh";
type QuestAccount = Awaited<ReturnType<Program<Lootloop>["account"]["quest"]["fetch"]>>;
type SubmissionAccount = Awaited<
  ReturnType<Program<Lootloop>["account"]["submission"]["fetch"]>
>;
type UserProgressAccount = Awaited<
  ReturnType<Program<Lootloop>["account"]["userProgress"]["fetch"]>
>;
type Tab =
  | "dashboard"
  | "detail"
  | "create"
  | "submitter"
  | "reviewer"
  | "publisher"
  | "state";
type QuestRow = { publicKey: PublicKey; account: QuestAccount };
type LoadedSubmission = { pda: PublicKey; account: SubmissionAccount };
type UiError = { message: string; details: string };

const PROGRAM_ID = new PublicKey("CQmvWxzKoxVrVQq798qY1tm699ivLJcvC5XWw8o4DTUj");
const RPC_ENDPOINT = "https://api.devnet.solana.com";
const MIN_DURATION_SECONDS = 60;
const MAX_VERIFICATION_TTL_SECONDS = 3_600;
const PLATFORM_FEE_BPS = 200;
const BPS_DENOMINATOR = 10_000;
const DEFAULT_PUBKEY = new PublicKey("11111111111111111111111111111111");

const copy = {
  en: {
    title: "LootLoop v0.3",
    subtitle: "Unified Quest Engine on Solana devnet.",
    wallet: "Wallet",
    rpc: "RPC endpoint",
    language: "Language",
    create: "Create Quest",
    submit: "Submit Proof",
    approve: "Approve Submission",
    reject: "Reject Submission",
    fund: "Fund Quest",
    close: "Close / Settle",
    viewer: "State Viewer",
    detail: "Quest Detail",
    status: "Status",
    fee: "Protocol fee: reward funding pays an extra 2%. The fee is not deducted from the reward pool.",
    closeRule:
      "If reward_pool cannot pay one full reward, the quest enters irreversible Closing. Pending submissions can still be reviewed; approved submissions are paid in full from deposit_pool. Early Closing sends remaining reward/deposit to public_goods_pool after a 1% deposit fee. Expired Closing refunds remaining reward/deposit to publisher.",
    recurringRule:
      "Recurring quests only accept proof for the current on-chain cycle. Historical catch-up and future-cycle submissions are not supported. UserProgress keeps a 32-cycle on-chain window for pending/approved duplicate prevention; older history may live in localStorage, IndexedDB, or an indexer for display only, never as a protocol credential.",
    autoRule:
      "Auto-Review v1 is a mock verifier signature flow. Do not hardcode real verifier private keys in the frontend. A real verifier server should check off-chain data, sign a bound result, and keep verification TTL at 1 hour or less.",
  },
  zh: {
    title: "LootLoop v0.3",
    subtitle: "Solana devnet 上的统一任务引擎。",
    wallet: "钱包",
    rpc: "RPC 节点",
    language: "语言",
    create: "创建任务",
    submit: "提交证明",
    approve: "通过提交",
    reject: "拒绝提交",
    fund: "补充资金",
    close: "关闭 / 结算",
    viewer: "状态查看器",
    detail: "任务详情",
    status: "状态",
    fee: "平台手续费：奖励池充值额外支付 2%，不会从 reward_pool 扣除。",
    closeRule:
      "如果 reward_pool 不足一份完整奖励，任务会进入不可恢复的 Closing。已有 pending 仍可审核，通过后由 deposit_pool 完整支付。提前 Closing 的剩余 reward/deposit 在押金扣 1% 后进入 public_goods_pool；到期 Closing 的剩余 reward/deposit 退回 publisher。",
    recurringRule:
      "周期任务只能提交链上当前周期 proof，不支持补交历史周期或提交未来周期。UserProgress 只保存 32 周期链上窗口，用于 pending/approved 去重；更早历史可存在 localStorage、IndexedDB 或 indexer，仅用于展示查询，不能作为协议凭证。",
    autoRule:
      "Auto-Review v1 是 verifier 签名模拟流程。不要在前端硬编码真实 verifier 私钥。真实环境应由 verifier server 检查链下数据、签名绑定结果，并把验证 TTL 控制在 1 小时内。",
  },
};

const bn = (value: string) => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error("Expected integer");
  return new anchor.BN(trimmed);
};

const solToLamports = (value: string) => {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(trimmed)) {
    throw new Error("SOL amount must have at most 9 decimals");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  return new anchor.BN(whole)
    .mul(new anchor.BN(LAMPORTS_PER_SOL))
    .add(new anchor.BN(fraction.padEnd(9, "0")));
};

const durationToSeconds = (days: string, hours: string, minutes: string) =>
  bn(days || "0")
    .mul(new anchor.BN(86_400))
    .add(bn(hours || "0").mul(new anchor.BN(3_600)))
    .add(bn(minutes || "0").mul(new anchor.BN(60)));

const enumName = (value: unknown) =>
  value && typeof value === "object" ? Object.keys(value as Record<string, unknown>)[0] : "";

const lamportsToSol = (value: number | anchor.BN) => {
  const lamports = typeof value === "number" ? value : value.toNumber();
  return (lamports / LAMPORTS_PER_SOL).toLocaleString(undefined, {
    maximumFractionDigits: 9,
  });
};

const isMultipleOfReward = (amount: anchor.BN, reward: anchor.BN) =>
  amount.isZero() || (reward.gt(new anchor.BN(0)) && amount.mod(reward).isZero());

const cycleStateLabel = (state: number) => {
  if (state === 1) return "Pending";
  if (state === 2) return "Approved";
  return "Empty / Rejected";
};

const hexToBytes = (value: string, length: number) => {
  const trimmed = value.trim().replace(/^0x/, "");
  if (!new RegExp(`^[0-9a-fA-F]{${length * 2}}$`).test(trimmed)) {
    throw new Error(`Expected ${length}-byte hex`);
  }
  return Array.from(Buffer.from(trimmed, "hex"));
};

const templateTypeIndex = (template: unknown) => {
  const key = enumName(template);
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

function App() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const [language, setLanguage] = useState<Language>(
    () => (localStorage.getItem("lootloop-language") as Language) || "en"
  );
  const t = copy[language];
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState<UiError | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [questRows, setQuestRows] = useState<QuestRow[]>([]);
  const [questListFilter, setQuestListFilter] = useState("all");
  const [questListLoading, setQuestListLoading] = useState(false);
  const [questListError, setQuestListError] = useState("");
  const [currentReviewSubmission, setCurrentReviewSubmission] =
    useState<LoadedSubmission | null>(null);
  const [reviewLoadStatus, setReviewLoadStatus] = useState("");

  const [mode, setMode] = useState<"oneTime" | "recurring">("oneTime");
  const [reviewMode, setReviewMode] = useState<"manual" | "autoVerified">("manual");
  const [verificationTemplate, setVerificationTemplate] = useState<
    "distanceActivity" | "studyDuration" | "githubContribution" | "attendanceCheckin" | "customSigned"
  >("customSigned");
  const [templateConfigHash, setTemplateConfigHash] = useState("00".repeat(32));
  const [verificationSchemaUri, setVerificationSchemaUri] = useState("");
  const [authorizedVerifier, setAuthorizedVerifier] = useState("");
  const [questId, setQuestId] = useState("1");
  const [metadataUri, setMetadataUri] = useState("https://example.com/quest.json");
  const [reviewer, setReviewer] = useState("");
  const [rewardPerCompletion, setRewardPerCompletion] = useState("0.001");
  const [initialRewardFunding, setInitialRewardFunding] = useState("0.003");
  const [depositAmount, setDepositAmount] = useState("0.003");
  const [queueMax, setQueueMax] = useState("2");
  const [durationDays, setDurationDays] = useState("0");
  const [durationHours, setDurationHours] = useState("0");
  const [durationMinutes, setDurationMinutes] = useState("1");
  const [periodDays, setPeriodDays] = useState("0");
  const [periodHours, setPeriodHours] = useState("0");
  const [periodMinutes, setPeriodMinutes] = useState("1");

  const [questPdaInput, setQuestPdaInput] = useState("");
  const [proofUri, setProofUri] = useState("https://example.com/proof.json");
  const [reviewQuestInput, setReviewQuestInput] = useState("");
  const [reviewIndexInput, setReviewIndexInput] = useState("0");
  const [autoVerifiedValue, setAutoVerifiedValue] = useState("100");
  const [autoExternalProofHash, setAutoExternalProofHash] = useState("11".repeat(32));
  const [autoVerifiedAt, setAutoVerifiedAt] = useState(() =>
    String(Math.floor(Date.now() / 1000))
  );
  const [autoExpiresAt, setAutoExpiresAt] = useState(() =>
    String(Math.floor(Date.now() / 1000) + 300)
  );
  const [autoNonce, setAutoNonce] = useState("22".repeat(32));
  const [autoSignature, setAutoSignature] = useState("");
  const [fundQuestInput, setFundQuestInput] = useState("");
  const [fundReward, setFundReward] = useState("0.001");
  const [fundDeposit, setFundDeposit] = useState("0");
  const [extendDays, setExtendDays] = useState("0");
  const [extendHours, setExtendHours] = useState("0");
  const [extendMinutes, setExtendMinutes] = useState("0");
  const [closeQuestInput, setCloseQuestInput] = useState("");
  const [viewerQuestInput, setViewerQuestInput] = useState("");
  const [lastQuest, setLastQuest] = useState("");
  const [lastRewardPool, setLastRewardPool] = useState("");
  const [lastDepositPool, setLastDepositPool] = useState("");
  const [lastShareLink, setLastShareLink] = useState("");
  const [lastSubmission, setLastSubmission] = useState("");
  const [questDetail, setQuestDetail] = useState<{
    quest: PublicKey;
    account: QuestAccount;
    rewardPoolBalance: number;
    depositPoolBalance: number;
    feeVaultBalance: number;
    publicGoodsPoolBalance: number;
    chainNow: number;
    currentCycleIndex: number;
    userProgress: UserProgressAccount | null;
  } | null>(null);

  useEffect(() => {
    localStorage.setItem("lootloop-language", language);
  }, [language]);

  const readOnlyProgram = useMemo(() => {
    const readOnlyWallet = {
      publicKey: SystemProgram.programId,
      signTransaction: async () => {
        throw new Error("Read-only provider cannot sign");
      },
      signAllTransactions: async () => {
        throw new Error("Read-only provider cannot sign");
      },
    } as unknown as anchor.Wallet;
    const provider = new anchor.AnchorProvider(
      connection,
      readOnlyWallet,
      anchor.AnchorProvider.defaultOptions()
    );
    return new Program<Lootloop>(idl as Lootloop, provider);
  }, [connection]);

  const program = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) return null;
    const provider = new anchor.AnchorProvider(
      connection,
      wallet as unknown as anchor.Wallet,
      anchor.AnchorProvider.defaultOptions()
    );
    return new Program<Lootloop>(idl as Lootloop, provider);
  }, [connection, wallet]);

  const deriveQuest = (id: anchor.BN, publisher: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("quest"), publisher.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
      PROGRAM_ID
    )[0];
  const deriveRewardPool = (quest: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("reward_pool"), quest.toBuffer()], PROGRAM_ID)[0];
  const deriveDepositPool = (quest: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("deposit_pool"), quest.toBuffer()], PROGRAM_ID)[0];
  const deriveSubmission = (quest: PublicKey, index: anchor.BN) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("submission"), quest.toBuffer(), index.toArrayLike(Buffer, "le", 8)],
      PROGRAM_ID
    )[0];
  const deriveUserProgress = (quest: PublicKey, user: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("user_progress"), quest.toBuffer(), user.toBuffer()],
      PROGRAM_ID
    )[0];
  const deriveUsedProof = (quest: PublicKey, externalProofHash: number[] | Buffer) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("used_proof"), quest.toBuffer(), Buffer.from(externalProofHash)],
      PROGRAM_ID
    )[0];
  const feeVault = () =>
    PublicKey.findProgramAddressSync([Buffer.from("fee_vault")], PROGRAM_ID)[0];
  const publicGoodsPool = () =>
    PublicKey.findProgramAddressSync([Buffer.from("public_goods_pool")], PROGRAM_ID)[0];

  const shortKey = (value: PublicKey | string) => {
    const text = value.toString();
    return `${text.slice(0, 4)}…${text.slice(-4)}`;
  };

  const formatTime = (seconds: anchor.BN | number) => {
    const value = typeof seconds === "number" ? seconds : seconds.toNumber();
    return new Date(value * 1000).toLocaleString();
  };

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setStatus("Copied");
  };

  const mapError = (err: unknown, label: string): UiError => {
    const anyErr = err as any;
    const code = anyErr.error?.errorCode?.code ?? "";
    const raw = err instanceof Error ? err.message : String(err);
    const friendly: Record<string, string> = {
      QueueFull: "The quest queue is full. Try again after a reviewer clears pending submissions.",
      InvalidQuestStatus: "This quest is not in a status that allows this action.",
      Unauthorized: "Your wallet is not authorized for this action.",
      InvalidReviewMode: "This action does not match the quest review mode.",
      InvalidVerifierSignature: "The verifier signature does not match the expected message.",
      VerificationExpired: "The verification result has expired.",
      RewardFundingNotMultipleOfReward:
        "Reward funding must be an integer multiple of reward_per_completion.",
      DepositNotMultipleOfReward:
        "Deposit funding must be an integer multiple of reward_per_completion.",
      InsufficientDeposit: "Deposit is below the required amount for this queue size.",
    };
    let message = friendly[code] ?? raw;
    if (
      label === "auto_approve_submission" &&
      /already in use|already initialized|AccountAlreadyInitialized|usedProof/i.test(raw)
    ) {
      message = "This external proof has already been used for this quest.";
    }
    return { message, details: raw };
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    try {
      setError(null);
      setStatus(`${label}...`);
      await fn();
      setStatus(`${label} complete`);
    } catch (err) {
      setError(mapError(err, label));
      setStatus(`${label} failed`);
    }
  };

  const loadQuestList = async () => {
    setQuestListLoading(true);
    setQuestListError("");
    try {
      const rows = await readOnlyProgram.account.quest.all();
      rows.sort((a, b) => b.account.startAt.toNumber() - a.account.startAt.toNumber());
      setQuestRows(rows);
    } catch (err) {
      setQuestListError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuestListLoading(false);
    }
  };

  const fetchQuest = async (questText: string) => {
    const quest = new PublicKey(questText.trim());
    const slot = await connection.getSlot("confirmed");
    const chainNow = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
    const [account, rewardPoolBalance, depositPoolBalance, feeVaultBalance, publicGoodsPoolBalance] =
      await Promise.all([
        readOnlyProgram.account.quest.fetch(quest),
        connection.getBalance(deriveRewardPool(quest)),
        connection.getBalance(deriveDepositPool(quest)),
        connection.getBalance(feeVault()),
        connection.getBalance(publicGoodsPool()),
      ]);
    const currentCycleIndex =
      enumName(account.mode) === "recurring"
        ? Math.max(
            0,
            Math.floor(
              (chainNow - account.startAt.toNumber()) /
                Math.max(1, account.periodSeconds.toNumber())
            )
          )
        : 0;
    let userProgress: UserProgressAccount | null = null;
    if (wallet.publicKey) {
      try {
        userProgress = await readOnlyProgram.account.userProgress.fetch(
          deriveUserProgress(quest, wallet.publicKey)
        );
      } catch {
        userProgress = null;
      }
    }
    setQuestDetail({
      quest,
      account,
      rewardPoolBalance,
      depositPoolBalance,
      feeVaultBalance,
      publicGoodsPoolBalance,
      chainNow,
      currentCycleIndex,
      userProgress,
    });
    setQuestPdaInput(quest.toString());
    setReviewQuestInput(quest.toString());
    setFundQuestInput(quest.toString());
    setCloseQuestInput(quest.toString());
    setViewerQuestInput(quest.toString());
    await loadCurrentReviewSubmission(quest.toString(), account);
  };

  const loadCurrentReviewSubmission = async (
    questText = reviewQuestInput,
    questAccount?: QuestAccount
  ) => {
    setReviewLoadStatus("Loading review item...");
    setCurrentReviewSubmission(null);
    try {
      const quest = new PublicKey(questText.trim());
      const account = questAccount ?? (await readOnlyProgram.account.quest.fetch(quest));
      setReviewQuestInput(quest.toString());
      setReviewIndexInput(account.nextReviewIndex.toString());
      if (account.pendingCount === 0) {
        setReviewLoadStatus("No pending submissions");
        return;
      }
      const submission = deriveSubmission(quest, account.nextReviewIndex);
      const submissionAccount = await readOnlyProgram.account.submission.fetch(submission);
      setCurrentReviewSubmission({ pda: submission, account: submissionAccount });
      setReviewLoadStatus("Review item loaded");
    } catch (err) {
      setReviewLoadStatus(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    const match = window.location.pathname.match(/^\/quest\/([^/]+)$/);
    if (match) {
      setActiveTab("detail");
      setViewerQuestInput(match[1]);
      fetchQuest(match[1]).catch((err) =>
        setError(mapError(err, "fetch_quest"))
      );
    }
  }, [readOnlyProgram]);

  useEffect(() => {
    loadQuestList();
  }, [readOnlyProgram]);

  const rewardLamportsPreview = solToLamports(rewardPerCompletion || "0");
  const initialFundingPreview = solToLamports(initialRewardFunding || "0");
  const depositPreview = solToLamports(depositAmount || "0");
  const fundRewardPreview = solToLamports(fundReward || "0");
  const fundDepositPreview = solToLamports(fundDeposit || "0");
  const requiredDeposit = rewardLamportsPreview.mul(new anchor.BN(Number(queueMax || "0") + 1));
  const createFee = initialFundingPreview
    .mul(new anchor.BN(PLATFORM_FEE_BPS))
    .div(new anchor.BN(BPS_DENOMINATOR));
  const fundFee = fundRewardPreview
    .mul(new anchor.BN(PLATFORM_FEE_BPS))
    .div(new anchor.BN(BPS_DENOMINATOR));
  const createFundingMultiple = isMultipleOfReward(initialFundingPreview, rewardLamportsPreview);
  const createDepositMultiple = isMultipleOfReward(depositPreview, rewardLamportsPreview);
  const createDepositEnough = depositPreview.gte(requiredDeposit);
  const createDuration = durationToSeconds(durationDays, durationHours, durationMinutes);
  const createPeriod =
    mode === "recurring"
      ? durationToSeconds(periodDays, periodHours, periodMinutes)
      : new anchor.BN(0);
  const createDurationValid = createDuration.gte(new anchor.BN(MIN_DURATION_SECONDS));
  const createPeriodValid = mode === "oneTime" || createPeriod.gt(new anchor.BN(0));
  const autoCreateValid =
    reviewMode === "manual" ||
    (authorizedVerifier.trim().length > 0 &&
      verificationSchemaUri.trim().length > 0 &&
      !/^0+$/.test(templateConfigHash.trim().replace(/^0x/, "")));
  const createFormValid =
    createFundingMultiple &&
    createDepositMultiple &&
    createDepositEnough &&
    autoCreateValid &&
    createDurationValid &&
    createPeriodValid;
  const viewedStatus = questDetail ? enumName(questDetail.account.status) : "";
  const selectedQuestExpired = questDetail
    ? questDetail.chainNow >= questDetail.account.expiresAt.toNumber()
    : false;
  const currentCycleState =
    questDetail?.userProgress && enumName(questDetail.account.mode) === "recurring"
      ? questDetail.userProgress.recentCycles.findIndex(
          (cycle) => cycle.toNumber() === questDetail.currentCycleIndex
        )
      : -1;
  const currentUserCycleState =
    currentCycleState >= 0 && questDetail?.userProgress
      ? questDetail.userProgress.recentCycleStates[currentCycleState]
      : 0;
  const currentUserCanSubmit =
    !questDetail ||
    enumName(questDetail.account.mode) === "oneTime"
      ? !questDetail?.userProgress ||
        (!questDetail.userProgress.oneTimeCompleted && !questDetail.userProgress.pendingOneTime)
      : currentUserCycleState === 0;
  const submitDisabled =
    !questDetail ||
    viewedStatus !== "open" ||
    selectedQuestExpired ||
    questDetail.account.pendingCount >= questDetail.account.queueMax ||
    !currentUserCanSubmit;
  const isPublisher =
    !!questDetail &&
    !!wallet.publicKey &&
    questDetail.account.publisher.toString() === wallet.publicKey.toString();
  const fundDisabled = !questDetail || viewedStatus !== "open" || !isPublisher;
  const closeDisabled = !questDetail || viewedStatus !== "open" || !isPublisher;
  const settleDisabled =
    !questDetail || viewedStatus !== "closing" || questDetail.account.pendingCount !== 0;
  const autoVerifiedAtNumber = /^\d+$/.test(autoVerifiedAt.trim())
    ? Number(autoVerifiedAt)
    : 0;
  const autoExpiresAtNumber = /^\d+$/.test(autoExpiresAt.trim())
    ? Number(autoExpiresAt)
    : 0;
  const autoNow = Math.floor(Date.now() / 1000);
  const autoExpiresFuture = autoExpiresAtNumber > autoNow;
  const autoTtlSeconds = autoExpiresAtNumber - autoVerifiedAtNumber;
  const autoTtlValid =
    autoVerifiedAtNumber <= autoNow &&
    autoExpiresAtNumber > autoVerifiedAtNumber &&
    autoTtlSeconds <= MAX_VERIFICATION_TTL_SECONDS;
  const autoUsedProofPreview = (() => {
    try {
      if (!reviewQuestInput.trim()) return "";
      return deriveUsedProof(
        new PublicKey(reviewQuestInput.trim()),
        hexToBytes(autoExternalProofHash, 32)
      ).toString();
    } catch {
      return "";
    }
  })();
  const cycleWindowRows =
    questDetail?.userProgress && enumName(questDetail.account.mode) === "recurring"
      ? questDetail.userProgress.recentCycles
          .map((cycle, idx) => ({
            cycle: cycle.toNumber(),
            state: questDetail.userProgress!.recentCycleStates[idx],
          }))
          .filter((row) => row.state !== 0)
          .sort((a, b) => b.cycle - a.cycle)
      : [];
  const filteredQuestRows = questRows.filter((row) => {
    const statusName = enumName(row.account.status);
    const modeName = enumName(row.account.mode);
    const reviewName = enumName(row.account.reviewMode);
    return (
      questListFilter === "all" ||
      statusName === questListFilter ||
      modeName === questListFilter ||
      reviewName === questListFilter
    );
  });
  const selectedQuestPda = questDetail?.quest.toString() ?? "";
  const selectedReviewMode = questDetail ? enumName(questDetail.account.reviewMode) : "";
  const selectedMode = questDetail ? enumName(questDetail.account.mode) : "";
  const selectedUserProgressPda =
    questDetail && wallet.publicKey ? deriveUserProgress(questDetail.quest, wallet.publicKey) : null;
  const currentUserStateText =
    selectedMode === "oneTime"
      ? questDetail?.userProgress?.oneTimeCompleted
        ? "Completed"
        : questDetail?.userProgress?.pendingOneTime
          ? "Pending"
          : "Empty / Rejected"
      : cycleStateLabel(currentUserCycleState);
  const fundRewardMultiple =
    questDetail && isMultipleOfReward(fundRewardPreview, questDetail.account.rewardPerCompletion);
  const fundDepositMultiple =
    questDetail && isMultipleOfReward(fundDepositPreview, questDetail.account.rewardPerCompletion);
  const canManualApprove =
    selectedReviewMode === "manual" && !!currentReviewSubmission && viewedStatus !== "closed";
  const canAutoApprove =
    selectedReviewMode === "autoVerified" &&
    !!currentReviewSubmission &&
    autoExpiresFuture &&
    autoTtlValid &&
    viewedStatus !== "closed";

  const createQuest = async () => {
    if (!program || !wallet.publicKey) throw new Error("Connect wallet first");
    const id = bn(questId);
    const quest = deriveQuest(id, wallet.publicKey);
    const rewardPool = deriveRewardPool(quest);
    const depositPool = deriveDepositPool(quest);
    const duration = durationToSeconds(durationDays, durationHours, durationMinutes);
    const period = mode === "recurring" ? durationToSeconds(periodDays, periodHours, periodMinutes) : new anchor.BN(0);
    const reward = solToLamports(rewardPerCompletion);
    const initialFunding = solToLamports(initialRewardFunding);
    const deposit = solToLamports(depositAmount);
    if (duration.toNumber() < MIN_DURATION_SECONDS) throw new Error("Minimum duration is 1 minute");
    if (!isMultipleOfReward(initialFunding, reward)) {
      throw new Error("initial_reward_funding must be a multiple of reward_per_completion");
    }
    if (!isMultipleOfReward(deposit, reward)) {
      throw new Error("deposit_amount must be a multiple of reward_per_completion");
    }
    if (deposit.lt(requiredDeposit)) throw new Error("Deposit is below required_deposit");
    const parsedTemplateHash =
      reviewMode === "autoVerified" ? hexToBytes(templateConfigHash, 32) : Array(32).fill(0);
    const verifier =
      reviewMode === "autoVerified"
        ? new PublicKey(authorizedVerifier.trim())
        : DEFAULT_PUBKEY;

    await program.methods
      .createQuest(
        id,
        mode === "oneTime" ? { oneTime: {} } : { recurring: {} },
        reviewMode === "manual" ? { manual: {} } : { autoVerified: {} },
        { [verificationTemplate]: {} } as any,
        parsedTemplateHash,
        verificationSchemaUri,
        verifier,
        metadataUri,
        new PublicKey(reviewer.trim()),
        reward,
        initialFunding,
        deposit,
        duration,
        period,
        Number(queueMax)
      )
      .accountsPartial({
        quest,
        rewardPool,
        depositPool,
        feeVault: feeVault(),
        publicGoodsPool: publicGoodsPool(),
        publisher: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const shareLink = `${window.location.origin}/quest/${quest.toString()}`;
    setLastQuest(quest.toString());
    setLastRewardPool(rewardPool.toString());
    setLastDepositPool(depositPool.toString());
    setLastShareLink(shareLink);
    setQuestPdaInput(quest.toString());
    setViewerQuestInput(quest.toString());
    await fetchQuest(quest.toString());
    await loadQuestList();
    setActiveTab("detail");
  };

  const submitProof = async () => {
    if (!program || !wallet.publicKey) throw new Error("Connect wallet first");
    const quest = new PublicKey(questPdaInput.trim());
    const account = await readOnlyProgram.account.quest.fetch(quest);
    const submission = deriveSubmission(quest, account.nextSubmissionIndex);
    const userProgress = deriveUserProgress(quest, wallet.publicKey);
    await program.methods
      .submitProof(proofUri)
      .accountsPartial({
        quest,
        submission,
        userProgress,
        submitter: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    setLastSubmission(submission.toString());
    await fetchQuest(quest.toString());
    await loadQuestList();
  };

  const loadSubmission = async (quest: PublicKey): Promise<SubmissionAccount> => {
    const submission = deriveSubmission(quest, bn(reviewIndexInput));
    return readOnlyProgram.account.submission.fetch(submission);
  };

  const approveOrReject = async (approve: boolean) => {
    if (!program || !wallet.publicKey) throw new Error("Connect wallet first");
    const quest = new PublicKey(reviewQuestInput.trim());
    const submission = deriveSubmission(quest, bn(reviewIndexInput));
    const submissionAccount = await loadSubmission(quest);
    const userProgress = deriveUserProgress(quest, submissionAccount.submitter);
    const baseAccounts = {
      quest,
      submission,
      userProgress,
      reviewer: wallet.publicKey,
    };
    if (approve) {
      await program.methods
        .approveSubmission()
        .accountsPartial({
          ...baseAccounts,
          submitter: submissionAccount.submitter,
          rewardPool: deriveRewardPool(quest),
          depositPool: deriveDepositPool(quest),
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } else {
      await program.methods.rejectSubmission().accountsPartial(baseAccounts).rpc();
    }
    await fetchQuest(quest.toString());
    await loadQuestList();
  };

  const autoApproveSubmission = async () => {
    if (!program || !wallet.publicKey) throw new Error("Connect wallet first");
    const quest = new PublicKey(reviewQuestInput.trim());
    const account = await readOnlyProgram.account.quest.fetch(quest);
    if (enumName(account.reviewMode) !== "autoVerified") {
      throw new Error("auto_approve_submission only supports AutoVerified quests");
    }
    const submission = deriveSubmission(quest, bn(reviewIndexInput));
    const submissionAccount = await readOnlyProgram.account.submission.fetch(submission);
    const userProgress = deriveUserProgress(quest, submissionAccount.submitter);
    const slot = await connection.getSlot("confirmed");
    const now = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
    const verifiedAt = bn(autoVerifiedAt);
    const expiresAt = bn(autoExpiresAt);
    if (verifiedAt.gt(new anchor.BN(now))) {
      throw new Error("verified_at cannot be in the future");
    }
    if (expiresAt.lte(new anchor.BN(now))) {
      throw new Error("expires_at must be greater than current time");
    }
    if (
      expiresAt.lte(verifiedAt) ||
      expiresAt.sub(verifiedAt).gt(new anchor.BN(MAX_VERIFICATION_TTL_SECONDS))
    ) {
      throw new Error("verification TTL must be greater than 0 and no more than 3600 seconds");
    }
    const externalProofHash = hexToBytes(autoExternalProofHash, 32);
    const usedProof = deriveUsedProof(quest, externalProofHash);
    const verificationResult = {
      domain: "LootLoopAutoReviewV1",
      programId: PROGRAM_ID,
      quest,
      submissionIndex: submissionAccount.submissionIndex,
      submitter: submissionAccount.submitter,
      cycleIndex: submissionAccount.cycleIndex,
      templateType: account.verificationTemplate,
      templateConfigHash: Array.from(account.templateConfigHash),
      externalProofHash,
      verifiedValue: bn(autoVerifiedValue),
      passed: true,
      verifiedAt,
      expiresAt,
      nonce: hexToBytes(autoNonce, 32),
    };
    const message = serializeVerificationResult(verificationResult);
    const signature = Uint8Array.from(hexToBytes(autoSignature, 64));
    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: account.authorizedVerifier.toBytes(),
      message,
      signature,
    });
    const autoIx = await program.methods
      .autoApproveSubmission(externalProofHash, verificationResult as any)
      .accountsPartial({
        quest,
        submission,
        submitter: submissionAccount.submitter,
        userProgress,
        rewardPool: deriveRewardPool(quest),
        depositPool: deriveDepositPool(quest),
        usedProof,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        caller: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const tx = new anchor.web3.Transaction().add(ed25519Ix, autoIx);
    await (program.provider as anchor.AnchorProvider).sendAndConfirm(tx);
    await fetchQuest(quest.toString());
    await loadQuestList();
  };

  const fundQuest = async () => {
    if (!program || !wallet.publicKey) throw new Error("Connect wallet first");
    const quest = new PublicKey(fundQuestInput.trim());
    const account = await readOnlyProgram.account.quest.fetch(quest);
    if (enumName(account.status) !== "open") throw new Error("fund_quest only supports Open quests");
    const rewardFunding = solToLamports(fundReward);
    const additionalDeposit = solToLamports(fundDeposit);
    if (!isMultipleOfReward(rewardFunding, account.rewardPerCompletion)) {
      throw new Error("reward_funding_amount must be a multiple of reward_per_completion");
    }
    if (!isMultipleOfReward(additionalDeposit, account.rewardPerCompletion)) {
      throw new Error("additional_deposit_amount must be a multiple of reward_per_completion");
    }
    await program.methods
      .fundQuest(
        rewardFunding,
        additionalDeposit,
        durationToSeconds(extendDays, extendHours, extendMinutes)
      )
      .accountsPartial({
        quest,
        rewardPool: deriveRewardPool(quest),
        depositPool: deriveDepositPool(quest),
        feeVault: feeVault(),
        publisher: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await fetchQuest(quest.toString());
    await loadQuestList();
  };

  const closeQuest = async () => {
    if (!program || !wallet.publicKey) throw new Error("Connect wallet first");
    const quest = new PublicKey(closeQuestInput.trim());
    await program.methods
      .closeQuest()
      .accountsPartial({
        quest,
        rewardPool: deriveRewardPool(quest),
        depositPool: deriveDepositPool(quest),
        feeVault: feeVault(),
        publicGoodsPool: publicGoodsPool(),
        publisher: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await fetchQuest(quest.toString());
    await loadQuestList();
  };

  const settleQuest = async () => {
    if (!program || !wallet.publicKey) throw new Error("Connect wallet first");
    const quest = new PublicKey(closeQuestInput.trim());
    const account = await readOnlyProgram.account.quest.fetch(quest);
    await program.methods
      .settleQuest()
      .accountsPartial({
        quest,
        rewardPool: deriveRewardPool(quest),
        depositPool: deriveDepositPool(quest),
        publisher: account.publisher,
        feeVault: feeVault(),
        publicGoodsPool: publicGoodsPool(),
        caller: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await fetchQuest(quest.toString());
    await loadQuestList();
  };

  return (
    <main>
      <header>
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="header-actions">
          <select
            className="language-select"
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
          <WalletMultiButton />
        </div>
      </header>

      <div className="status">
        <span>{t.wallet}</span>
        <code>{wallet.publicKey?.toString() ?? "Not connected"}</code>
        <span>{t.rpc}</span>
        <code>{RPC_ENDPOINT}</code>
        <span>{t.status}</span>
        <code>{status}</code>
      </div>
      {error && (
        <section className="error">
          <strong>{error.message}</strong>
          <details>
            <summary>Raw details</summary>
            <pre>{error.details}</pre>
          </details>
        </section>
      )}

      <nav className="tabs">
        {[
          ["dashboard", "Dashboard"],
          ["detail", "Quest Detail"],
          ["create", "Create Quest"],
          ["submitter", "Submitter Tools"],
          ["reviewer", "Reviewer Tools"],
          ["publisher", "Publisher Tools"],
          ["state", "Protocol State"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={activeTab === key ? "tab active" : "tab"}
            onClick={() => setActiveTab(key as Tab)}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="notice">
        <p>{t.fee}</p>
        <p>{t.closeRule}</p>
        <p>{t.recurringRule}</p>
        <p>{t.autoRule}</p>
      </section>

      {activeTab === "dashboard" && (
        <section>
          <div className="section-head">
            <div>
              <h2>Dashboard / Quest List</h2>
              <p className="note">Browse Quest accounts owned by the current program.</p>
            </div>
            <button onClick={() => run("load_quests", loadQuestList)}>Refresh</button>
          </div>
          <div className="filters">
            {["all", "open", "closing", "closed", "manual", "autoVerified", "oneTime", "recurring"].map(
              (filter) => (
                <button
                  key={filter}
                  className={questListFilter === filter ? "chip active" : "chip"}
                  onClick={() => setQuestListFilter(filter)}
                >
                  {filter === "all" ? "All" : filter}
                </button>
              )
            )}
          </div>
          {questListLoading && <p className="note">Loading quests...</p>}
          {questListError && <p className="note danger">{questListError}</p>}
          {!questListLoading && filteredQuestRows.length === 0 && (
            <p className="note">No quests match this filter.</p>
          )}
          {filteredQuestRows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Quest PDA</th>
                    <th>metadata_uri</th>
                    <th>mode</th>
                    <th>review</th>
                    <th>status</th>
                    <th>reward</th>
                    <th>queue</th>
                    <th>next</th>
                    <th>expires</th>
                    <th>actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuestRows.map((row) => (
                    <tr key={row.publicKey.toString()}>
                      <td><code>{shortKey(row.publicKey)}</code></td>
                      <td><code>{row.account.metadataUri}</code></td>
                      <td>{enumName(row.account.mode)}</td>
                      <td>{enumName(row.account.reviewMode)}</td>
                      <td><span className={`pill ${enumName(row.account.status)}`}>{enumName(row.account.status)}</span></td>
                      <td>{lamportsToSol(row.account.rewardPerCompletion)} SOL</td>
                      <td>{row.account.pendingCount} / {row.account.queueMax}</td>
                      <td>{row.account.nextSubmissionIndex.toString()} / {row.account.nextReviewIndex.toString()}</td>
                      <td>{formatTime(row.account.expiresAt)}</td>
                      <td className="row-actions">
                        <button
                          onClick={() =>
                            run("fetch_quest", async () => {
                              await fetchQuest(row.publicKey.toString());
                              window.history.replaceState(null, "", `/quest/${row.publicKey.toString()}`);
                              setActiveTab("detail");
                            })
                          }
                        >
                          View
                        </button>
                        <button className="secondary" onClick={() => copyText(row.publicKey.toString())}>Copy</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === "detail" && (
        <section>
          <div className="section-head">
            <div>
              <h2>Quest Detail</h2>
              <p className="note">Open a quest by PDA, then use submitter, reviewer, and publisher tools against the same selection.</p>
            </div>
            <div className="inline-actions">
              <input value={viewerQuestInput} onChange={(e) => setViewerQuestInput(e.target.value)} placeholder="Quest PDA" />
              <button onClick={() => run("fetch_quest", () => fetchQuest(viewerQuestInput))}>Load</button>
            </div>
          </div>
          {!questDetail && <p className="note">Select a quest from the dashboard or paste a Quest PDA.</p>}
          {questDetail && (
            <>
              <div className="summary-grid">
                <div><span>Quest</span><code>{selectedQuestPda}</code></div>
                <div><span>Status</span><strong>{viewedStatus}</strong></div>
                <div><span>Mode</span><strong>{selectedMode}</strong></div>
                <div><span>Review</span><strong>{selectedReviewMode}</strong></div>
                <div><span>Reward</span><strong>{lamportsToSol(questDetail.account.rewardPerCompletion)} SOL</strong></div>
                <div><span>Queue</span><strong>{questDetail.account.pendingCount} / {questDetail.account.queueMax}</strong></div>
              </div>

              <div className="detail-columns">
                <dl>
                  <dt>publisher</dt><dd><code>{questDetail.account.publisher.toString()}</code></dd>
                  <dt>reviewer</dt><dd><code>{questDetail.account.reviewer.toString()}</code></dd>
                  <dt>verification_template</dt><dd>{enumName(questDetail.account.verificationTemplate)}</dd>
                  <dt>authorized_verifier</dt><dd><code>{questDetail.account.authorizedVerifier.toString()}</code></dd>
                  <dt>closing_reason</dt><dd>{enumName(questDetail.account.closingReason)}</dd>
                  <dt>metadata_uri</dt><dd><code>{questDetail.account.metadataUri}</code></dd>
                  <dt>verification_schema_uri</dt><dd><code>{questDetail.account.verificationSchemaUri || "n/a"}</code></dd>
                </dl>
                <dl>
                  <dt>reward_pool</dt><dd>{lamportsToSol(questDetail.rewardPoolBalance)} SOL</dd>
                  <dt>deposit_pool</dt><dd>{lamportsToSol(questDetail.depositPoolBalance)} SOL</dd>
                  <dt>fee_vault</dt><dd>{lamportsToSol(questDetail.feeVaultBalance)} SOL</dd>
                  <dt>public_goods_pool</dt><dd>{lamportsToSol(questDetail.publicGoodsPoolBalance)} SOL</dd>
                  <dt>total_reward_funded</dt><dd>{lamportsToSol(questDetail.account.totalRewardFunded)} SOL</dd>
                  <dt>total_deposit_funded</dt><dd>{lamportsToSol(questDetail.account.totalDepositFunded)} SOL</dd>
                  <dt>total_fee_paid</dt><dd>{lamportsToSol(questDetail.account.totalFeePaid)} SOL</dd>
                  <dt>total_paid_amount</dt><dd>{lamportsToSol(questDetail.account.totalPaidAmount)} SOL</dd>
                </dl>
                <dl>
                  <dt>next_submission_index</dt><dd>{questDetail.account.nextSubmissionIndex.toString()}</dd>
                  <dt>next_review_index</dt><dd>{questDetail.account.nextReviewIndex.toString()}</dd>
                  <dt>start_at</dt><dd>{formatTime(questDetail.account.startAt)}</dd>
                  <dt>expires_at</dt><dd>{formatTime(questDetail.account.expiresAt)}</dd>
                  <dt>current time</dt><dd>{formatTime(questDetail.chainNow)}</dd>
                  <dt>expired</dt><dd>{selectedQuestExpired ? "yes" : "no"}</dd>
                  <dt>current_cycle_index</dt><dd>{selectedMode === "recurring" ? questDetail.currentCycleIndex : "n/a"}</dd>
                </dl>
              </div>
            </>
          )}
        </section>
      )}

      {activeTab === "create" && (
        <section>
          <h2>{t.create}</h2>
          <div className="form-grid">
          <label>
            mode
            <select value={mode} onChange={(event) => setMode(event.target.value as "oneTime" | "recurring")}>
              <option value="oneTime">OneTime</option>
              <option value="recurring">Recurring</option>
            </select>
          </label>
          <label>
            review_mode
            <select value={reviewMode} onChange={(event) => setReviewMode(event.target.value as "manual" | "autoVerified")}>
              <option value="manual">Manual</option>
              <option value="autoVerified">AutoVerified</option>
            </select>
          </label>
          <label>
            verification_template
            <select disabled={reviewMode === "manual"} value={verificationTemplate} onChange={(event) => setVerificationTemplate(event.target.value as typeof verificationTemplate)}>
              <option value="distanceActivity">DistanceActivity</option>
              <option value="studyDuration">StudyDuration</option>
              <option value="githubContribution">GithubContribution</option>
              <option value="attendanceCheckin">AttendanceCheckin</option>
              <option value="customSigned">CustomSigned</option>
            </select>
          </label>
          <label>authorized_verifier<input disabled={reviewMode === "manual"} value={authorizedVerifier} onChange={(e) => setAuthorizedVerifier(e.target.value)} placeholder="Verifier pubkey" /></label>
          <label>template_config_hash hex<input disabled={reviewMode === "manual"} value={templateConfigHash} onChange={(e) => setTemplateConfigHash(e.target.value)} /></label>
          <label>verification_schema_uri<input disabled={reviewMode === "manual"} value={verificationSchemaUri} onChange={(e) => setVerificationSchemaUri(e.target.value)} placeholder="https://.../schema.json" /></label>
          <label>quest_id<input value={questId} onChange={(e) => setQuestId(e.target.value)} /></label>
          <label>metadata_uri<input value={metadataUri} onChange={(e) => setMetadataUri(e.target.value)} /></label>
          <label>reviewer<input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Reviewer pubkey" /></label>
          <label>reward_per_completion SOL<input value={rewardPerCompletion} onChange={(e) => setRewardPerCompletion(e.target.value)} /></label>
          <label>initial_reward_funding SOL<input value={initialRewardFunding} onChange={(e) => setInitialRewardFunding(e.target.value)} /></label>
          <label>deposit_amount SOL<input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} /></label>
          <label>queue_max<input value={queueMax} onChange={(e) => setQueueMax(e.target.value)} /></label>
          <div className="duration">
            <label>days<input value={durationDays} onChange={(e) => setDurationDays(e.target.value)} /></label>
            <label>hours<input value={durationHours} onChange={(e) => setDurationHours(e.target.value)} /></label>
            <label>minutes<input value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} /></label>
          </div>
          <div className="duration">
            <label>period days<input disabled={mode === "oneTime"} value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} /></label>
            <label>period hours<input disabled={mode === "oneTime"} value={periodHours} onChange={(e) => setPeriodHours(e.target.value)} /></label>
            <label>period minutes<input disabled={mode === "oneTime"} value={periodMinutes} onChange={(e) => setPeriodMinutes(e.target.value)} /></label>
          </div>
          <p className="note">required_deposit: {lamportsToSol(requiredDeposit)} SOL</p>
          <p className="note">platform fee: {lamportsToSol(createFee)} SOL</p>
          {!createFundingMultiple && <p className="note">initial_reward_funding must be a multiple of reward_per_completion.</p>}
          {!createDepositMultiple && <p className="note">deposit_amount must be a multiple of reward_per_completion.</p>}
          {!createDepositEnough && <p className="note">deposit_amount must be at least required_deposit.</p>}
          {!createDurationValid && <p className="note">duration must be at least {MIN_DURATION_SECONDS} seconds.</p>}
          {!createPeriodValid && <p className="note">Recurring quests require a positive period.</p>}
          {reviewMode === "autoVerified" && !autoCreateValid && <p className="note">AutoVerified requires verifier, schema URI, and a non-zero 32-byte template hash.</p>}
          </div>
          <button disabled={!createFormValid} onClick={() => run("create_quest", createQuest)}>{t.create}</button>
          {lastQuest && (
            <div className="output">
              <span>Quest PDA</span><code>{lastQuest}</code>
              <span>RewardPool PDA</span><code>{lastRewardPool}</code>
              <span>DepositPool PDA</span><code>{lastDepositPool}</code>
              <span>Share Link</span><code>{lastShareLink}</code>
            </div>
          )}
        </section>
      )}

      {activeTab === "submitter" && (
        <section>
          <h2>User / Submitter Tools</h2>
          <div className="inline-actions">
            <input value={questPdaInput} onChange={(e) => setQuestPdaInput(e.target.value)} placeholder="Quest PDA" />
            <button onClick={() => run("fetch_quest", () => fetchQuest(questPdaInput))}>Load Quest</button>
          </div>
          {questDetail && (
            <div className="summary-grid compact">
              <div><span>status</span><strong>{viewedStatus}</strong></div>
              <div><span>queue</span><strong>{questDetail.account.pendingCount} / {questDetail.account.queueMax}</strong></div>
              <div><span>expired</span><strong>{selectedQuestExpired ? "yes" : "no"}</strong></div>
              <div><span>your state</span><strong>{currentUserStateText}</strong></div>
              <div><span>UserProgress PDA</span><code>{selectedUserProgressPda?.toString() ?? "connect wallet"}</code></div>
              <div><span>can submit</span><strong>{!submitDisabled ? "yes" : "no"}</strong></div>
            </div>
          )}
          <label>proof_uri<input value={proofUri} onChange={(e) => setProofUri(e.target.value)} /></label>
          {questDetail && <p className="note">pending_count / queue_max: {questDetail.account.pendingCount} / {questDetail.account.queueMax}</p>}
          {questDetail && enumName(questDetail.account.mode) === "oneTime" && <p className="note">OneTime: each user can complete once.</p>}
          {questDetail && enumName(questDetail.account.mode) === "recurring" && (
            <p className="note">
              current_cycle_index: {questDetail.currentCycleIndex}; your state: {cycleStateLabel(currentUserCycleState)}
            </p>
          )}
          {questDetail && questDetail.account.pendingCount >= questDetail.account.queueMax && <p className="note">Queue is full.</p>}
          {questDetail && selectedQuestExpired && <p className="note">Quest is expired.</p>}
          <button disabled={submitDisabled} onClick={() => run("submit_proof", submitProof)}>{t.submit}</button>
          {lastSubmission && (
            <div className="output">
              <span>submission_index</span><code>{questDetail?.account.nextSubmissionIndex.sub(new anchor.BN(1)).toString() ?? "latest"}</code>
              <span>Submission PDA</span><code>{lastSubmission}</code>
              <span>status</span><code>Pending</code>
            </div>
          )}
        </section>
      )}

      {activeTab === "reviewer" && (
        <section>
          <h2>Reviewer Tools</h2>
          <div className="inline-actions">
            <input value={reviewQuestInput} onChange={(e) => setReviewQuestInput(e.target.value)} placeholder="Quest PDA" />
            <button onClick={() => run("load_review_item", async () => {
              await fetchQuest(reviewQuestInput);
              await loadCurrentReviewSubmission(reviewQuestInput);
            })}>Load Next</button>
          </div>
          {questDetail && <p className="note">review_mode: {selectedReviewMode}; next_review_index: {questDetail.account.nextReviewIndex.toString()}</p>}
          <p className="note">{reviewLoadStatus}</p>
          {currentReviewSubmission ? (
            <dl>
              <dt>submission PDA</dt><dd><code>{currentReviewSubmission.pda.toString()}</code></dd>
              <dt>submission_index</dt><dd>{currentReviewSubmission.account.submissionIndex.toString()}</dd>
              <dt>submitter</dt><dd><code>{currentReviewSubmission.account.submitter.toString()}</code></dd>
              <dt>cycle_index</dt><dd>{currentReviewSubmission.account.cycleIndex.toString()}</dd>
              <dt>proof_uri</dt><dd><code>{currentReviewSubmission.account.proofUri}</code></dd>
              <dt>status</dt><dd>{enumName(currentReviewSubmission.account.status)}</dd>
              <dt>submitted_at</dt><dd>{formatTime(currentReviewSubmission.account.submittedAt)}</dd>
            </dl>
          ) : (
            <p className="note">No pending submission loaded.</p>
          )}
          <div className="button-row">
            {selectedReviewMode === "manual" && (
              <button disabled={!canManualApprove} onClick={() => run("approve_submission", () => approveOrReject(true))}>{t.approve}</button>
            )}
            <button disabled={!currentReviewSubmission || viewedStatus === "closed"} onClick={() => run("reject_submission", () => approveOrReject(false))}>{t.reject}</button>
          </div>
          {selectedReviewMode === "autoVerified" && (
          <div className="detail-form">
            <h2>Auto Approve</h2>
            <p className="note">Mock verifier signature flow: paste a verifier-server signature for the Borsh LootLoopAutoReviewV1 message. Do not put real verifier private keys in frontend code.</p>
            {questDetail && <p className="note">template_config_hash: {Buffer.from(questDetail.account.templateConfigHash).toString("hex")}</p>}
            {autoUsedProofPreview && <p className="note">UsedProof PDA: {autoUsedProofPreview}</p>}
            <label>verified_value<input value={autoVerifiedValue} onChange={(e) => setAutoVerifiedValue(e.target.value)} /></label>
            <label>external_proof_hash hex<input value={autoExternalProofHash} onChange={(e) => setAutoExternalProofHash(e.target.value)} /></label>
            <label>verified_at unix seconds<input value={autoVerifiedAt} onChange={(e) => setAutoVerifiedAt(e.target.value)} /></label>
            <label>expires_at unix seconds<input value={autoExpiresAt} onChange={(e) => setAutoExpiresAt(e.target.value)} /></label>
            {!autoExpiresFuture && <p className="note">expires_at must be greater than the current time.</p>}
            {!autoTtlValid && <p className="note">verified_at must not be in the future, and expires_at - verified_at must be 1 to {MAX_VERIFICATION_TTL_SECONDS} seconds.</p>}
            <label>nonce hex<input value={autoNonce} onChange={(e) => setAutoNonce(e.target.value)} /></label>
            <label>verifier signature hex<input value={autoSignature} onChange={(e) => setAutoSignature(e.target.value)} /></label>
            <button disabled={!canAutoApprove} onClick={() => run("auto_approve_submission", autoApproveSubmission)}>Auto Approve</button>
          </div>
          )}
        </section>
      )}

      {activeTab === "publisher" && (
        <section>
          <h2>Publisher Tools</h2>
          <div className="inline-actions">
            <input value={fundQuestInput} onChange={(e) => {
              setFundQuestInput(e.target.value);
              setCloseQuestInput(e.target.value);
            }} placeholder="Quest PDA" />
            <button onClick={() => run("fetch_quest", () => fetchQuest(fundQuestInput))}>Load Quest</button>
          </div>
          {questDetail && !isPublisher && <p className="note danger">Connected wallet is not this quest publisher. Fund and close are publisher-only.</p>}
          <h2>{t.fund}</h2>
          <label>reward_funding_amount SOL<input value={fundReward} onChange={(e) => setFundReward(e.target.value)} /></label>
          <label>additional_deposit_amount SOL<input value={fundDeposit} onChange={(e) => setFundDeposit(e.target.value)} /></label>
          <div className="duration">
            <label>extend days<input value={extendDays} onChange={(e) => setExtendDays(e.target.value)} /></label>
            <label>extend hours<input value={extendHours} onChange={(e) => setExtendHours(e.target.value)} /></label>
            <label>extend minutes<input value={extendMinutes} onChange={(e) => setExtendMinutes(e.target.value)} /></label>
          </div>
          <p className="note">platform fee: {lamportsToSol(fundFee)} SOL</p>
          {questDetail && !fundRewardMultiple && <p className="note">reward_funding_amount must be a multiple of reward_per_completion.</p>}
          {questDetail && !fundDepositMultiple && <p className="note">additional_deposit_amount must be a multiple of reward_per_completion.</p>}
          {questDetail && fundDisabled && <p className="note">fund_quest is disabled outside Open; Closing cannot return to Open.</p>}
          <button disabled={fundDisabled || !fundRewardMultiple || !fundDepositMultiple} onClick={() => run("fund_quest", fundQuest)}>{t.fund}</button>
          <div className="detail-form">
          <h2>{t.close}</h2>
          <p className="note">Early close: stops new submissions; pending continues; remaining deposit pays 1% fee and then moves to public goods. Expired close: remaining reward and deposit return to publisher after pending clears.</p>
          {questDetail && <p className="note">settlement route: {enumName(questDetail.account.closingReason) === "expired" ? "publisher refund" : "public goods / early close"}</p>}
          <button disabled={closeDisabled} onClick={() => run("close_quest", closeQuest)}>Close Quest</button>{" "}
          <button disabled={settleDisabled} onClick={() => run("settle_quest", settleQuest)}>Settle Quest</button>
          </div>
        </section>
      )}

      {activeTab === "state" && (
        <section>
          <h2>Protocol State Viewer</h2>
          <div className="inline-actions">
            <input value={viewerQuestInput} onChange={(e) => setViewerQuestInput(e.target.value)} placeholder="Quest PDA" />
            <button onClick={() => run("fetch_quest", () => fetchQuest(viewerQuestInput))}>Fetch Quest</button>
          </div>
          {questDetail && (
            <dl>
              <dt>quest</dt><dd><code>{questDetail.quest.toString()}</code></dd>
              <dt>publisher</dt><dd><code>{questDetail.account.publisher.toString()}</code></dd>
              <dt>reviewer</dt><dd><code>{questDetail.account.reviewer.toString()}</code></dd>
              <dt>mode/status</dt><dd>{enumName(questDetail.account.mode)} / {enumName(questDetail.account.status)}</dd>
              <dt>review_mode</dt><dd>{enumName(questDetail.account.reviewMode)}</dd>
              <dt>verification_template</dt><dd>{enumName(questDetail.account.verificationTemplate)}</dd>
              <dt>authorized_verifier</dt><dd><code>{questDetail.account.authorizedVerifier.toString()}</code></dd>
              <dt>template_config_hash</dt><dd><code>{Buffer.from(questDetail.account.templateConfigHash).toString("hex")}</code></dd>
              <dt>verification_schema_uri</dt><dd><code>{questDetail.account.verificationSchemaUri}</code></dd>
              <dt>closing_reason</dt><dd>{enumName(questDetail.account.closingReason)}</dd>
              <dt>current_cycle_index</dt><dd>{questDetail.currentCycleIndex}</dd>
              <dt>current user cycle state</dt><dd>{cycleStateLabel(currentUserCycleState)}</dd>
              <dt>current user can submit</dt><dd>{currentUserCanSubmit ? "yes" : "no"}</dd>
              <dt>reward_per_completion</dt><dd>{lamportsToSol(questDetail.account.rewardPerCompletion)} SOL</dd>
              <dt>pending / queue</dt><dd>{questDetail.account.pendingCount} / {questDetail.account.queueMax}</dd>
              <dt>next_submission_index</dt><dd>{questDetail.account.nextSubmissionIndex.toString()}</dd>
              <dt>next_review_index</dt><dd>{questDetail.account.nextReviewIndex.toString()}</dd>
              <dt>total_paid_amount</dt><dd>{lamportsToSol(questDetail.account.totalPaidAmount)} SOL</dd>
              <dt>total_reward_funded</dt><dd>{lamportsToSol(questDetail.account.totalRewardFunded)} SOL</dd>
              <dt>total_deposit_funded</dt><dd>{lamportsToSol(questDetail.account.totalDepositFunded)} SOL</dd>
              <dt>total_fee_paid</dt><dd>{lamportsToSol(questDetail.account.totalFeePaid)} SOL</dd>
              <dt>created_at</dt><dd>{new Date(questDetail.account.startAt.toNumber() * 1000).toLocaleString()}</dd>
              <dt>expires_at</dt><dd>{new Date(questDetail.account.expiresAt.toNumber() * 1000).toLocaleString()}</dd>
              <dt>metadata_uri</dt><dd><code>{questDetail.account.metadataUri}</code></dd>
              <dt>reward_pool</dt><dd>{lamportsToSol(questDetail.rewardPoolBalance)} SOL</dd>
              <dt>deposit_pool</dt><dd>{lamportsToSol(questDetail.depositPoolBalance)} SOL</dd>
              <dt>fee_vault</dt><dd>{lamportsToSol(questDetail.feeVaultBalance)} SOL</dd>
              <dt>public_goods_pool</dt><dd>{lamportsToSol(questDetail.publicGoodsPoolBalance)} SOL</dd>
              <dt>32-cycle window</dt>
              <dd>
                {cycleWindowRows.length === 0
                  ? "No pending or approved cycles for connected wallet"
                  : cycleWindowRows
                      .map((row) => `${row.cycle}: ${cycleStateLabel(row.state)}`)
                      .join(", ")}
              </dd>
            </dl>
          )}
        </section>
      )}
    </main>
  );
}

export default App;
