use anchor_lang::prelude::*;

use crate::{error::ErrorCode, Quest, QuestStatus, Submission, SubmissionStatus};

#[derive(Accounts)]
pub struct ApproveSubmission<'info> {
    #[account(mut)]
    pub quest: Account<'info, Quest>,

    #[account(mut)]
    pub submission: Account<'info, Submission>,

    pub reviewer: Signer<'info>,
}

pub fn approve_submission_handler(ctx: Context<ApproveSubmission>) -> Result<()> {
    let quest = &mut ctx.accounts.quest;
    let submission = &mut ctx.accounts.submission;
    let reviewer = ctx.accounts.reviewer.key();

    require!(
        reviewer == quest.reviewer || reviewer == quest.publisher,
        ErrorCode::Unauthorized
    ); // 只有任务审核者或发布者可以审核提交。
    require!(
        submission.status == SubmissionStatus::Pending,
        ErrorCode::InvalidSubmissionStatus
    ); // 只能审核等待中的提交。
    require!(
        submission.quest == quest.key(),
        ErrorCode::InvalidSubmissionQuest
    ); // Submission 必须属于当前 Quest。
    require!(
        quest.status == QuestStatus::Open || quest.status == QuestStatus::InReview,
        ErrorCode::InvalidQuestStatus
    ); // Quest 必须处于可审核阶段。
    let now = Clock::get()?.unix_timestamp; // 审核时限只使用 Solana Clock。
    require!(now <= quest.expires_at, ErrorCode::QuestExpired); // 任务过期后不允许审核通过。
    require!(!quest.reward_claimed, ErrorCode::RewardAlreadyClaimed); // 已领取奖励的任务不能再审核。
    require!(
        quest.approved_submitter.is_none(),
        ErrorCode::AlreadyApproved
    ); // 一个 Quest MVP 阶段只允许批准一个提交者。

    submission.status = SubmissionStatus::Approved; // 标记该 proof 审核通过。
    submission.reviewed_at = Clock::get()?.unix_timestamp; // 记录审核时间。
    quest.status = QuestStatus::Approved; // Quest 进入已通过、待领取奖励状态。
    quest.approved_submitter = Some(submission.submitter); // 记录后续可领取奖励的提交者。

    Ok(())
}
