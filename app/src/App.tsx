import { useEffect, useMemo, useState } from "react";
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Buffer } from "buffer";

import idl from "./idl/lootloop.json";
import type { Lootloop } from "../../target/types/lootloop";

type WalletAdapterProvider = anchor.Provider & {
  wallet: anchor.Wallet;
};

type QuestAccount = Awaited<ReturnType<Program<Lootloop>["account"]["quest"]["fetch"]>>;
type QuestDetail = {
  quest: PublicKey;
  account: QuestAccount;
  vaultBalance: number;
};
type Language = "en" | "zh";
type TranslationKey =
  | "app.title"
  | "app.subtitle"
  | "language"
  | "wallet"
  | "notConnected"
  | "rpc"
  | "status"
  | "ready"
  | "loadingQuest"
  | "feeNote"
  | "cancelNote"
  | "createQuest"
  | "submitProof"
  | "approveSubmission"
  | "claimReward"
  | "topUpQuest"
  | "cancelQuest"
  | "stateViewer"
  | "questDetail"
  | "questId"
  | "metadataUri"
  | "reviewerPubkey"
  | "rewardSol"
  | "years"
  | "months"
  | "days"
  | "hours"
  | "minutes"
  | "questPda"
  | "vaultPda"
  | "feeVaultPda"
  | "shareLink"
  | "copyLink"
  | "proofUri"
  | "submissionPda"
  | "submitterPubkey"
  | "topUpSol"
  | "fetchQuest"
  | "walletAddress"
  | "actionComplete"
  | "actionFailed"
  | "field.quest"
  | "field.publisher"
  | "field.reviewer"
  | "field.status"
  | "field.rewardAmount"
  | "field.totalFunded"
  | "field.totalFee"
  | "field.createdAt"
  | "field.expiresAt"
  | "field.cancelledAt"
  | "field.approvedSubmitter"
  | "field.submissionCount"
  | "field.rewardClaimed"
  | "field.metadataUri"
  | "field.vaultBalance"
  | "field.feeVaultBalance"
  | "field.publicGoodsPoolBalance";

const PROGRAM_ID = new PublicKey("CQmvWxzKoxVrVQq798qY1tm699ivLJcvC5XWw8o4DTUj");
const QUEST_SEED = "quest";
const SUBMISSION_SEED = "submission";
const VAULT_SEED = "vault";
const FEE_VAULT_SEED = "fee_vault";
const PUBLIC_GOODS_POOL_SEED = "public_goods_pool";

