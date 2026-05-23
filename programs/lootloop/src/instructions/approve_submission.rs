use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use crate::{
    error::ErrorCode, Quest, QuestCloseReason, QuestMode, QuestStatus, ReviewMode, Submission,
    SubmissionStatus, UsedProof, UserProgress, VerificationResult, AUTO_REVIEW_DOMAIN,
    DEPOSIT_POOL_SEED, MAX_VERIFICATION_TTL_SECONDS, REWARD_POOL_SEED, USED_PROOF_SEED,
    USER_PROGRESS_SEED,
};

const ED25519_SIGNATURE_OFFSETS_START: usize = 2;
const ED25519_SIGNATURE_OFFSETS_LEN: usize = 14;
const ED25519_PUBKEY_LEN: usize = 32;
const ED25519_SIGNATURE_LEN: usize = 64;
const ED25519_CURRENT_INSTRUCTION_INDEX: u16 = u16::MAX;
const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");
const INSTRUCTIONS_SYSVAR_ID: Pubkey = pubkey!("Sysvar1nstructions1111111111111111111111111");

#[derive(Accounts)]
pub struct ApproveSubmission<'info> {
    #[account(mut)]
    pub quest: Account<'info, Quest>,

    #[account(mut)]
    pub submission: Account<'info, Submission>,

    /// CHECK: The address must match submission.submitter and receives the automatic payout.
    #[account(mut)]
    pub submitter: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [USER_PROGRESS_SEED, quest.key().as_ref(), submission.submitter.as_ref()],
        bump = user_progress.bump
    )]
    pub user_progress: Account<'info, UserProgress>,

    /// CHECK: RewardPool PDA stores lamports only.
    #[account(
        mut,
        seeds = [REWARD_POOL_SEED, quest.key().as_ref()],
        bump = quest.reward_pool_bump
    )]
    pub reward_pool: UncheckedAccount<'info>,

    /// CHECK: DepositPool PDA stores lamports only.
    #[account(
        mut,
        seeds = [DEPOSIT_POOL_SEED, quest.key().as_ref()],
        bump = quest.deposit_pool_bump
    )]
    pub deposit_pool: UncheckedAccount<'info>,

    pub reviewer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(external_proof_hash: [u8; 32])]
pub struct AutoApproveSubmission<'info> {
    #[account(mut)]
    pub quest: Account<'info, Quest>,

    #[account(mut)]
    pub submission: Account<'info, Submission>,

    /// CHECK: The address must match submission.submitter and receives the automatic payout.
    #[account(mut)]
    pub submitter: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [USER_PROGRESS_SEED, quest.key().as_ref(), submission.submitter.as_ref()],
        bump = user_progress.bump
    )]
    pub user_progress: Account<'info, UserProgress>,

    /// CHECK: RewardPool PDA stores lamports only.
    #[account(
        mut,
        seeds = [REWARD_POOL_SEED, quest.key().as_ref()],
        bump = quest.reward_pool_bump
    )]
    pub reward_pool: UncheckedAccount<'info>,

    /// CHECK: DepositPool PDA stores lamports only.
    #[account(
        mut,
        seeds = [DEPOSIT_POOL_SEED, quest.key().as_ref()],
        bump = quest.deposit_pool_bump
    )]
    pub deposit_pool: UncheckedAccount<'info>,

    #[account(
        init,
        payer = caller,
        space = 8 + UsedProof::INIT_SPACE,
        seeds = [
            USED_PROOF_SEED,
            quest.key().as_ref(),
            external_proof_hash.as_ref()
        ],
        bump
    )]
    pub used_proof: Account<'info, UsedProof>,

    /// CHECK: Instruction sysvar is read to verify the previous Ed25519 instruction.
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    #[account(mut)]
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn approve_submission_handler(ctx: Context<ApproveSubmission>) -> Result<()> {
    let quest = &ctx.accounts.quest;
    require!(
        quest.review_mode == ReviewMode::Manual,
        ErrorCode::InvalidReviewMode
    );
    require!(
        ctx.accounts.reviewer.key() == quest.reviewer
            || ctx.accounts.reviewer.key() == quest.publisher,
        ErrorCode::Unauthorized
    );

    approve_and_pay_submission(
        &mut ctx.accounts.quest,
        &mut ctx.accounts.submission,
        &ctx.accounts.submitter,
        &mut ctx.accounts.user_progress,
        &ctx.accounts.reward_pool,
        &ctx.accounts.deposit_pool,
        &ctx.accounts.system_program,
    )
}

