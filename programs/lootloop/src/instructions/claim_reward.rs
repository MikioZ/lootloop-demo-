use anchor_lang::prelude::*;

use crate::{error::ErrorCode, Quest, QuestStatus, Submission, SubmissionStatus, VAULT_SEED};

#[derive(Accounts)]
pub struct ClaimReward<'info> {
    #[account(mut)]
    pub quest: Account<'info, Quest>,

    pub submission: Account<'info, Submission>,

    /// CHECK: This PDA only holds the quest reward lamports. Its address is
    /// constrained by seeds and it does not store account data.
    #[account(
        mut,
        seeds = [VAULT_SEED, quest.key().as_ref()],
        bump = quest.vault_bump
    )]
    pub vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub submitter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn claim_reward_handler(ctx: Context<ClaimReward>) -> Result<()> {
    let quest = &mut ctx.accounts.quest;
    let submission = &ctx.accounts.submission;
    let submitter = ctx.accounts.submitter.key();

    require!(
        quest.status == QuestStatus::Approved,
        ErrorCode::InvalidQuestStatus
    ); // 只有已审核通过、待领取奖励的任务可以 claim。
    require!(
        submission.status == SubmissionStatus::Approved,
        ErrorCode::InvalidSubmissionStatus
    ); // 只有审核通过的提交可以领取奖励。
    require!(
        submission.quest == quest.key(),
        ErrorCode::InvalidSubmissionQuest
    ); // Submission 必须属于当前 Quest。
    require!(
        submission.submitter == submitter,
        ErrorCode::InvalidSubmitter
    ); // 领奖人必须是该 Submission 的提交者。
    require!(
        quest.approved_submitter == Some(submitter),
        ErrorCode::InvalidSubmitter
    ); // 领奖人必须是 Quest 记录的 approved submitter。
    require!(!quest.reward_claimed, ErrorCode::RewardAlreadyClaimed); // 防止重复领取。
    require!(
        ctx.accounts.vault.to_account_info().lamports() >= quest.reward_amount,
        ErrorCode::InsufficientVaultBalance
    ); // vault 必须有足够 lamports 支付奖励。

    let quest_key = quest.key();
    let vault_bump = [quest.vault_bump];
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, quest_key.as_ref(), &vault_bump]];

    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.submitter.to_account_info(),
    };
    let cpi_context =
        CpiContext::new_with_signer(anchor_lang::system_program::ID, cpi_accounts, signer_seeds);
    anchor_lang::system_program::transfer(cpi_context, quest.reward_amount)?; // vault PDA 签名，把奖励转给 submitter。

    quest.reward_claimed = true; // 标记奖励已领取。
    quest.status = QuestStatus::Completed; // claim 后任务完成。

    Ok(())
}