const translations: Record<Language, Record<TranslationKey, string>> = {
  en: {
    "app.title": "LootLoop",
    "app.subtitle": "On-chain quest rewards on Solana devnet.",
    language: "Language",
    wallet: "Wallet",
    notConnected: "Not connected",
    rpc: "RPC endpoint",
    status: "Status",
    ready: "Ready",
    loadingQuest: "Loading quest...",
    feeNote: "Fee rule: create_quest and top_up_quest charge an extra 2% platform fee. The fee is paid separately and is not deducted from the reward.",
    cancelNote: "Cancel rule: before expiry, remaining rewards go to public_goods_pool; after expiry, they return to the publisher. Approved, Completed, and Cancelled quests cannot be cancelled.",
    createQuest: "Create Quest",
    submitProof: "Submit Proof",
    approveSubmission: "Approve Submission",
    claimReward: "Claim Reward",
    topUpQuest: "Top Up Quest",
    cancelQuest: "Cancel Quest",
    stateViewer: "State Viewer",
    questDetail: "Quest Detail",
    questId: "Quest ID",
    metadataUri: "Metadata URI",
    reviewerPubkey: "Reviewer Pubkey",
    rewardSol: "Reward SOL",
    years: "Years",
    months: "Months",
    days: "Days",
    hours: "Hours",
    minutes: "Minutes",
    questPda: "Quest PDA",
    vaultPda: "Vault PDA",
    feeVaultPda: "Fee Vault PDA",
    shareLink: "Share Link",
    copyLink: "Copy Link",
    proofUri: "Proof URI",
    submissionPda: "Submission PDA",
    submitterPubkey: "Submitter Pubkey",
    topUpSol: "Top Up SOL",
    fetchQuest: "Fetch Quest",
    walletAddress: "Reviewer wallet address",
    actionComplete: "complete",
    actionFailed: "failed",
    "field.quest": "quest",
    "field.publisher": "publisher",
    "field.reviewer": "reviewer",
    "field.status": "status",
    "field.rewardAmount": "reward_amount",
    "field.totalFunded": "total_funded_amount",
    "field.totalFee": "total_fee_paid",
    "field.createdAt": "created_at",
    "field.expiresAt": "expires_at",
    "field.cancelledAt": "cancelled_at",
    "field.approvedSubmitter": "approved_submitter",
    "field.submissionCount": "submission_count",
    "field.rewardClaimed": "reward_claimed",
    "field.metadataUri": "metadata_uri",
    "field.vaultBalance": "vault_balance",
    "field.feeVaultBalance": "fee_vault_balance",
    "field.publicGoodsPoolBalance": "public_goods_pool_balance",
  },
  zh: {
    "app.title": "LootLoop",
    "app.subtitle": "Solana devnet 上的链上任务奖励协议。",
    language: "语言",
    wallet: "钱包",
    notConnected: "未连接",
    rpc: "RPC 节点",
    status: "状态",
    ready: "就绪",
    loadingQuest: "正在加载任务...",
    feeNote: "手续费规则：create_quest 和 top_up_quest 会额外收取 2% 平台手续费。手续费由发布者单独支付，不会从奖励中扣除。",
    cancelNote: "取消规则：未过期取消时，剩余奖励进入 public_goods_pool；已过期取消时，剩余奖励返还 publisher。Approved、Completed、Cancelled 状态不能取消。",
    createQuest: "创建任务",
    submitProof: "提交证明",
    approveSubmission: "审核提交",
    claimReward: "领取奖励",
    topUpQuest: "补充奖励",
    cancelQuest: "取消任务",
    stateViewer: "状态查看器",
    questDetail: "任务详情",
    questId: "任务 ID",
    metadataUri: "任务元数据 URI",
    reviewerPubkey: "审核者公钥",
    rewardSol: "奖励 SOL",
    years: "年",
    months: "月",
    days: "日",
    hours: "小时",
    minutes: "分钟",
    questPda: "Quest PDA（任务地址）",
    vaultPda: "Vault PDA（奖励金库）",
    feeVaultPda: "Fee Vault PDA（手续费金库）",
    shareLink: "分享链接",
    copyLink: "复制链接",
    proofUri: "证明 URI",
    submissionPda: "Submission PDA（提交账户）",
    submitterPubkey: "提交者公钥",
    topUpSol: "补充奖励 SOL",
    fetchQuest: "读取任务",
    walletAddress: "审核者钱包地址",
    actionComplete: "完成",
    actionFailed: "失败",
    "field.quest": "quest（任务地址）",
    "field.publisher": "publisher（发布者）",
    "field.reviewer": "reviewer（审核者）",
    "field.status": "status（状态）",
    "field.rewardAmount": "reward_amount（奖励金额）",
    "field.totalFunded": "total_funded_amount（累计奖励）",
    "field.totalFee": "total_fee_paid（累计手续费）",
    "field.createdAt": "created_at（创建时间）",
    "field.expiresAt": "expires_at（截止时间）",
    "field.cancelledAt": "cancelled_at（取消时间）",
    "field.approvedSubmitter": "approved_submitter（获批提交者）",
    "field.submissionCount": "submission_count（提交数）",
    "field.rewardClaimed": "reward_claimed（是否已领取）",
    "field.metadataUri": "metadata_uri（元数据）",
    "field.vaultBalance": "vault_balance（奖励金库余额）",
    "field.feeVaultBalance": "fee_vault_balance（手续费金库余额）",
    "field.publicGoodsPoolBalance": "public_goods_pool_balance（公益池余额）",
  },
};

