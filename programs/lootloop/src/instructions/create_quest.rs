use anchor_lang::prelude::*;

use crate::{
    error::ErrorCode, Quest, QuestCloseReason, QuestMode, QuestStatus, ReviewMode,
    VerificationTemplateType, BPS_DENOMINATOR, DEPOSIT_POOL_SEED, FEE_VAULT_SEED,
    MAX_METADATA_URI_LEN, MAX_VERIFICATION_SCHEMA_URI_LEN, MIN_FUNDING_AMOUNT,
    MIN_QUEST_DURATION_SECONDS, MIN_REWARD_AMOUNT, PLATFORM_FEE_BPS, PUBLIC_GOODS_POOL_SEED,
    QUEST_SEED, REWARD_POOL_SEED,
};

#[derive(Accounts)]
#[instruction(quest_id: u64)]
pub struct CreateQuest<'info> {
    #[account(
        init,
        payer = publisher,
        space = 8 + Quest::INIT_SPACE,
        seeds = [QUEST_SEED, publisher.key().as_ref(), &quest_id.to_le_bytes()],
        bump
    )]
    pub quest: Account<'info, Quest>,

    /// CHECK: This PDA only holds reward lamports and is constrained by seeds.
    #[account(mut, seeds = [REWARD_POOL_SEED, quest.key().as_ref()], bump)]
    pub reward_pool: UncheckedAccount<'info>,

    /// CHECK: This PDA only holds deposit lamports and is constrained by seeds.
    #[account(mut, seeds = [DEPOSIT_POOL_SEED, quest.key().as_ref()], bump)]
    pub deposit_pool: UncheckedAccount<'info>,

    /// CHECK: Global protocol fee PDA. It stores lamports only.
    #[account(mut, seeds = [FEE_VAULT_SEED], bump)]
    pub fee_vault: UncheckedAccount<'info>,

    /// CHECK: Global public goods PDA. It stores lamports only and may be empty at create time.
    #[account(mut, seeds = [PUBLIC_GOODS_POOL_SEED], bump)]
    pub public_goods_pool: UncheckedAccount<'info>,

    #[account(mut)]
    pub publisher: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn create_quest_handler(
    ctx: Context<CreateQuest>,
    quest_id: u64,
    mode: QuestMode,
    review_mode: ReviewMode,
    verification_template: VerificationTemplateType,
    template_config_hash: [u8; 32],
    verification_schema_uri: String,
    authorized_verifier: Pubkey,
    metadata_uri: String,
    reviewer: Pubkey,
    reward_per_completion: u64,
    initial_reward_funding: u64,
    deposit_amount: u64,
    duration_seconds: i64,
    period_seconds: i64,
    queue_max: u32,
) -> Result<()> {
    require!(
        metadata_uri.len() <= MAX_METADATA_URI_LEN,
        ErrorCode::MetadataUriTooLong
    );
    require!(
        verification_schema_uri.len() <= MAX_VERIFICATION_SCHEMA_URI_LEN,
        ErrorCode::VerificationSchemaUriTooLong
    );
    require!(
        reward_per_completion >= MIN_REWARD_AMOUNT,
        ErrorCode::InvalidRewardAmount
    );
    require!(queue_max > 0, ErrorCode::InvalidQueueMax);
    require!(
        duration_seconds >= MIN_QUEST_DURATION_SECONDS,
        ErrorCode::DurationTooShort
    );

    match mode {
        QuestMode::OneTime => require!(period_seconds == 0, ErrorCode::InvalidQuestMode),
        QuestMode::Recurring => require!(period_seconds > 0, ErrorCode::InvalidQuestMode),
    }
    if review_mode == ReviewMode::AutoVerified {
        require!(
            authorized_verifier != Pubkey::default(),
            ErrorCode::InvalidAuthorizedVerifier
        );
        require!(
            template_config_hash != [0; 32],
            ErrorCode::InvalidTemplateConfigHash
        );
        require!(
            !verification_schema_uri.is_empty(),
            ErrorCode::VerificationSchemaUriTooLong
        );
    }

    require!(
        initial_reward_funding >= MIN_FUNDING_AMOUNT,
        ErrorCode::InvalidFundingAmount
    );
    require!(
        initial_reward_funding % reward_per_completion == 0,
        ErrorCode::RewardFundingNotMultipleOfReward
    );
    require!(
        deposit_amount % reward_per_completion == 0,
        ErrorCode::DepositNotMultipleOfReward
    );

    let required_deposit = u64::from(queue_max)
        .checked_add(1)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_mul(reward_per_completion)
        .ok_or(ErrorCode::MathOverflow)?;
    require!(
        deposit_amount >= required_deposit,
        ErrorCode::InsufficientDeposit
    );

    let fee_amount = initial_reward_funding
        .checked_mul(PLATFORM_FEE_BPS)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(ErrorCode::MathOverflow)?;

    let now = Clock::get()?.unix_timestamp;
    let expires_at = now
        .checked_add(duration_seconds)
        .ok_or(ErrorCode::MathOverflow)?;
    require!(expires_at > now, ErrorCode::InvalidDeadlineExtension);

    let quest = &mut ctx.accounts.quest;
    quest.quest_id = quest_id;
    quest.publisher = ctx.accounts.publisher.key();
    quest.reviewer = reviewer;
    quest.mode = mode;
    quest.review_mode = review_mode;
    quest.verification_template = verification_template;
    quest.template_config_hash = template_config_hash;
    quest.authorized_verifier = authorized_verifier;
    quest.status = QuestStatus::Open;
    quest.reward_per_completion = reward_per_completion;
    quest.period_seconds = period_seconds;
    quest.start_at = now;
    quest.expires_at = expires_at;
    quest.close_requested_at = 0;
    quest.closing_reason = QuestCloseReason::None;
    quest.queue_max = queue_max;
    quest.pending_count = 0;
    quest.next_submission_index = 0;
    quest.next_review_index = 0;
    quest.total_submissions = 0;
    quest.total_approved = 0;
    quest.total_rejected = 0;
    quest.total_paid_amount = 0;
    quest.total_reward_funded = initial_reward_funding;
    quest.total_deposit_funded = deposit_amount;
    quest.total_fee_paid = fee_amount;
    quest.bump = ctx.bumps.quest;
    quest.reward_pool_bump = ctx.bumps.reward_pool;
    quest.deposit_pool_bump = ctx.bumps.deposit_pool;
    quest.metadata_uri = metadata_uri;
    quest.verification_schema_uri = verification_schema_uri;

    transfer_from_publisher(
        &ctx.accounts.publisher,
        ctx.accounts.reward_pool.to_account_info(),
        &ctx.accounts.system_program,
        initial_reward_funding,
    )?;
    transfer_from_publisher(
        &ctx.accounts.publisher,
        ctx.accounts.deposit_pool.to_account_info(),
        &ctx.accounts.system_program,
        deposit_amount,
    )?;
    ensure_rent_exempt_system_account(
        &ctx.accounts.publisher,
        ctx.accounts.fee_vault.to_account_info(),
        &ctx.accounts.system_program,
    )?;
    transfer_from_publisher(
        &ctx.accounts.publisher,
        ctx.accounts.fee_vault.to_account_info(),
        &ctx.accounts.system_program,
        fee_amount,
    )?;

    Ok(())
}

fn transfer_from_publisher<'info>(
    publisher: &Signer<'info>,
    to: AccountInfo<'info>,
    _system_program: &Program<'info, System>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: publisher.to_account_info(),
        to,
    };
    let cpi_context = CpiContext::new(anchor_lang::system_program::ID, cpi_accounts);
    anchor_lang::system_program::transfer(cpi_context, amount)
}

fn ensure_rent_exempt_system_account<'info>(
    publisher: &Signer<'info>,
    account: AccountInfo<'info>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    if account.lamports() > 0 {
        return Ok(());
    }

    let rent_lamports = Rent::get()?.minimum_balance(0);
    transfer_from_publisher(publisher, account, system_program, rent_lamports)
}
