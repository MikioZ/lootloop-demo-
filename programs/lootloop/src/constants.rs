pub const QUEST_SEED: &[u8] = b"quest"; // Quest PDA 的固定前缀，区分任务账户。
pub const SUBMISSION_SEED: &[u8] = b"submission"; // Submission PDA 的固定前缀，区分 proof 提交账户。
pub const REWARD_POOL_SEED: &[u8] = b"reward_pool"; // RewardPool PDA 的固定前缀，托管正常奖励资金。
pub const DEPOSIT_POOL_SEED: &[u8] = b"deposit_pool"; // DepositPool PDA 的固定前缀，托管保障押金。
pub const USER_PROGRESS_SEED: &[u8] = b"user_progress"; // UserProgress PDA 的固定前缀，记录用户在任务中的进度。
pub const FEE_VAULT_SEED: &[u8] = b"fee_vault"; // Fee Vault PDA 的固定前缀，用来托管平台手续费。
pub const PUBLIC_GOODS_POOL_SEED: &[u8] = b"public_goods_pool"; // 公益池 PDA 的固定前缀，接收提前关闭后的剩余押金。

pub const MIN_QUEST_DURATION_SECONDS: i64 = 60; // 任务最小时限为 1 分钟，链上只信任秒数。
pub const PLATFORM_FEE_BPS: u64 = 200; // 平台手续费为 2%，用 basis points 表示。
pub const CANCELLATION_FEE_BPS: u64 = 100; // 提前关闭押金罚金为 1%，进入 fee vault。
pub const BPS_DENOMINATOR: u64 = 10_000; // basis points 分母，10_000 = 100%。
pub const MIN_REWARD_AMOUNT: u64 = 1_000_000; // 每次完成的最小奖励，单位 lamports，当前为 0.001 SOL。
pub const MIN_FUNDING_AMOUNT: u64 = 1_000_000; // 单次奖励池充值的最小金额，单位 lamports，当前为 0.001 SOL。
pub const RECENT_CYCLE_WINDOW: usize = 32; // Recurring 去重只保留最近 32 个周期，适合 MVP 队列窗口。
