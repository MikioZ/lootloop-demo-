use anchor_lang::prelude::*;

use crate::RECENT_CYCLE_WINDOW;

const CYCLE_STATE_EMPTY: u8 = 0;

pub const MAX_METADATA_URI_LEN: usize = 200; // Quest 元数据 URI 的最大长度，避免 String 占用无限空间。
pub const MAX_PROOF_URI_LEN: usize = 200; // Proof URI 的最大长度，提交证明时使用。
pub const MAX_VERIFICATION_SCHEMA_URI_LEN: usize = 200; // 自动审核模板 schema/config URI 最大长度。
pub const AUTO_REVIEW_DOMAIN: &str = "LootLoopAutoReviewV1"; // verifier 签名域分隔符。

#[account]
pub struct Quest {
    pub quest_id: u64,           // 发布者传入的任务编号，用来派生唯一 Quest PDA。
    pub publisher: Pubkey,       // 创建任务、补充资金、关闭任务的发布者。
    pub reviewer: Pubkey,        // 被授权审核 proof 的 reviewer，publisher 也可审核。
    pub mode: QuestMode,         // OneTime 或 Recurring，共用同一个任务引擎。
    pub review_mode: ReviewMode, // Manual 或 AutoVerified。
    pub verification_template: VerificationTemplateType, // 自动审核模板类型。
    pub template_config_hash: [u8; 32], // 链下完成标准配置 hash。
    pub authorized_verifier: Pubkey, // AutoVerified verifier 公钥。
    pub status: QuestStatus,     // Open / Closing / Closed 三态状态机。
    pub reward_per_completion: u64, // 每个通过审核的提交应支付的奖励。
    pub period_seconds: i64,     // Recurring 周期长度；OneTime 可以为 0。
    pub start_at: i64,           // 任务创建时间，来自 Solana Clock。
    pub expires_at: i64,         // 任务截止时间，由 start_at + duration_seconds 得到。
    pub close_requested_at: i64, // 进入 Closing 的时间；未关闭时为 0。
    pub closing_reason: QuestCloseReason, // None / EarlyManual / RewardPoolDepleted / Expired。
    pub queue_max: u32,          // 最多允许同时 pending 的提交数量。
    pub pending_count: u32,      // 当前等待审核的提交数量。
    pub next_submission_index: u64, // 下一次提交要使用的链上队列 index。
    pub next_review_index: u64,  // 下一次必须审核的队列 index，强制 FIFO 审核。
    pub total_submissions: u64,  // 历史提交总数。
    pub total_approved: u64,     // 完整支付并通过的提交数量。
    pub total_rejected: u64,     // 被拒绝的提交数量。
    pub total_paid_amount: u64,  // 已实际支付给 submitter 的 lamports 总额。
    pub total_reward_funded: u64, // 累计进入 reward_pool 的奖励资金。
    pub total_deposit_funded: u64, // 累计进入 deposit_pool 的保障押金。
    pub total_fee_paid: u64,     // 累计支付到 fee_vault 的手续费。
    pub bump: u8,                // Quest PDA bump。
    pub reward_pool_bump: u8,    // RewardPool PDA bump，用于池子转账签名。
    pub deposit_pool_bump: u8,   // DepositPool PDA bump，用于池子转账签名。
    pub metadata_uri: String,    // 链下任务信息 URI，例如标题、描述、验收标准等。
    pub verification_schema_uri: String, // 链下自动审核 schema/config URI。
}