pub fn auto_approve_submission_handler(
    ctx: Context<AutoApproveSubmission>,
    external_proof_hash: [u8; 32],
    verification_result: VerificationResult,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let quest = &ctx.accounts.quest;
    let submission = &ctx.accounts.submission;

    require!(
        quest.review_mode == ReviewMode::AutoVerified,
        ErrorCode::InvalidReviewMode
    );
    require!(
        quest.status == QuestStatus::Open || quest.status == QuestStatus::Closing,
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
    require!(
        ctx.accounts.submitter.key() == submission.submitter,
        ErrorCode::Unauthorized
    );

    require!(
        verification_result.domain == AUTO_REVIEW_DOMAIN,
        ErrorCode::InvalidVerificationResult
    );
    require!(
        verification_result.program_id == crate::ID,
        ErrorCode::InvalidVerificationResult
    );
    require!(
        verification_result.quest == quest.key(),
        ErrorCode::InvalidVerificationResult
    );
    require!(
        verification_result.submission_index == submission.submission_index,
        ErrorCode::InvalidVerificationResult
    );
    require!(
        verification_result.submitter == submission.submitter,
        ErrorCode::InvalidVerificationResult
    );
    require!(
        verification_result.cycle_index == submission.cycle_index,
        ErrorCode::InvalidVerificationResult
    );
    require!(
        verification_result.template_type == quest.verification_template,
        ErrorCode::InvalidVerificationResult
    );
    require!(
        verification_result.template_config_hash == quest.template_config_hash,
        ErrorCode::InvalidVerificationResult
    );
    require!(
        verification_result.external_proof_hash == external_proof_hash,
        ErrorCode::InvalidVerificationResult
    );
    require!(
        verification_result.passed,
        ErrorCode::InvalidVerificationResult
    );
    require!(
        verification_result.verified_at <= now,
        ErrorCode::VerificationFromFuture
    );
    require!(
        verification_result.expires_at > now,
        ErrorCode::VerificationExpired
    );
    let verification_ttl = verification_result
        .expires_at
        .checked_sub(verification_result.verified_at)
        .ok_or(ErrorCode::MathOverflow)?;
    require!(
        verification_ttl <= MAX_VERIFICATION_TTL_SECONDS,
        ErrorCode::VerificationTtlTooLong
    );

    let mut message = Vec::new();
    verification_result
        .serialize(&mut message)
        .map_err(|_| ErrorCode::InvalidVerificationResult)?;
    verify_previous_ed25519_instruction(
        ctx.accounts.instructions_sysvar.to_account_info(),
        quest.authorized_verifier,
        &message,
    )?;

    approve_and_pay_submission(
        &mut ctx.accounts.quest,
        &mut ctx.accounts.submission,
        &ctx.accounts.submitter,
        &mut ctx.accounts.user_progress,
        &ctx.accounts.reward_pool,
        &ctx.accounts.deposit_pool,
        &ctx.accounts.system_program,
    )?;

    let used_proof = &mut ctx.accounts.used_proof;
    used_proof.quest = ctx.accounts.quest.key();
    used_proof.external_proof_hash = verification_result.external_proof_hash;
    used_proof.submission_index = ctx.accounts.submission.submission_index;
    used_proof.submitter = ctx.accounts.submission.submitter;
    used_proof.cycle_index = ctx.accounts.submission.cycle_index;
    used_proof.used_at = now;
    used_proof.bump = ctx.bumps.used_proof;

    Ok(())
}

pub fn approve_and_pay_submission<'info>(
    quest: &mut Account<'info, Quest>,
    submission: &mut Account<'info, Submission>,
    submitter: &UncheckedAccount<'info>,
    user_progress: &mut Account<'info, UserProgress>,
    reward_pool: &UncheckedAccount<'info>,
    deposit_pool: &UncheckedAccount<'info>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(
        quest.status == QuestStatus::Open || quest.status == QuestStatus::Closing,
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
    require!(
        submitter.key() == submission.submitter,
        ErrorCode::Unauthorized
    );

    let requested_reward = quest.reward_per_completion;
    let quest_key = quest.key();
    let reward_available = reward_pool.to_account_info().lamports();
    let deposit_available = deposit_pool.to_account_info().lamports();
    let mut paid_from_reward_pool = 0;
    let mut paid_from_deposit_pool = 0;

    if quest.status == QuestStatus::Open && reward_available >= requested_reward {
        paid_from_reward_pool = requested_reward;
        transfer_from_pool(
            reward_pool,
            submitter,
            system_program,
            &[
                REWARD_POOL_SEED,
                quest_key.as_ref(),
                &[quest.reward_pool_bump],
            ],
            paid_from_reward_pool,
        )?;
    } else {
        require!(
            deposit_available >= requested_reward,
            ErrorCode::InsufficientDepositForGuaranteedPayment
        );

        if quest.status == QuestStatus::Open {
            quest.status = QuestStatus::Closing;
            quest.close_requested_at = now;
            quest.closing_reason = if now < quest.expires_at {
                QuestCloseReason::RewardPoolDepleted
            } else {
                QuestCloseReason::Expired
            };
        }

        paid_from_deposit_pool = requested_reward;
        transfer_from_pool(
            deposit_pool,
            submitter,
            system_program,
            &[
                DEPOSIT_POOL_SEED,
                quest_key.as_ref(),
                &[quest.deposit_pool_bump],
            ],
            paid_from_deposit_pool,
        )?;
    }

    submission.paid_from_reward_pool = paid_from_reward_pool;
    submission.paid_from_deposit_pool = paid_from_deposit_pool;
    submission.reviewed_at = now;
    submission.status = SubmissionStatus::Approved;

    quest.total_paid_amount = quest
        .total_paid_amount
        .checked_add(requested_reward)
        .ok_or(ErrorCode::MathOverflow)?;
    quest.total_approved = quest
        .total_approved
        .checked_add(1)
        .ok_or(ErrorCode::MathOverflow)?;
    quest.next_review_index = quest
        .next_review_index
        .checked_add(1)
        .ok_or(ErrorCode::MathOverflow)?;
    quest.pending_count = quest
        .pending_count
        .checked_sub(1)
        .ok_or(ErrorCode::MathOverflow)?;

    match quest.mode {
        QuestMode::OneTime => {
            user_progress.pending_one_time = false;
            user_progress.one_time_completed = true;
        }
        QuestMode::Recurring => {
            let window_anchor = user_progress
                .last_submitted_cycle
                .max(submission.cycle_index);
            user_progress.set_cycle_state_in_window(submission.cycle_index, 2, window_anchor);
            user_progress.last_approved_cycle = submission.cycle_index;
        }
    }
    user_progress.total_approved = user_progress
        .total_approved
        .checked_add(1)
        .ok_or(ErrorCode::MathOverflow)?;

    Ok(())
}

