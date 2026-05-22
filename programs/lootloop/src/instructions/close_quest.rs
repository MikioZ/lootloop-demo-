use anchor_lang::prelude::*;

use crate::{
    error::ErrorCode, Quest, QuestCloseReason, QuestStatus, BPS_DENOMINATOR, CANCELLATION_FEE_BPS,
    DEPOSIT_POOL_SEED, FEE_VAULT_SEED, PUBLIC_GOODS_POOL_SEED, REWARD_POOL_SEED,
};

#[derive(Accounts)]
pub struct CloseQuest<'info> {
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

    /// CHECK: Global public goods PDA stores lamports only.
    #[account(mut, seeds = [PUBLIC_GOODS_POOL_SEED], bump)]
    pub public_goods_pool: UncheckedAccount<'info>,

    #[account(mut)]
    pub publisher: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn close_quest_handler(ctx: Context<CloseQuest>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let quest = &mut ctx.accounts.quest;

    require!(
        ctx.accounts.publisher.key() == quest.publisher,
        ErrorCode::Unauthorized
    );
    require!(
        quest.status == QuestStatus::Open,
        ErrorCode::InvalidQuestStatus
    );

    quest.status = QuestStatus::Closing;
    quest.close_requested_at = now;
    quest.closing_reason = if now >= quest.expires_at {
        QuestCloseReason::Expired
    } else {
        QuestCloseReason::EarlyManual
    };

    if quest.pending_count == 0 {
        settle_pools(
            quest,
            ctx.accounts.reward_pool.to_account_info(),
            ctx.accounts.deposit_pool.to_account_info(),
            ctx.accounts.publisher.to_account_info(),
            ctx.accounts.fee_vault.to_account_info(),
            ctx.accounts.public_goods_pool.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        )?;
    }

    Ok(())
}

fn settle_pools<'info>(
    quest: &mut Account<'info, Quest>,
    reward_pool: AccountInfo<'info>,
    deposit_pool: AccountInfo<'info>,
    publisher: AccountInfo<'info>,
    fee_vault: AccountInfo<'info>,
    public_goods_pool: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
) -> Result<()> {
    let quest_key = quest.key();
    let reward_bump = [quest.reward_pool_bump];
    let deposit_bump = [quest.deposit_pool_bump];

    match quest.closing_reason {
        QuestCloseReason::Expired => {
            transfer_all_from_pool(
                reward_pool,
                publisher.clone(),
                system_program.clone(),
                &[REWARD_POOL_SEED, quest_key.as_ref(), &reward_bump],
            )?;
            transfer_all_from_pool(
                deposit_pool,
                publisher,
                system_program,
                &[DEPOSIT_POOL_SEED, quest_key.as_ref(), &deposit_bump],
            )?;
        }
        QuestCloseReason::EarlyManual | QuestCloseReason::RewardPoolDepleted => {
            transfer_all_from_pool(
                reward_pool,
                public_goods_pool.clone(),
                system_program.clone(),
                &[REWARD_POOL_SEED, quest_key.as_ref(), &reward_bump],
            )?;

            let deposit_amount = deposit_pool.lamports();
            let cancellation_fee = deposit_amount
                .checked_mul(CANCELLATION_FEE_BPS)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(BPS_DENOMINATOR)
                .ok_or(ErrorCode::MathOverflow)?;
            let public_goods_amount = deposit_amount
                .checked_sub(cancellation_fee)
                .ok_or(ErrorCode::MathOverflow)?;

            if cancellation_fee > 0 {
                transfer_from_pool(
                    deposit_pool.clone(),
                    fee_vault,
                    system_program.clone(),
                    &[DEPOSIT_POOL_SEED, quest_key.as_ref(), &deposit_bump],
                    cancellation_fee,
                )?;
            }
            if public_goods_amount > 0 {
                transfer_from_pool(
                    deposit_pool,
                    public_goods_pool,
                    system_program,
                    &[DEPOSIT_POOL_SEED, quest_key.as_ref(), &deposit_bump],
                    public_goods_amount,
                )?;
            }
        }
        QuestCloseReason::None => return err!(ErrorCode::InvalidQuestStatus),
    }

    quest.status = QuestStatus::Closed;
    Ok(())
}

fn transfer_all_from_pool<'info>(
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    let amount = from.lamports();
    if amount == 0 {
        return Ok(());
    }

    transfer_from_pool(from, to, system_program, signer_seeds, amount)
}

fn transfer_from_pool<'info>(
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    _system_program: AccountInfo<'info>,
    signer_seeds: &[&[u8]],
    amount: u64,
) -> Result<()> {
    let cpi_accounts = anchor_lang::system_program::Transfer { from, to };
    let signer_seeds: &[&[&[u8]]] = &[signer_seeds];
    let cpi_context =
        CpiContext::new_with_signer(anchor_lang::system_program::ID, cpi_accounts, signer_seeds);
    anchor_lang::system_program::transfer(cpi_context, amount)
}