impl Quest {
    pub const INIT_SPACE: usize = 8 // quest_id，不包含 Anchor discriminator 的 8 字节。
        + 32 // publisher
        + 32 // reviewer
        + 1 // mode
        + 1 // review_mode
        + 1 // verification_template
        + 32 // template_config_hash
        + 32 // authorized_verifier
        + 1 // status
        + 8 // reward_per_completion
        + 8 // period_seconds
        + 8 // start_at
        + 8 // expires_at
        + 8 // close_requested_at
        + 1 // closing_reason
        + 4 // queue_max
        + 4 // pending_count
        + 8 // next_submission_index
        + 8 // next_review_index
        + 8 // total_submissions
        + 8 // total_approved
        + 8 // total_rejected
        + 8 // total_paid_amount
        + 8 // total_reward_funded
        + 8 // total_deposit_funded
        + 8 // total_fee_paid
        + 1 // bump
        + 1 // reward_pool_bump
        + 1 // deposit_pool_bump
        + 4 + MAX_METADATA_URI_LEN // metadata_uri，String = 4 字节长度 + 最大内容长度。
        + 4 + MAX_VERIFICATION_SCHEMA_URI_LEN; // verification_schema_uri。
}

#[account]
pub struct Submission {
    pub quest: Pubkey,               // 该提交所属的 Quest。
    pub submission_index: u64,       // 链上队列 index，用于强制按顺序审核。
    pub submitter: Pubkey,           // 提交 proof 的用户。
    pub cycle_index: u64,            // Recurring 当前周期；OneTime 固定为 0。
    pub status: SubmissionStatus,    // Pending / Approved / Rejected。
    pub requested_reward: u64,       // 本次提交期望获得的奖励金额。
    pub paid_from_reward_pool: u64,  // 实际从 reward_pool 支付的金额。
    pub paid_from_deposit_pool: u64, // 实际从 deposit_pool 补偿支付的金额。
    pub submitted_at: i64,           // 提交时间戳，来自 Solana Clock。
    pub reviewed_at: i64,            // 审核时间戳，未审核时为 0。
    pub bump: u8,                    // Submission PDA bump。
    pub proof_uri: String,           // 链下 proof URI，例如 PR 链接、截图或 IPFS 地址。
}

impl Submission {
    pub const INIT_SPACE: usize = 32 // quest，不包含 Anchor discriminator 的 8 字节。
        + 8 // submission_index
        + 32 // submitter
        + 8 // cycle_index
        + 1 // status
        + 8 // requested_reward
        + 8 // paid_from_reward_pool
        + 8 // paid_from_deposit_pool
        + 8 // submitted_at
        + 8 // reviewed_at
        + 1 // bump
        + 4 + MAX_PROOF_URI_LEN; // proof_uri，String = 4 字节长度 + 最大内容长度。
}

#[account]
pub struct UserProgress {
    pub quest: Pubkey,                                  // 该进度账户所属的 Quest。
    pub user: Pubkey,                                   // 被记录进度的用户。
    pub total_submitted: u64,                           // 用户在该 Quest 下提交过的次数。
    pub total_approved: u64,                            // 用户在该 Quest 下获得完整支付通过的次数。
    pub last_submitted_cycle: u64,                      // 最近一次提交所在周期。
    pub last_approved_cycle: u64,                       // 最近一次通过所在周期。
    pub one_time_completed: bool,                       // OneTime 任务是否已经完成过。
    pub pending_one_time: bool, // OneTime 是否还有 pending 提交，防止重复排队。
    pub recent_cycles: [u64; RECENT_CYCLE_WINDOW], // Recurring 最近 32 个周期窗口。
    pub recent_cycle_states: [u8; RECENT_CYCLE_WINDOW], // 0 空/已拒绝，1 pending，2 approved/paid。
    pub recent_cycle_cursor: u8, // 写入最近周期窗口的位置。
    pub bump: u8,               // UserProgress PDA bump。
}

impl UserProgress {
    pub const INIT_SPACE: usize = 32 // quest，不包含 Anchor discriminator 的 8 字节。
        + 32 // user
        + 8 // total_submitted
        + 8 // total_approved
        + 8 // last_submitted_cycle
        + 8 // last_approved_cycle
        + 1 // one_time_completed
        + 1 // pending_one_time
        + 8 * RECENT_CYCLE_WINDOW // recent_cycles
        + RECENT_CYCLE_WINDOW // recent_cycle_states
        + 1 // recent_cycle_cursor
        + 1; // bump

