pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("CQmvWxzKoxVrVQq798qY1tm699ivLJcvC5XWw8o4DTUj");

#[program]
pub mod lootloop {
    use super::*;

    pub fn create_quest(
        ctx: Context<CreateQuest>,
        quest_id: u64,
        metadata_uri: String,
        reviewer: Pubkey,
        reward_amount: u64,
        duration_seconds: u64,
    ) -> Result<()> {
        crate::instructions::create_quest::create_quest_handler(
            ctx,
            quest_id,
            metadata_uri,
            reviewer,
            reward_amount,
            duration_seconds,
        )
    }

    pub fn submit_proof(ctx: Context<SubmitProof>, proof_uri: String) -> Result<()> {
        crate::instructions::submit_proof::submit_proof_handler(ctx, proof_uri)
    }

    pub fn approve_submission(ctx: Context<ApproveSubmission>) -> Result<()> {
        crate::instructions::approve_submission::approve_submission_handler(ctx)
    }

    pub fn claim_reward(ctx: Context<ClaimReward>) -> Result<()> {
        crate::instructions::claim_reward::claim_reward_handler(ctx)
    }

    pub fn top_up_quest(
        ctx: Context<TopUpQuest>,
        top_up_amount: u64,
        extend_duration_seconds: u64,
    ) -> Result<()> {
        crate::instructions::top_up_quest::top_up_quest_handler(
            ctx,
            top_up_amount,
            extend_duration_seconds,
        )
    }

    pub fn cancel_quest(ctx: Context<CancelQuest>) -> Result<()> {
        crate::instructions::cancel_quest::cancel_quest_handler(ctx)
    }
}