const toPubkey = (value: string) => new PublicKey(value.trim());
const toQuestId = (value: string) => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Quest ID must be a non-negative integer");
  }
  return new anchor.BN(trimmed);
};
const toRewardLamports = (value: string) => {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(trimmed)) {
    throw new Error("Reward SOL must be a positive number with at most 9 decimals");
  }

  const [whole, fraction = ""] = trimmed.split(".");
  const lamports = new anchor.BN(whole)
    .mul(new anchor.BN(LAMPORTS_PER_SOL))
    .add(new anchor.BN(fraction.padEnd(9, "0")));
  if (lamports.isZero()) {
    throw new Error("Reward SOL must be greater than 0");
  }
  return lamports;
};
const toDurationSeconds = (
  years: string,
  months: string,
  days: string,
  hours: string,
  minutes: string,
  allowZero = false
) => {
  const parts = [years, months, days, hours, minutes].map((value) => {
    const trimmed = value.trim() || "0";
    if (!/^\d+$/.test(trimmed)) {
      throw new Error("Duration fields must be non-negative integers");
    }
    return new anchor.BN(trimmed);
  });
  const [yearBn, monthBn, dayBn, hourBn, minuteBn] = parts;
  const seconds = yearBn
    .mul(new anchor.BN(365 * 24 * 60 * 60))
    .add(monthBn.mul(new anchor.BN(30 * 24 * 60 * 60)))
    .add(dayBn.mul(new anchor.BN(24 * 60 * 60)))
    .add(hourBn.mul(new anchor.BN(60 * 60)))
    .add(minuteBn.mul(new anchor.BN(60)));
  if (!allowZero && seconds.isZero()) {
    throw new Error("Duration must be greater than 0");
  }
  return seconds;
};

const formatStatus = (status: Record<string, unknown>) => Object.keys(status)[0] ?? "unknown";
const formatPubkey = (key: PublicKey | null | undefined) => key?.toString() ?? "None";
const formatUnix = (value: anchor.BN) =>
  `${value.toString()} (${new Date(value.toNumber() * 1000).toLocaleString()})`;