    pub fn cycle_state(&self, cycle_index: u64) -> u8 {
        self.recent_cycles
            .iter()
            .position(|cycle| *cycle == cycle_index)
            .map(|idx| self.recent_cycle_states[idx])
            .unwrap_or(CYCLE_STATE_EMPTY)
    }

    pub fn prune_old_cycles(&mut self, current_cycle_index: u64) {
        for idx in 0..RECENT_CYCLE_WINDOW {
            if self.recent_cycle_states[idx] == CYCLE_STATE_EMPTY {
                continue;
            }

            let Some(age) = current_cycle_index.checked_sub(self.recent_cycles[idx]) else {
                continue;
            };
            if age >= RECENT_CYCLE_WINDOW as u64 {
                self.recent_cycles[idx] = 0;
                self.recent_cycle_states[idx] = CYCLE_STATE_EMPTY;
            }
        }
    }

    pub fn set_cycle_state_in_window(
        &mut self,
        cycle_index: u64,
        state: u8,
        current_cycle_index: u64,
    ) {
        self.prune_old_cycles(current_cycle_index);
        if current_cycle_index
            .checked_sub(cycle_index)
            .map(|age| age >= RECENT_CYCLE_WINDOW as u64)
            .unwrap_or(false)
        {
            return;
        }

        self.set_cycle_state(cycle_index, state);
    }

    pub fn set_cycle_state(&mut self, cycle_index: u64, state: u8) {
        if let Some(idx) = self
            .recent_cycles
            .iter()
            .position(|cycle| *cycle == cycle_index)
        {
            self.recent_cycle_states[idx] = state;
            return;
        }

        let idx = usize::from(self.recent_cycle_cursor) % RECENT_CYCLE_WINDOW;
        self.recent_cycles[idx] = cycle_index;
        self.recent_cycle_states[idx] = state;
        self.recent_cycle_cursor = ((idx + 1) % RECENT_CYCLE_WINDOW) as u8;
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum QuestMode {
    OneTime,   // 一次性任务，同一个用户只能完成一次。
    Recurring, // 长期周期任务，同一用户每个周期只能提交一次。
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ReviewMode {
    Manual,       // reviewer/publisher 手动审核。
    AutoVerified, // verifier 签名证明自动审核。
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum VerificationTemplateType {
    DistanceActivity,   // 运动距离类，例如跑步/骑行。
    StudyDuration,      // 学习时长类。
    GithubContribution, // GitHub 贡献类。
    AttendanceCheckin,  // 签到出勤类。
    CustomSigned,       // 自定义 verifier 签名结果。
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum QuestStatus {
    Open,    // 开放提交和审核。
    Closing, // 停止新提交，但 pending submission 仍可按顺序审核结算。
    Closed,  // 终态，不可提交、审核、充值或关闭。
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum SubmissionStatus {
    Pending,  // 已提交，等待审核。
    Approved, // 审核通过且完整支付。
    Rejected, // 审核拒绝，不支付奖励。
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum QuestCloseReason {
    None,               // 尚未进入 Closing。
    EarlyManual,        // publisher 在 expires_at 前主动关闭。
    RewardPoolDepleted, // reward_pool 不足一份完整奖励，协议强制提前清算。
    Expired,            // 到期后关闭，不罚没押金。
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VerificationResult {
    pub domain: String,
    pub program_id: Pubkey,
    pub quest: Pubkey,
    pub submission_index: u64,
    pub submitter: Pubkey,
    pub cycle_index: u64,
    pub template_type: VerificationTemplateType,
    pub template_config_hash: [u8; 32],
    pub external_proof_hash: [u8; 32],
    pub verified_value: u64,
    pub passed: bool,
    pub verified_at: i64,
    pub expires_at: i64,
    pub nonce: [u8; 32],
}
