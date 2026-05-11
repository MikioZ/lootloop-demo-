use anchor_lang::prelude::*;

use crate::{
    error::ErrorCode, Quest, QuestStatus, BPS_DENOMINATOR, FEE_VAULT_SEED, MAX_METADATA_URI_LEN,
    MIN_QUEST_DURATION_SECONDS, MIN_REWARD_AMOUNT, PLATFORM_FEE_BPS, QUEST_SEED, VAULT_SEED,
};

#[derive(Accounts)]
#[instruction(quest_id: u64)]
pub struct CreateQuest<'info> {
    #[account(
        init, // 创建新的 Quest 账户。
        payer = publisher, // publisher 支付账户租金。
        space = 8 + Quest::INIT_SPACE, // 8 是 Anchor discriminator，INIT_SPACE 是账户数据空间。
        seeds = [QUEST_SEED, publisher.key().as_ref(), &quest_id.to_le_bytes()], // 用发布者和 quest_id 派生唯一任务 PDA。
        bump // Anchor 自动查找 Quest PDA bump。
    )]
    pub quest: Account<'info, Quest>,

    /// CHECK: This PDA only holds the quest reward lamports. Its address is
    /// constrained by seeds and it does not store account data.
    #[account(
        mut, // create_quest 会把奖励转入 vault，所以需要可写。
        seeds = [VAULT_SEED, quest.key().as_ref()], // 每个 Quest 对应一个独立奖励金库 PDA。
        bump // Anchor 自动查找 Vault PDA bump。
    )]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: This PDA only holds platform fee lamports. Its address is
    /// constrained by seeds and it does not store account data.
    #[account(
        mut, // create_quest 会把 2% 平台手续费转入 fee vault。
        seeds = [FEE_VAULT_SEED], // 全局平台手续费金库 PDA。
        bump
    )]
    pub fee_vault: UncheckedAccount<'info>,

    #[account(mut)] // publisher 需要支付租金和转出奖励。
    pub publisher: Signer<'info>,
    pub system_program: Program<'info, System>, // 创建账户和 SOL 转账都依赖 System Program。
}

pub fn create_quest_handler(
    ctx: Context<CreateQuest>,
    quest_id: u64,
    metadata_uri: String,
    reviewer: Pubkey,
    reward_amount: u64,
    duration_seconds: u64,
) -> Result<()> {
    require!(
        metadata_uri.len() <= MAX_METADATA_URI_LEN,
        ErrorCode::MetadataUriTooLong
    ); // 限制 URI 长度，保证不会超过账户预分配空间。
    require!(
        reward_amount >= MIN_REWARD_AMOUNT,
        ErrorCode::InvalidRewardAmount
    ); // 奖励必须达到最小金额，避免手续费被整数除法截断为无意义的小额。
    require!(
        duration_seconds >= MIN_QUEST_DURATION_SECONDS,
        ErrorCode::DurationTooShort
    ); // 任务时限至少 1 分钟。

    let fee_amount = reward_amount
        .checked_mul(PLATFORM_FEE_BPS)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(ErrorCode::MathOverflow)?; // 用整数 basis points 计算 2% 平台手续费。
    require!(fee_amount > 0, ErrorCode::InvalidFeeAmount);

    let now = Clock::get()?.unix_timestamp; // 所有时间判断只信任 Solana Clock。
    let duration_i64 = i64::try_from(duration_seconds).map_err(|_| ErrorCode::MathOverflow)?;
    let expires_at = now
        .checked_add(duration_i64)
        .ok_or(ErrorCode::MathOverflow)?; // 链上计算截止时间，不信任前端传入的绝对时间。

    let quest = &mut ctx.accounts.quest; // 拿到刚创建的 Quest 账户并写入初始数据。
    quest.quest_id = quest_id; // 保存任务编号，方便前端和索引器读取。
    quest.publisher = ctx.accounts.publisher.key(); // 记录发布者地址。
    quest.reviewer = reviewer; // 记录审核者地址。
    quest.reward_amount = reward_amount; // 记录锁定的奖励金额。
    quest.total_funded_amount = reward_amount; // 初始累计奖励等于首次锁定奖励。
    quest.total_fee_paid = fee_amount; // 初始累计手续费等于 create_quest 手续费。
    quest.created_at = now; // 记录任务创建时间。
    quest.expires_at = expires_at; // 记录任务截止时间。
    quest.cancelled_at = 0; // 创建时任务尚未取消。
    quest.status = QuestStatus::Open; // 新任务默认处于开放状态。
    quest.approved_submitter = None; // 创建时还没有通过审核的提交者。
    quest.submission_count = 0; // 创建时还没有任何 proof 提交。
    quest.reward_claimed = false; // 创建时奖励还未领取。
    quest.bump = ctx.bumps.quest; // 保存 Quest PDA bump，后续可复用。
    quest.vault_bump = ctx.bumps.vault; // 保存 Vault PDA bump，后续 claim 时用于 PDA 签名。
    quest.metadata_uri = metadata_uri; // 保存任务元数据 URI。

    let reward_transfer = CpiContext::new(
        anchor_lang::system_program::ID,
        anchor_lang::system_program::Transfer {
            from: ctx.accounts.publisher.to_account_info(), // 奖励从发布者账户扣除。
            to: ctx.accounts.vault.to_account_info(),       // 奖励进入该 Quest 的 vault PDA。
        },
    );
    anchor_lang::system_program::transfer(reward_transfer, reward_amount)?; // 执行 SOL 转账，完成奖励锁定。

    let fee_transfer = CpiContext::new(
        anchor_lang::system_program::ID,
        anchor_lang::system_program::Transfer {
            from: ctx.accounts.publisher.to_account_info(), // 手续费也由发布者支付。
            to: ctx.accounts.fee_vault.to_account_info(),   // 手续费进入全局 fee vault PDA。
        },
    );
    anchor_lang::system_program::transfer(fee_transfer, fee_amount)?; // 收取 2% 平台手续费。

    Ok(())
}
