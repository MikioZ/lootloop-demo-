use anchor_lang::prelude::*;

use crate::{
    error::ErrorCode, Quest, QuestStatus, BPS_DENOMINATOR, DEPOSIT_POOL_SEED, FEE_VAULT_SEED,
    MIN_FUNDING_AMOUNT, PLATFORM_FEE_BPS, REWARD_POOL_SEED,
};

#[derive(Accounts)]
pub struct FundQuest<'info> {
    #[account(mut)]
    pub quest: Account<'info, Quest>,

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

    /// CHECK: Global fee PDA stores lamports only.
    #[account(mut, seeds = [FEE_VAULT_SEED], bump)]
    pub fee_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub publisher: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn fund_quest_handler(
    ctx: Context<FundQuest>,
    reward_funding_amount: u64,
    additional_deposit_amount: u64,
    extend_duration_seconds: i64,
) -> Result<()> {
    let quest = &mut ctx.accounts.quest;

    require!(
        ctx.accounts.publisher.key() == quest.publisher,
        ErrorCode::Unauthorized
    );
    require!(
        quest.status == QuestStatus::Open,
        ErrorCode::InvalidQuestStatus
    );
    require!(
        extend_duration_seconds >= 0,
        ErrorCode::InvalidDeadlineExtension
    );

    if reward_funding_amount > 0 {
        require!(
            reward_funding_amount >= MIN_FUNDING_AMOUNT,
            ErrorCode::InvalidFundingAmount
        );
        require!(
            reward_funding_amount % quest.reward_per_completion == 0,
            ErrorCode::RewardFundingNotMultipleOfReward
        );
        let fee_amount = reward_funding_amount
            .checked_mul(PLATFORM_FEE_BPS)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(ErrorCode::MathOverflow)?;

        transfer_from_publisher(
            &ctx.accounts.publisher,
            ctx.accounts.reward_pool.to_account_info(),
            &ctx.accounts.system_program,
            reward_funding_amount,
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

        quest.total_reward_funded = quest
            .total_reward_funded
            .checked_add(reward_funding_amount)
            .ok_or(ErrorCode::MathOverflow)?;
        quest.total_fee_paid = quest
            .total_fee_paid
            .checked_add(fee_amount)
            .ok_or(ErrorCode::MathOverflow)?;
    }

    if additional_deposit_amount > 0 {
        require!(
            additional_deposit_amount % quest.reward_per_completion == 0,
            ErrorCode::DepositNotMultipleOfReward
        );
        transfer_from_publisher(
            &ctx.accounts.publisher,
            ctx.accounts.deposit_pool.to_account_info(),
            &ctx.accounts.system_program,
            additional_deposit_amount,
        )?;
        quest.total_deposit_funded = quest
            .total_deposit_funded
            .checked_add(additional_deposit_amount)
            .ok_or(ErrorCode::MathOverflow)?;
    }

    if extend_duration_seconds > 0 {
        quest.expires_at = quest
            .expires_at
            .checked_add(extend_duration_seconds)
            .ok_or(ErrorCode::MathOverflow)?;
    }

    Ok(())
}

fn transfer_from_publisher<'info>(
    publisher: &Signer<'info>,
    to: AccountInfo<'info>,
    _system_program: &Program<'info, System>,
    amount: u64,
) -> Result<()> {
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