const extractErrorMessage = (err: unknown) => {
  if (err instanceof anchor.AnchorError) {
    return `${err.error.errorCode.code}: ${err.error.errorMessage}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
};

function deriveQuestPda(publisher: PublicKey, questId: anchor.BN) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(QUEST_SEED),
      publisher.toBuffer(),
      questId.toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  )[0];
}

function deriveVaultPda(quest: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_SEED), quest.toBuffer()],
    PROGRAM_ID
  )[0];
}

function deriveFeeVaultPda() {
  return PublicKey.findProgramAddressSync([Buffer.from(FEE_VAULT_SEED)], PROGRAM_ID)[0];
}

function derivePublicGoodsPoolPda() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PUBLIC_GOODS_POOL_SEED)],
    PROGRAM_ID
  )[0];
}

function deriveSubmissionPda(quest: PublicKey, submitter: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SUBMISSION_SEED), quest.toBuffer(), submitter.toBuffer()],
    PROGRAM_ID
  )[0];
}

export default function App() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const questPdaFromUrl = useMemo(() => {
    const match = window.location.pathname.match(/^\/quest\/([^/]+)$/);
    return match?.[1] ?? "";
  }, []);
  const [language, setLanguage] = useState<Language>(() => {
    const stored = localStorage.getItem("lootloop-language");
    return stored === "zh" ? "zh" : "en";
  });
  const t = (key: TranslationKey) => translations[language][key];
  const [status, setStatus] = useState(t("ready"));
  const [errorMessage, setErrorMessage] = useState("");

  const [questId, setQuestId] = useState("1");
  const [metadataUri, setMetadataUri] = useState("https://lootloop.example/quests/1.json");
  const [reviewer, setReviewer] = useState("");
  const [rewardSol, setRewardSol] = useState("0.1");
  const [durationYears, setDurationYears] = useState("0");
  const [durationMonths, setDurationMonths] = useState("0");
  const [durationDays, setDurationDays] = useState("0");
  const [durationHours, setDurationHours] = useState("0");
  const [durationMinutes, setDurationMinutes] = useState("1");
  const [createdQuest, setCreatedQuest] = useState("");
  const [createdVault, setCreatedVault] = useState("");
  const [createdFeeVault, setCreatedFeeVault] = useState("");
  const [shareLink, setShareLink] = useState("");

  const [submitQuest, setSubmitQuest] = useState("");
  const [proofUri, setProofUri] = useState("https://github.com/demo/proof");
  const [submissionPda, setSubmissionPda] = useState("");

  const [approveQuest, setApproveQuest] = useState("");
  const [approveSubmitter, setApproveSubmitter] = useState("");

  const [claimQuest, setClaimQuest] = useState("");
  const [claimSubmission, setClaimSubmission] = useState("");

  const [topUpQuestPda, setTopUpQuestPda] = useState("");
  const [topUpSol, setTopUpSol] = useState("0.05");
  const [extendYears, setExtendYears] = useState("0");
  const [extendMonths, setExtendMonths] = useState("0");
  const [extendDays, setExtendDays] = useState("0");
  const [extendHours, setExtendHours] = useState("0");
  const [extendMinutes, setExtendMinutes] = useState("30");

  const [cancelQuestPda, setCancelQuestPda] = useState("");

  const [viewerQuest, setViewerQuest] = useState("");
  const [questAccount, setQuestAccount] = useState<QuestAccount | null>(null);
  const [vaultBalance, setVaultBalance] = useState<number | null>(null);
  const [feeVaultBalance, setFeeVaultBalance] = useState<number | null>(null);
  const [publicGoodsPoolBalance, setPublicGoodsPoolBalance] = useState<number | null>(null);
  const [questDetail, setQuestDetail] = useState<QuestDetail | null>(null);
  const [detailProofUri, setDetailProofUri] = useState("https://github.com/demo/proof");
  const [detailSubmissionPda, setDetailSubmissionPda] = useState("");

  const derivedQuest = useMemo(() => {
    if (!wallet.publicKey) return "";
    try {
      return deriveQuestPda(wallet.publicKey, toQuestId(questId)).toString();
    } catch {
      return "";
    }
  }, [questId, wallet.publicKey]);
  const derivedShareLink = derivedQuest ? `${window.location.origin}/quest/${derivedQuest}` : "";

  useEffect(() => {
    if (wallet.publicKey && !reviewer) {
      setReviewer(wallet.publicKey.toString());
    }
  }, [reviewer, wallet.publicKey]);

  useEffect(() => {
    localStorage.setItem("lootloop-language", language);
  }, [language]);

  useEffect(() => {
    if (status === translations.en.ready || status === translations.zh.ready) {
      setStatus(t("ready"));
    }
  }, [language]);

  const readOnlyProgram = useMemo(() => {
    const readOnlyWallet = {
      publicKey: SystemProgram.programId,
      signTransaction: async () => {
        throw new Error("Read-only provider cannot sign transactions");
      },
      signAllTransactions: async () => {
        throw new Error("Read-only provider cannot sign transactions");
      },
    } as unknown as anchor.Wallet;

    const provider = new anchor.AnchorProvider(
      connection,
      readOnlyWallet,
      anchor.AnchorProvider.defaultOptions()
    ) as WalletAdapterProvider;

    return new Program<Lootloop>(idl as Lootloop, provider);
  }, [connection]);

  const program = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) return null;

    const provider = new anchor.AnchorProvider(
      connection,
      wallet as unknown as anchor.Wallet,
      anchor.AnchorProvider.defaultOptions()
    ) as WalletAdapterProvider;

    return new Program<Lootloop>(idl as Lootloop, provider);
  }, [connection, wallet]);

  const fetchQuestDetail = async (questAddress: string) => {
    const quest = toPubkey(questAddress);
    const account = await readOnlyProgram.account.quest.fetch(quest);
    const vault = deriveVaultPda(quest);
    const balance = await connection.getBalance(vault);
    setQuestDetail({
      quest,
      account,
      vaultBalance: balance / LAMPORTS_PER_SOL,
    });
  };

  useEffect(() => {
    if (!questPdaFromUrl) return;
    fetchQuestDetail(questPdaFromUrl).catch((err) => {
      console.error(err);
      setStatus(`${t("questDetail")} ${t("actionFailed")}`);
      setErrorMessage(extractErrorMessage(err));
    });
  }, [questPdaFromUrl, readOnlyProgram]);

  const requireProgram = () => {
    if (!program || !wallet.publicKey) {
      throw new Error("Connect a wallet first");
    }
    return { program, publicKey: wallet.publicKey };
  };

  const runAction = async (label: string, action: () => Promise<void>) => {
    try {
      setErrorMessage("");
      setStatus(`${label}...`);
      await action();
      setStatus(`${label} ${t("actionComplete")}`);
    } catch (err) {
      console.error(err);
      const message = extractErrorMessage(err);
      setStatus(`${label} ${t("actionFailed")}`);
      setErrorMessage(message);
    }
  };

  const createQuest = () =>
    runAction(t("createQuest"), async () => {
      const { program, publicKey } = requireProgram();
      const questIdBn = toQuestId(questId);
      const quest = deriveQuestPda(publicKey, questIdBn);
      const vault = deriveVaultPda(quest);
      const feeVault = deriveFeeVaultPda();
      const questAddress = quest.toString();
      const vaultAddress = vault.toString();
      const feeVaultAddress = feeVault.toString();

      setCreatedQuest(questAddress);
      setCreatedVault(vaultAddress);
      setCreatedFeeVault(feeVaultAddress);
      setShareLink(`${window.location.origin}/quest/${questAddress}`);
      setSubmitQuest(questAddress);
      setApproveQuest(questAddress);
      setClaimQuest(questAddress);
      setTopUpQuestPda(questAddress);
      setCancelQuestPda(questAddress);
      setViewerQuest(questAddress);

      const durationSeconds = toDurationSeconds(
        durationYears,
        durationMonths,
        durationDays,
        durationHours,
        durationMinutes
      );

      await program.methods
        .createQuest(
          questIdBn,
          metadataUri,
          toPubkey(reviewer),
          toRewardLamports(rewardSol),
          durationSeconds
        )
        .accountsPartial({
          quest,
          vault,
          feeVault,
          publisher: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

  const copyShareLink = () =>
    runAction(t("copyLink"), async () => {
      await navigator.clipboard.writeText(shareLink);
    });

  const submitProof = () =>
    runAction(t("submitProof"), async () => {
      const { program, publicKey } = requireProgram();
      const quest = toPubkey(submitQuest);
      const submission = deriveSubmissionPda(quest, publicKey);

      await program.methods
        .submitProof(proofUri)
        .accountsPartial({
          quest,
          submission,
          submitter: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setSubmissionPda(submission.toString());
      setApproveQuest(quest.toString());
      setApproveSubmitter(publicKey.toString());
      setClaimQuest(quest.toString());
      setClaimSubmission(submission.toString());
    });

  const submitProofFromDetail = () =>
    runAction(t("submitProof"), async () => {
      const { program, publicKey } = requireProgram();
      if (!questDetail) {
        throw new Error("Quest detail is not loaded");
      }
      const submission = deriveSubmissionPda(questDetail.quest, publicKey);

      await program.methods
        .submitProof(detailProofUri)
        .accountsPartial({
          quest: questDetail.quest,
          submission,
          submitter: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setDetailSubmissionPda(submission.toString());
      setSubmissionPda(submission.toString());
      setApproveQuest(questDetail.quest.toString());
      setApproveSubmitter(publicKey.toString());
      setClaimQuest(questDetail.quest.toString());
      setClaimSubmission(submission.toString());
      await fetchQuestDetail(questDetail.quest.toString());
    });

  const approveSubmission = () =>
    runAction(t("approveSubmission"), async () => {
      const { program, publicKey } = requireProgram();
      const quest = toPubkey(approveQuest);
      const submitter = toPubkey(approveSubmitter);
      const submission = deriveSubmissionPda(quest, submitter);

      await program.methods
        .approveSubmission()
        .accountsPartial({
          quest,
          submission,
          reviewer: publicKey,
        })
        .rpc();

      setClaimQuest(quest.toString());
      setClaimSubmission(submission.toString());
    });

  const claimReward = () =>
    runAction(t("claimReward"), async () => {
      const { program, publicKey } = requireProgram();
      const quest = toPubkey(claimQuest);
      const submission = toPubkey(claimSubmission);
      const vault = deriveVaultPda(quest);

      await program.methods
        .claimReward()
        .accountsPartial({
          quest,
          submission,
          vault,
          submitter: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setViewerQuest(quest.toString());
    });

  const topUpQuest = () =>
    runAction(t("topUpQuest"), async () => {
      const { program, publicKey } = requireProgram();
      const quest = toPubkey(topUpQuestPda);
      const vault = deriveVaultPda(quest);
      const feeVault = deriveFeeVaultPda();
      const extensionSeconds = toDurationSeconds(
        extendYears,
        extendMonths,
        extendDays,
        extendHours,
        extendMinutes,
        true
      );

      await program.methods
        .topUpQuest(toRewardLamports(topUpSol), extensionSeconds)
        .accountsPartial({
          quest,
          vault,
          feeVault,
          publisher: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setViewerQuest(quest.toString());
    });

  const cancelQuest = () =>
    runAction(t("cancelQuest"), async () => {
      const { program, publicKey } = requireProgram();
      const quest = toPubkey(cancelQuestPda);
      const vault = deriveVaultPda(quest);
      const publicGoodsPool = derivePublicGoodsPoolPda();

      await program.methods
        .cancelQuest()
        .accountsPartial({
          quest,
          vault,
          publicGoodsPool,
          publisher: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setViewerQuest(quest.toString());
    });

  const fetchQuest = () =>
    runAction(t("fetchQuest"), async () => {
      const { program } = requireProgram();
      const quest = toPubkey(viewerQuest);
      const account = await program.account.quest.fetch(quest);
      const vault = deriveVaultPda(quest);
      const feeVault = deriveFeeVaultPda();
      const publicGoodsPool = derivePublicGoodsPoolPda();
      const balance = await connection.getBalance(vault);
      const feeBalance = await connection.getBalance(feeVault);
      const publicGoodsBalance = await connection.getBalance(publicGoodsPool);

      setQuestAccount(account);
      setVaultBalance(balance / LAMPORTS_PER_SOL);
      setFeeVaultBalance(feeBalance / LAMPORTS_PER_SOL);
      setPublicGoodsPoolBalance(publicGoodsBalance / LAMPORTS_PER_SOL);
    });

  return (
    <main>
      <header>
        <div>
          <h1>{t("app.title")}</h1>
          <p>{t("app.subtitle")}</p>
        </div>
        <div className="header-actions">
          <label className="language-select">
            {t("language")}
            <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
          </label>
          <WalletMultiButton />
        </div>
      </header>

      <section className="status">
        <span>{t("wallet")}</span>
        <strong>{wallet.publicKey?.toString() ?? t("notConnected")}</strong>
        <span>{t("rpc")}</span>
        <strong>{connection.rpcEndpoint}</strong>
        <span>{t("status")}</span>
        <strong>{status}</strong>
      </section>
      {errorMessage && <section className="error">{errorMessage}</section>}

      {questPdaFromUrl && (
        <QuestDetailView
          detail={questDetail}
          proofUri={detailProofUri}
          onProofUriChange={setDetailProofUri}
          onSubmitProof={submitProofFromDetail}
          submissionPda={detailSubmissionPda}
          t={t}
        />
      )}

      <div className="grid">
        <section>
          <h2>{t("createQuest")}</h2>
          <p className="note">{t("feeNote")}</p>
          <label>{t("questId")}<input value={questId} onChange={(e) => setQuestId(e.target.value)} /></label>
          <label>{t("metadataUri")}<input value={metadataUri} onChange={(e) => setMetadataUri(e.target.value)} /></label>
          <label>{t("reviewerPubkey")}<input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder={t("walletAddress")} /></label>
          <label>{t("rewardSol")}<input value={rewardSol} onChange={(e) => setRewardSol(e.target.value)} /></label>
          <div className="duration">
            <label>{t("years")}<input value={durationYears} onChange={(e) => setDurationYears(e.target.value)} /></label>
            <label>{t("months")}<input value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} /></label>
            <label>{t("days")}<input value={durationDays} onChange={(e) => setDurationDays(e.target.value)} /></label>
            <label>{t("hours")}<input value={durationHours} onChange={(e) => setDurationHours(e.target.value)} /></label>
            <label>{t("minutes")}<input value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} /></label>
          </div>
          <button onClick={createQuest}>{t("createQuest")}</button>
          {derivedQuest && (
            <p className="output">
              <span>{t("questPda")} (derived from current wallet + Quest ID)</span>
              <code>{derivedQuest}</code>
            </p>
          )}
          {derivedShareLink && (
            <p className="output">
              <span>{t("shareLink")} (derived)</span>
              <code>{derivedShareLink}</code>
            </p>
          )}
          <Output label={t("questPda")} value={createdQuest} />
          {shareLink && (
            <p className="output">
              <span>{t("shareLink")}</span>
              <code>{shareLink}</code>
              <button type="button" onClick={copyShareLink}>{t("copyLink")}</button>
            </p>
          )}
          <Output label={t("vaultPda")} value={createdVault} />
          <Output label={t("feeVaultPda")} value={createdFeeVault} />
        </section>

        <section>
          <h2>{t("submitProof")}</h2>
          <label>{t("questPda")}<input value={submitQuest} onChange={(e) => setSubmitQuest(e.target.value)} /></label>
          <label>{t("proofUri")}<input value={proofUri} onChange={(e) => setProofUri(e.target.value)} /></label>
          <button onClick={submitProof}>{t("submitProof")}</button>
          <Output label={t("submissionPda")} value={submissionPda} />
        </section>

        <section>
          <h2>{t("approveSubmission")}</h2>
          <label>{t("questPda")}<input value={approveQuest} onChange={(e) => setApproveQuest(e.target.value)} /></label>
          <label>{t("submitterPubkey")}<input value={approveSubmitter} onChange={(e) => setApproveSubmitter(e.target.value)} /></label>
          <button onClick={approveSubmission}>{t("approveSubmission")}</button>
        </section>

        <section>
          <h2>{t("claimReward")}</h2>
          <label>{t("questPda")}<input value={claimQuest} onChange={(e) => setClaimQuest(e.target.value)} /></label>
          <label>{t("submissionPda")}<input value={claimSubmission} onChange={(e) => setClaimSubmission(e.target.value)} /></label>
          <button onClick={claimReward}>{t("claimReward")}</button>
        </section>

        <section>
          <h2>{t("topUpQuest")}</h2>
          <p className="note">{t("feeNote")}</p>
          <label>{t("questPda")}<input value={topUpQuestPda} onChange={(e) => setTopUpQuestPda(e.target.value)} /></label>
          <label>{t("topUpSol")}<input value={topUpSol} onChange={(e) => setTopUpSol(e.target.value)} /></label>
          <div className="duration">
            <label>{t("years")}<input value={extendYears} onChange={(e) => setExtendYears(e.target.value)} /></label>
            <label>{t("months")}<input value={extendMonths} onChange={(e) => setExtendMonths(e.target.value)} /></label>
            <label>{t("days")}<input value={extendDays} onChange={(e) => setExtendDays(e.target.value)} /></label>
            <label>{t("hours")}<input value={extendHours} onChange={(e) => setExtendHours(e.target.value)} /></label>
            <label>{t("minutes")}<input value={extendMinutes} onChange={(e) => setExtendMinutes(e.target.value)} /></label>
          </div>
          <button onClick={topUpQuest}>{t("topUpQuest")}</button>
        </section>

        <section>
          <h2>{t("cancelQuest")}</h2>
          <p className="note">{t("cancelNote")}</p>
          <label>{t("questPda")}<input value={cancelQuestPda} onChange={(e) => setCancelQuestPda(e.target.value)} /></label>
          <button onClick={cancelQuest}>{t("cancelQuest")}</button>
        </section>

        <section className="wide">
          <h2>{t("stateViewer")}</h2>
          <label>{t("questPda")}<input value={viewerQuest} onChange={(e) => setViewerQuest(e.target.value)} /></label>
          <button onClick={fetchQuest}>{t("fetchQuest")}</button>
          {questAccount && (
            <dl>
              <Row label={t("field.publisher")} value={questAccount.publisher.toString()} />
              <Row label={t("field.reviewer")} value={questAccount.reviewer.toString()} />
              <Row label="quest_id" value={questAccount.questId.toString()} />
              <Row label={t("field.rewardAmount")} value={`${questAccount.rewardAmount.toString()} lamports`} />
              <Row label={t("field.totalFunded")} value={`${questAccount.totalFundedAmount.toString()} lamports`} />
              <Row label={t("field.totalFee")} value={`${questAccount.totalFeePaid.toString()} lamports`} />
              <Row label={t("field.createdAt")} value={questAccount.createdAt.toString()} />
              <Row label={t("field.expiresAt")} value={questAccount.expiresAt.toString()} />
              <Row label={t("field.cancelledAt")} value={questAccount.cancelledAt.toString()} />
              <Row label={t("field.status")} value={formatStatus(questAccount.status)} />
              <Row label={t("field.approvedSubmitter")} value={formatPubkey(questAccount.approvedSubmitter)} />
              <Row label={t("field.submissionCount")} value={questAccount.submissionCount.toString()} />
              <Row label={t("field.rewardClaimed")} value={String(questAccount.rewardClaimed)} />
              <Row label={t("field.metadataUri")} value={questAccount.metadataUri} />
              <Row label={t("field.vaultBalance")} value={vaultBalance === null ? "Unknown" : `${vaultBalance} SOL`} />
              <Row label={t("field.feeVaultBalance")} value={feeVaultBalance === null ? "Unknown" : `${feeVaultBalance} SOL`} />
              <Row label={t("field.publicGoodsPoolBalance")} value={publicGoodsPoolBalance === null ? "Unknown" : `${publicGoodsPoolBalance} SOL`} />
            </dl>
          )}
        </section>
      </div>
    </main>
  );
}

function Output({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <p className="output">
      <span>{label}</span>
      <code>{value}</code>
    </p>
  );
}

function QuestDetailView({
  detail,
  proofUri,
  onProofUriChange,
  onSubmitProof,
  submissionPda,
  t,
}: {
  detail: QuestDetail | null;
  proofUri: string;
  onProofUriChange: (value: string) => void;
  onSubmitProof: () => void;
  submissionPda: string;
  t: (key: TranslationKey) => string;
}) {
  if (!detail) {
    return (
      <section className="wide detail">
        <h2>{t("questDetail")}</h2>
        <p>{t("loadingQuest")}</p>
      </section>
    );
  }

  const status = formatStatus(detail.account.status);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const isOpen = status === "open";
  const isNotExpired = nowSeconds <= detail.account.expiresAt.toNumber();

  return (
    <section className="wide detail">
      <h2>{t("questDetail")}</h2>
      <dl>
        <Row label={t("field.quest")} value={detail.quest.toString()} />
        <Row label={t("field.publisher")} value={detail.account.publisher.toString()} />
        <Row label={t("field.reviewer")} value={detail.account.reviewer.toString()} />
        <Row label={t("field.status")} value={status} />
        <Row label={t("field.totalFunded")} value={`${detail.account.totalFundedAmount.toString()} lamports`} />
        <Row label={t("field.totalFee")} value={`${detail.account.totalFeePaid.toString()} lamports`} />
        <Row label={t("field.createdAt")} value={formatUnix(detail.account.createdAt)} />
        <Row label={t("field.expiresAt")} value={formatUnix(detail.account.expiresAt)} />
        <Row label={t("field.metadataUri")} value={detail.account.metadataUri} />
        <Row label={t("field.vaultBalance")} value={`${detail.vaultBalance} SOL`} />
      </dl>

      {isOpen && isNotExpired && (
        <div className="detail-form">
          <h2>{t("submitProof")}</h2>
          <label>{t("proofUri")}<input value={proofUri} onChange={(e) => onProofUriChange(e.target.value)} /></label>
          <button onClick={onSubmitProof}>{t("submitProof")}</button>
          <Output label={t("submissionPda")} value={submissionPda} />
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
