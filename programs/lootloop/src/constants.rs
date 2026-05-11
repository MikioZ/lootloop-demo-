pub const QUEST_SEED: &[u8] = b"quest"; // Quest PDA 的固定前缀，区分任务账户。
pub const SUBMISSION_SEED: &[u8] = b"submission"; // Submission PDA 的固定前缀，区分 proof 提交账户。
pub const VAULT_SEED: &[u8] = b"vault"; // Vault PDA 的固定前缀，用来托管任务奖励。
pub const FEE_VAULT_SEED: &[u8] = b"fee_vault"; // Fee Vault PDA 的固定前缀，用来托管平台手续费。
pub const PUBLIC_GOODS_POOL_SEED: &[u8] = b"public_goods_pool"; // 公益池 PDA 的固定前缀，用来接收未过期取消任务的剩余奖励。

pub const MIN_QUEST_DURATION_SECONDS: u64 = 60; // 任务最小时限为 1 分钟，链上只信任秒数。
pub const PLATFORM_FEE_BPS: u64 = 200; // 平台手续费为 2%，用 basis points 表示。
pub const BPS_DENOMINATOR: u64 = 10_000; // basis points 分母，10_000 = 100%。
pub const MIN_REWARD_AMOUNT: u64 = 1_000_000; // create_quest 的最小奖励，单位 lamports，当前为 0.001 SOL。
pub const MIN_TOP_UP_AMOUNT: u64 = 1_000_000; // top_up_quest 的最小补充奖励，单位 lamports，当前为 0.001 SOL。
