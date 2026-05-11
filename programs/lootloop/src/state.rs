use anchor_lang::prelude::*;

pub const MAX_METADATA_URI_LEN: usize = 200; // Quest 元数据 URI 的最大长度，避免 String 占用无限空间。
pub const MAX_PROOF_URI_LEN: usize = 200; // Proof URI 的最大长度，后续提交证明时使用。

#[account]
pub struct Quest {
    pub quest_id: u64,            // 发布者传入的任务编号，用来派生唯一 Quest PDA。
    pub publisher: Pubkey,        // 创建任务并锁定奖励的人。
    pub reviewer: Pubkey,         // 后续负责审核 proof 的人。
    pub reward_amount: u64,       // 任务奖励金额，单位是 lamports。
    pub total_funded_amount: u64, // 发布者累计转入 Quest vault 的奖励总额。
    pub total_fee_paid: u64,      // 发布者累计支付到 fee vault 的平台手续费。
    pub created_at: i64,          // 任务创建时间，来自 Solana Clock。
    pub expires_at: i64,          // 任务截止时间，由链上用 created_at + duration_seconds 计算。
    pub cancelled_at: i64,        // 任务取消时间，未取消时为 0。
    pub status: QuestStatus,      // 当前任务状态，用于控制后续流程。
    pub approved_submitter: Option<Pubkey>, // 被审核通过的提交者，claim reward 时校验。
    pub submission_count: u64,    // 当前任务收到的提交数量，后续 submit_proof 会递增。
    pub reward_claimed: bool,     // 奖励是否已领取，防止重复领取。
    pub bump: u8,                 // Quest PDA 的 bump，后续校验或签名时使用。
    pub vault_bump: u8,           // Vault PDA 的 bump，后续从 vault 转出奖励时使用。
    pub metadata_uri: String,     // 链下任务信息 URI，例如标题、描述、验收标准等。
}

impl Quest {
    pub const INIT_SPACE: usize = 8 // quest_id，不包含 Anchor discriminator 的 8 字节。
        + 32 // publisher
        + 32 // reviewer
        + 8 // reward_amount
        + 8 // total_funded_amount
        + 8 // total_fee_paid
        + 8 // created_at
        + 8 // expires_at
        + 8 // cancelled_at
        + 1 // status
        + 1 + 32 // approved_submitter
        + 8 // submission_count
        + 1 // reward_claimed
        + 1 // bump
        + 1 // vault_bump
        + 4 + MAX_METADATA_URI_LEN; // metadata_uri
}

#[account]
pub struct Submission {
    pub quest: Pubkey,            // 该提交所属的 Quest。
    pub submitter: Pubkey,        // 提交 proof 的用户。
    pub status: SubmissionStatus, // 当前提交的审核状态。
    pub bump: u8,                 // Submission PDA 的 bump。
    pub submitted_at: i64,        // 提交时间戳，后续 submit_proof 写入。
    pub reviewed_at: i64,         // 审核时间戳，后续 approve/reject 写入。
    pub proof_uri: String,        // 链下 proof URI，例如 PR 链接、截图或 IPFS 地址。
}

impl Submission {
    pub const INIT_SPACE: usize = 32 // quest，不包含 Anchor discriminator 的 8 字节。
        + 32 // submitter
        + 1 // status
        + 1 // bump
        + 8 // submitted_at
        + 8 // reviewed_at
        + 4 + MAX_PROOF_URI_LEN; // proof_uri
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum QuestStatus {
    Open,      // 任务已发布，等待用户提交 proof。
    InReview,  // 已有提交进入审核阶段。
    Approved,  // 某个提交已通过审核，等待领取奖励。
    Completed, // 奖励已领取，任务完成。
    Cancelled, // 任务取消，后续可用于退回奖励。
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum SubmissionStatus {
    Pending,  // 已提交，等待审核。
    Approved, // 审核通过。
    Rejected, // 审核拒绝。
}