fn verify_previous_ed25519_instruction(
    instructions_sysvar: AccountInfo,
    expected_verifier: Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    let current_index = load_current_index_checked(&instructions_sysvar)
        .map_err(|_| ErrorCode::InvalidEd25519Instruction)?;
    require!(current_index > 0, ErrorCode::InvalidEd25519Instruction);
    let ed25519_ix =
        load_instruction_at_checked(usize::from(current_index - 1), &instructions_sysvar)
            .map_err(|_| ErrorCode::InvalidEd25519Instruction)?;

    require!(
        ed25519_ix.program_id == ED25519_PROGRAM_ID,
        ErrorCode::InvalidEd25519Instruction
    );
    let data = ed25519_ix.data;
    require!(data.len() >= 16, ErrorCode::InvalidEd25519Instruction);
    require!(data[0] == 1, ErrorCode::InvalidEd25519Instruction);

    let signature_offset = read_u16(&data, ED25519_SIGNATURE_OFFSETS_START)?;
    let signature_instruction_index = read_u16(&data, ED25519_SIGNATURE_OFFSETS_START + 2)?;
    let public_key_offset = read_u16(&data, ED25519_SIGNATURE_OFFSETS_START + 4)?;
    let public_key_instruction_index = read_u16(&data, ED25519_SIGNATURE_OFFSETS_START + 6)?;
    let message_offset = read_u16(&data, ED25519_SIGNATURE_OFFSETS_START + 8)?;
    let message_size = read_u16(&data, ED25519_SIGNATURE_OFFSETS_START + 10)?;
    let message_instruction_index = read_u16(&data, ED25519_SIGNATURE_OFFSETS_START + 12)?;

    require!(
        signature_instruction_index == ED25519_CURRENT_INSTRUCTION_INDEX
            && public_key_instruction_index == ED25519_CURRENT_INSTRUCTION_INDEX
            && message_instruction_index == ED25519_CURRENT_INSTRUCTION_INDEX,
        ErrorCode::InvalidEd25519Instruction
    );

    let signature_start = usize::from(signature_offset);
    let public_key_start = usize::from(public_key_offset);
    let message_start = usize::from(message_offset);
    let message_len = usize::from(message_size);
    require!(
        signature_start
            .checked_add(ED25519_SIGNATURE_LEN)
            .map(|end| end <= data.len())
            .unwrap_or(false)
            && public_key_start
                .checked_add(ED25519_PUBKEY_LEN)
                .map(|end| end <= data.len())
                .unwrap_or(false)
            && message_start
                .checked_add(message_len)
                .map(|end| end <= data.len())
                .unwrap_or(false),
        ErrorCode::InvalidEd25519Instruction
    );

    let pubkey_bytes = &data[public_key_start..public_key_start + ED25519_PUBKEY_LEN];
    require!(
        pubkey_bytes == expected_verifier.as_ref(),
        ErrorCode::InvalidVerifierSignature
    );
    let message = &data[message_start..message_start + message_len];
    require!(
        message == expected_message,
        ErrorCode::InvalidVerifierSignature
    );

    // The native Ed25519 program verifies the signature before this instruction executes.
    // This parser binds that verified signer/message pair to the current quest context.
    let _signature = &data[signature_start..signature_start + ED25519_SIGNATURE_LEN];
    let _offsets_len = ED25519_SIGNATURE_OFFSETS_LEN;

    Ok(())
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16> {
    let bytes = data
        .get(offset..offset + 2)
        .ok_or(ErrorCode::InvalidEd25519Instruction)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn transfer_from_pool<'info>(
    from: &UncheckedAccount<'info>,
    to: &UncheckedAccount<'info>,
    _system_program: &Program<'info, System>,
    signer_seeds: &[&[u8]],
    amount: u64,
) -> Result<()> {
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: from.to_account_info(),
        to: to.to_account_info(),
    };
    let signer_seeds: &[&[&[u8]]] = &[signer_seeds];
    let cpi_context =
        CpiContext::new_with_signer(anchor_lang::system_program::ID, cpi_accounts, signer_seeds);
    anchor_lang::system_program::transfer(cpi_context, amount)
}
