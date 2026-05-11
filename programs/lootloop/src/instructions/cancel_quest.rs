use anchor_lang::prelude::*;

use crate::{error::ErrorCode, Quest, QuestStatus, PUBLIC_GOODS_POOL_SEED, VAULT_SEED};

#[derive(Accounts)]
pub struct CancelQuest<'info> {
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

    /// CHECK: This PDA only holds public goods lamports. Its address is
    /// constrained by seeds and it does not store account data.
    #[account(
        mut,
        seeds = [PUBLIC_GOODS_POOL_SEED],
        bump
    )]
    pub public_goods_pool: UncheckedAccount<'info>,

    #[account(mut)]
    pub publisher: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn cancel_quest_handler(ctx: Context<CancelQuest>) -> Result<()> {
    let quest = &mut ctx.accounts.quest;
    let now = Clock::get()?.unix_timestamp;

    require!(
        ctx.accounts.publisher.key() == quest.publisher,
        ErrorCode::Unauthorized
    ); // 只有发布者可以取消自己的任务。
    require!(
        quest.status != QuestStatus::Approved,
        ErrorCode::CannotCancelApprovedQuest
    ); // 已审核通过后不允许取消，避免抢走 winner 的奖励。
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
    ); // 只有仍在开放/审核阶段且未批准的任务可以取消。
    require!(!quest.reward_claimed, ErrorCode::RewardAlreadyClaimed);

    let remaining_lamports = ctx.accounts.vault.to_account_info().lamports();
    if remaining_lamports > 0 {
        let quest_key = quest.key();
        let vault_bump = [quest.vault_bump];
        let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, quest_key.as_ref(), &vault_bump]];

        let receiver = if now <= quest.expires_at {
            ctx.accounts.public_goods_pool.to_account_info()
        } else {
            ctx.accounts.publisher.to_account_info()
        }; // 未过期取消进入公益池；已过期取消退回发布者。

        let cpi_accounts = anchor_lang::system_program::Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: receiver,
        };
        let cpi_context = CpiContext::new_with_signer(
            anchor_lang::system_program::ID,
            cpi_accounts,
            signer_seeds,
        );
        anchor_lang::system_program::transfer(cpi_context, remaining_lamports)?;
    }

    quest.status = QuestStatus::Cancelled; // cancel 后进入终态。
    quest.cancelled_at = now; // 记录取消时间。

    Ok(())
}
