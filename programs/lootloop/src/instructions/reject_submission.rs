use anchor_lang::prelude::*;

use crate::{
    error::ErrorCode, Quest, QuestMode, QuestStatus, Submission, SubmissionStatus, UserProgress,
    USER_PROGRESS_SEED,
};

#[derive(Accounts)]
pub struct RejectSubmission<'info> {
    #[account(mut)]
    pub quest: Account<'info, Quest>,

    #[account(mut)]
    pub submission: Account<'info, Submission>,

    #[account(
        mut,
        seeds = [USER_PROGRESS_SEED, quest.key().as_ref(), submission.submitter.as_ref()],
        bump = user_progress.bump
    )]
    pub user_progress: Account<'info, UserProgress>,

    pub reviewer: Signer<'info>,
}

pub fn reject_submission_handler(ctx: Context<RejectSubmission>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let quest = &mut ctx.accounts.quest;
    let submission = &mut ctx.accounts.submission;

    require!(
        ctx.accounts.reviewer.key() == quest.reviewer
            || ctx.accounts.reviewer.key() == quest.publisher,
        ErrorCode::Unauthorized
    );
    require!(
        quest.status != QuestStatus::Closed,
        ErrorCode::InvalidQuestStatus
    );
    require!(
        submission.status == SubmissionStatus::Pending,
        ErrorCode::InvalidSubmissionStatus
    );
    require!(
        submission.quest == quest.key(),
        ErrorCode::InvalidSubmissionQuest
    );
    require!(
        submission.submission_index == quest.next_review_index,
        ErrorCode::InvalidReviewOrder
    );

    submission.status = SubmissionStatus::Rejected;
    submission.reviewed_at = now;

    quest.next_review_index = quest
        .next_review_index
        .checked_add(1)
        .ok_or(ErrorCode::MathOverflow)?;
    quest.pending_count = quest
        .pending_count
        .checked_sub(1)
        .ok_or(ErrorCode::MathOverflow)?;
    quest.total_rejected = quest
        .total_rejected
        .checked_add(1)
        .ok_or(ErrorCode::MathOverflow)?;

    let progress = &mut ctx.accounts.user_progress;
    match quest.mode {
        QuestMode::OneTime => {
            progress.pending_one_time = false;
        }
        QuestMode::Recurring => {
            let window_anchor = progress.last_submitted_cycle.max(submission.cycle_index);
            progress.set_cycle_state_in_window(submission.cycle_index, 0, window_anchor);
        }
    }

    Ok(())
}
