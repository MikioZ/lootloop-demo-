use anchor_lang::prelude::*;

use crate::{
    error::ErrorCode, Quest, QuestMode, QuestStatus, Submission, SubmissionStatus, UserProgress,
    MAX_PROOF_URI_LEN, SUBMISSION_SEED, USER_PROGRESS_SEED,
};

#[derive(Accounts)]
pub struct SubmitProof<'info> {
    #[account(mut)]
    pub quest: Account<'info, Quest>,

    #[account(
        init,
        payer = submitter,
        space = 8 + Submission::INIT_SPACE,
        seeds = [
            SUBMISSION_SEED,
            quest.key().as_ref(),
            &quest.next_submission_index.to_le_bytes()
        ],
        bump
    )]
    pub submission: Account<'info, Submission>,

    #[account(
        init_if_needed,
        payer = submitter,
        space = 8 + UserProgress::INIT_SPACE,
        seeds = [USER_PROGRESS_SEED, quest.key().as_ref(), submitter.key().as_ref()],
        bump
    )]
    pub user_progress: Account<'info, UserProgress>,

    #[account(mut)]
    pub submitter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn submit_proof_handler(ctx: Context<SubmitProof>, proof_uri: String) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let quest = &mut ctx.accounts.quest;
    let submitter = ctx.accounts.submitter.key();

    require!(
        quest.status == QuestStatus::Open,
        ErrorCode::InvalidQuestStatus
    );
    require!(now < quest.expires_at, ErrorCode::QuestExpired);
    require!(quest.pending_count < quest.queue_max, ErrorCode::QueueFull);
    require!(
        proof_uri.len() <= MAX_PROOF_URI_LEN,
        ErrorCode::ProofUriTooLong
    );

    let cycle_index = match quest.mode {
        QuestMode::OneTime => 0,
        QuestMode::Recurring => {
            let elapsed = now
                .checked_sub(quest.start_at)
                .ok_or(ErrorCode::MathOverflow)?;
            let cycle = elapsed
                .checked_div(quest.period_seconds)
                .ok_or(ErrorCode::MathOverflow)?;
            u64::try_from(cycle).map_err(|_| ErrorCode::MathOverflow)?
        }
    };

    let progress = &mut ctx.accounts.user_progress;
    if progress.quest == Pubkey::default() {
        progress.quest = quest.key();
        progress.user = submitter;
        progress.total_submitted = 0;
        progress.total_approved = 0;
        progress.last_submitted_cycle = 0;
        progress.last_approved_cycle = 0;
        progress.one_time_completed = false;
        progress.pending_one_time = false;
        progress.recent_cycles = [0; crate::RECENT_CYCLE_WINDOW];
        progress.recent_cycle_states = [0; crate::RECENT_CYCLE_WINDOW];
        progress.recent_cycle_cursor = 0;
        progress.bump = ctx.bumps.user_progress;
    }

    match quest.mode {
        QuestMode::OneTime => {
            require!(
                !progress.one_time_completed && !progress.pending_one_time,
                ErrorCode::OneTimeAlreadySubmitted
            );
            progress.pending_one_time = true;
        }
        QuestMode::Recurring => {
            progress.prune_old_cycles(cycle_index);
            require!(
                progress.cycle_state(cycle_index) == 0,
                ErrorCode::CycleAlreadySubmitted
            );
            progress.set_cycle_state(cycle_index, 1);
        }
    }

    let submission_index = quest.next_submission_index;
    let submission = &mut ctx.accounts.submission;
    submission.quest = quest.key();
    submission.submission_index = submission_index;
    submission.submitter = submitter;
    submission.cycle_index = cycle_index;
    submission.status = SubmissionStatus::Pending;
    submission.requested_reward = quest.reward_per_completion;
    submission.paid_from_reward_pool = 0;
    submission.paid_from_deposit_pool = 0;
    submission.submitted_at = now;
    submission.reviewed_at = 0;
    submission.bump = ctx.bumps.submission;
    submission.proof_uri = proof_uri;

    quest.next_submission_index = quest
        .next_submission_index
        .checked_add(1)
        .ok_or(ErrorCode::MathOverflow)?;
    quest.total_submissions = quest
        .total_submissions
        .checked_add(1)
        .ok_or(ErrorCode::MathOverflow)?;
    quest.pending_count = quest
        .pending_count
        .checked_add(1)
        .ok_or(ErrorCode::MathOverflow)?;

    progress.total_submitted = progress
        .total_submitted
        .checked_add(1)
        .ok_or(ErrorCode::MathOverflow)?;
    progress.last_submitted_cycle = cycle_index;

    Ok(())
}
