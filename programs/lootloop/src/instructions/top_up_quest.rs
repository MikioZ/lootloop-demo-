use anchor_lang::prelude::*;

use crate::{
    error::ErrorCode, Quest, QuestStatus, BPS_DENOMINATOR, FEE_VAULT_SEED, MIN_TOP_UP_AMOUNT,
    PLATFORM_FEE_BPS, VAULT_SEED,
};

#[derive(Accounts)]
pub struct TopUpQuest<'info> {
    #[account(mut)]
    pub quest: Account<'info, Quest>,

    /// CHECK: This PDA only holds the quest reward lamports. Its address is
    /// constrained by seeds and it does not store account data.
    #[account(
        mut,
        seeds = [VAULT_SEED, quest.key().as_ref()],
        bump = quest.vault_bump
    )]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: This PDA only holds platform fee lamports. Its address is
    /// constrained by seeds and it does not store account data.
    #[account(
        mut,
        seeds = [FEE_VAULT_SEED],
        bump
    )]
    pub fee_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub publisher: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn top_up_quest_handler(
    ctx: Context<TopUpQuest>,
    top_up_amount: u64,
    extend_duration_seconds: u64,
) -> Result<()> {
    let quest = &mut ctx.accounts.quest;
    let now = Clock::get()?.unix_timestamp;

    require!(
        ctx.accounts.publisher.key() == quest.publisher,
        ErrorCode::Unauthorized
    ); // 只有任务发布者可以补充奖励。
    require!(
        quest.status != QuestStatus::Approved,
        ErrorCode::CannotTopUpApprovedQuest
    ); // 已审核通过后不允许改变奖励语义。
    require!(
        quest.status != QuestStatus::Completed,
        ErrorCode::QuestAlreadyCompleted
    ); // Completed 是终态。
    require!(
        quest.status != QuestStatus::Cancelled,
        ErrorCode::QuestAlreadyCancelled
    ); // Cancelled 是终态。
    require!(
        quest.status == QuestStatus::Open || quest.status == QuestStatus::InReview,
        ErrorCode::InvalidQuestStatus
    ); // 只有仍处于开放/审核阶段的任务可以补充奖励。
    require!(!quest.reward_claimed, ErrorCode::RewardAlreadyClaimed);
    require!(
        top_up_amount >= MIN_TOP_UP_AMOUNT,
        ErrorCode::InvalidTopUpAmount
    ); // 补充奖励必须达到最小金额。

    let fee_amount = top_up_amount
        .checked_mul(PLATFORM_FEE_BPS)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(ErrorCode::MathOverflow)?;
    require!(fee_amount > 0, ErrorCode::InvalidFeeAmount);

    let extension_i64 =
        i64::try_from(extend_duration_seconds).map_err(|_| ErrorCode::MathOverflow)?;
    let new_expires_at = quest
        .expires_at
        .checked_add(extension_i64)
        .ok_or(ErrorCode::MathOverflow)?;
    require!(
        new_expires_at >= quest.expires_at,
        ErrorCode::InvalidDeadlineExtension
    ); // 截止时间只能延长，不能缩短或溢出。
    if now > quest.expires_at {
        require!(new_expires_at > now, ErrorCode::InvalidDeadlineExtension);
    } // 过期任务如果要 top up，必须同时延长到当前时间之后。

    let reward_transfer = CpiContext::new(
        anchor_lang::system_program::ID,
        anchor_lang::system_program::Transfer {
            from: ctx.accounts.publisher.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        },
    );
    anchor_lang::system_program::transfer(reward_transfer, top_up_amount)?;

    let fee_transfer = CpiContext::new(
        anchor_lang::system_program::ID,
        anchor_lang::system_program::Transfer {
            from: ctx.accounts.publisher.to_account_info(),
            to: ctx.accounts.fee_vault.to_account_info(),
        },
    );
    anchor_lang::system_program::transfer(fee_transfer, fee_amount)?;

    quest.reward_amount = quest
        .reward_amount
        .checked_add(top_up_amount)
        .ok_or(ErrorCode::MathOverflow)?;
    quest.total_funded_amount = quest
        .total_funded_amount
        .checked_add(top_up_amount)
        .ok_or(ErrorCode::MathOverflow)?;
    quest.total_fee_paid = quest
        .total_fee_paid
        .checked_add(fee_amount)
        .ok_or(ErrorCode::MathOverflow)?;
    quest.expires_at = new_expires_at;

    Ok(())
}
