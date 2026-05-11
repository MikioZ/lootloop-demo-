use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("You are not authorized to perform this action")]
    Unauthorized, // 调用者没有权限执行该操作。
    #[msg("The account is not in the required status for this action")]
    InvalidStatus, // 当前状态不允许执行该操作。
    #[msg("This submission has already been claimed")]
    AlreadyClaimed, // 提交对应奖励已领取。
    #[msg("The submission has not been approved")]
    NotApproved, // 提交尚未审核通过。
    #[msg("The quest reward has already been claimed")]
    RewardAlreadyClaimed, // Quest 奖励已经被领取。
    #[msg("The submitter does not match the approved submitter")]
    InvalidSubmitter, // 当前领取者不是被批准的提交者。
    #[msg("The reviewer does not match the quest reviewer")]
    InvalidReviewer, // 当前审核者不是任务指定审核者。
    #[msg("The metadata URI exceeds the maximum allowed length")]
    MetadataUriTooLong, // 任务元数据 URI 超过最大长度。
    #[msg("The reward amount must be greater than zero")]
    InvalidRewardAmount, // 奖励金额必须大于 0。
    #[msg("The proof URI exceeds the maximum allowed length")]
    ProofUriTooLong, // Proof URI 超过最大长度。
    #[msg("The quest is not open for proof submissions")]
    InvalidQuestStatus, // Quest 当前状态不允许提交 proof。
    #[msg("Math operation overflowed")]
    MathOverflow, // 数学运算溢出。
    #[msg("The submission is not in the required status")]
    InvalidSubmissionStatus, // Submission 当前状态不允许执行该操作。
    #[msg("The submission does not belong to the provided quest")]
    InvalidSubmissionQuest, // Submission 不属于当前 Quest。
    #[msg("The quest already has an approved submission")]
    AlreadyApproved, // Quest 已经批准过一个提交。
    #[msg("The reward vault does not have enough lamports")]
    InsufficientVaultBalance, // 奖励金库余额不足。
    #[msg("The quest duration is shorter than the minimum allowed duration")]
    DurationTooShort, // 任务时限低于最小时限。
    #[msg("The quest has expired")]
    QuestExpired, // 任务已经过期，不能继续提交或审核。
    #[msg("The quest is not expired yet")]
    QuestNotExpired, // 任务尚未过期。
    #[msg("The top up amount is below the minimum amount")]
    InvalidTopUpAmount, // 补充奖励金额低于最小值。
    #[msg("The quest deadline extension is invalid")]
    InvalidDeadlineExtension, // 截止时间延长参数无效或导致时间倒退。
    #[msg("Cannot cancel an approved quest")]
    CannotCancelApprovedQuest, // 已审核通过的任务不能取消。
    #[msg("The quest has already been completed")]
    QuestAlreadyCompleted, // Completed 是终态，不能继续操作。
    #[msg("The quest has already been cancelled")]
    QuestAlreadyCancelled, // Cancelled 是终态，不能继续操作。
    #[msg("Cannot top up an approved quest")]
    CannotTopUpApprovedQuest, // 已审核通过的任务不能继续补充奖励。
    #[msg("Invalid fee calculation")]
    InvalidFeeAmount, // 手续费计算结果无效。
}
