use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("You are not authorized to perform this action")]
    Unauthorized, // 调用者没有权限执行该操作。
    #[msg("The metadata URI exceeds the maximum allowed length")]
    MetadataUriTooLong, // 任务元数据 URI 超过最大长度。
    #[msg("The proof URI exceeds the maximum allowed length")]
    ProofUriTooLong, // Proof URI 超过最大长度。
    #[msg("The reward per completion is below the minimum amount")]
    InvalidRewardAmount, // 单次完成奖励低于最小值。
    #[msg("The reward funding amount is invalid")]
    InvalidFundingAmount, // 奖励池充值金额无效。
    #[msg("The deposit amount is below the required minimum")]
    InsufficientDeposit, // 押金不足以覆盖队列风险。
    #[msg("The reward funding amount must be a multiple of reward_per_completion")]
    RewardFundingNotMultipleOfReward, // 奖励池充值必须是单次奖励的整数倍。
    #[msg("The deposit amount must be a multiple of reward_per_completion")]
    DepositNotMultipleOfReward, // 押金充值必须是单次奖励的整数倍。
    #[msg("The deposit pool cannot satisfy the guaranteed full payment")]
    InsufficientDepositForGuaranteedPayment, // 协议支付保障被破坏，不能半支付。
    #[msg("The queue max must be greater than zero")]
    InvalidQueueMax, // 队列容量必须大于 0。
    #[msg("The quest mode or period configuration is invalid")]
    InvalidQuestMode, // OneTime / Recurring 参数不匹配。
    #[msg("The review mode is invalid for this instruction")]
    InvalidReviewMode, // Manual / AutoVerified instruction 不匹配。
    #[msg("The authorized verifier is invalid")]
    InvalidAuthorizedVerifier, // AutoVerified 必须设置 verifier。
    #[msg("The verification schema URI exceeds the maximum allowed length")]
    VerificationSchemaUriTooLong, // 自动审核 schema URI 太长。
    #[msg("The template config hash is invalid")]
    InvalidTemplateConfigHash, // AutoVerified 模板 hash 不能全 0。
    #[msg("The verification result is invalid")]
    InvalidVerificationResult, // verifier 结果上下文不匹配或 passed=false。
    #[msg("The verification result has expired")]
    VerificationExpired, // verifier 签名结果过期。
    #[msg("The Ed25519 verification instruction is missing or invalid")]
    InvalidEd25519Instruction, // 缺少或无法解析 Ed25519 原生验签指令。
    #[msg("The verifier signature does not match the expected message")]
    InvalidVerifierSignature, // signer/message 与 authorized verifier 或 result 不匹配。
    #[msg("The quest is not in the required status")]
    InvalidQuestStatus, // Quest 当前状态不允许执行该操作。
    #[msg("The submission is not in the required status")]
    InvalidSubmissionStatus, // Submission 当前状态不允许执行该操作。
    #[msg("The submission does not belong to the provided quest")]
    InvalidSubmissionQuest, // Submission 不属于当前 Quest。
    #[msg("The submission index is not the next review index")]
    InvalidReviewOrder, // 审核必须按链上队列顺序执行。
    #[msg("The quest queue is full")]
    QueueFull, // pending_count 已达到 queue_max。
    #[msg("The user already has a pending or completed one-time submission")]
    OneTimeAlreadySubmitted, // OneTime 用户不能重复排队或完成。
    #[msg("The user already submitted in this recurring cycle")]
    CycleAlreadySubmitted, // Recurring 同一周期不能重复提交。
    #[msg("Math operation overflowed")]
    MathOverflow, // 数学运算溢出。
    #[msg("The quest duration is shorter than the minimum allowed duration")]
    DurationTooShort, // 任务时限低于最小时限。
    #[msg("The quest has expired")]
    QuestExpired, // 任务已经过期，不能继续提交。
    #[msg("The quest deadline extension is invalid")]
    InvalidDeadlineExtension, // 截止时间只能延长，不能缩短。
    #[msg("Invalid fee calculation")]
    InvalidFeeAmount, // 手续费计算结果无效。
    #[msg("The pool does not have enough lamports for this transfer")]
    InsufficientPoolBalance, // 指定资金池余额不足。
    #[msg("The quest still has pending submissions")]
    PendingSubmissionsRemaining, // settle 前必须先清空 pending。
    #[msg("The quest review index has not caught up to the submission index")]
    UnreviewedSubmissionsRemaining, // settle 前 next_review_index 必须追平 next_submission_index。
}
