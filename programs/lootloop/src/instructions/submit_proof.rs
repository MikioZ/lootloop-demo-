use anchor_lang::prelude::*;

use crate::{
    error::ErrorCode, Quest, QuestStatus, Submission, SubmissionStatus, MAX_PROOF_URI_LEN,
    SUBMISSION_SEED,
};

#[derive(Accounts)]
pub struct SubmitProof<'info> {
    #[account(mut)]
    pub quest: Account<'info, Quest>,

    #[account(
        init, // 创建该用户针对该任务的 proof 提交账户。
        payer = submitter, // submitter 支付 Submission 账户租金。
        space = 8 + Submission::INIT_SPACE, // 8 是 Anchor discriminator。
        seeds = [SUBMISSION_SEED, quest.key().as_ref(), submitter.key().as_ref()], // 一个用户对一个任务只能提交一次。
        bump
    )]
    pub submission: Account<'info, Submission>,

    #[account(mut)] // submitter 需要支付账户租金。
    pub submitter: Signer<'info>,
    pub system_program: Program<'info, System>, // 创建账户依赖 System Program。
}

pub fn submit_proof_handler(ctx: Context<SubmitProof>, proof_uri: String) -> Result<()> {
    require!(
        ctx.accounts.quest.status == QuestStatus::Open,
        ErrorCode::InvalidQuestStatus
    ); // 只有开放状态的任务允许提交 proof。
    let now = Clock::get()?.unix_timestamp; // 过期判断只使用 Solana Clock，不信任前端时间。
    require!(
        now <= ctx.accounts.quest.expires_at,
        ErrorCode::QuestExpired
    ); // 任务过期后不允许继续提交 proof。
    require!(
        proof_uri.len() <= MAX_PROOF_URI_LEN,
        ErrorCode::ProofUriTooLong
    ); // 限制 proof URI 长度，保证不会超过账户预分配空间。

    let submission = &mut ctx.accounts.submission; // 写入刚创建的 Submission 账户。
    submission.quest = ctx.accounts.quest.key(); // 记录所属 Quest。
    submission.submitter = ctx.accounts.submitter.key(); // 记录提交者。
    submission.status = SubmissionStatus::Pending; // 新提交默认等待审核。
    submission.bump = ctx.bumps.submission; // 保存 Submission PDA bump。
    submission.submitted_at = Clock::get()?.unix_timestamp; // 记录链上时间戳。
    submission.reviewed_at = 0; // 尚未审核，时间戳先记为 0。
    submission.proof_uri = proof_uri; // 保存链下 proof URI。

    let quest = &mut ctx.accounts.quest;
    quest.submission_count = quest
        .submission_count
        .checked_add(1)
        .ok_or(ErrorCode::MathOverflow)?; // 提交数量 +1，并防止 u64 溢出。

    Ok(())
}
