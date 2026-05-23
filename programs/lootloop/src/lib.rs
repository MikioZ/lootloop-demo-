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
        crate::instructions::create_quest::create_quest_handler(
            ctx,
            quest_id,
            mode,
            review_mode,
            verification_template,
            template_config_hash,
            verification_schema_uri,
            authorized_verifier,
            metadata_uri,
            reviewer,
            reward_per_completion,
            initial_reward_funding,
            deposit_amount,
            duration_seconds,
            period_seconds,
            queue_max,
        )
    }

    pub fn submit_proof(ctx: Context<SubmitProof>, proof_uri: String) -> Result<()> {
        crate::instructions::submit_proof::submit_proof_handler(ctx, proof_uri)
    }

    pub fn approve_submission(ctx: Context<ApproveSubmission>) -> Result<()> {
        crate::instructions::approve_submission::approve_submission_handler(ctx)
    }

    pub fn auto_approve_submission(
        ctx: Context<AutoApproveSubmission>,
        external_proof_hash: [u8; 32],
        verification_result: VerificationResult,
    ) -> Result<()> {
        crate::instructions::approve_submission::auto_approve_submission_handler(
            ctx,
            external_proof_hash,
            verification_result,
        )
    }

    pub fn reject_submission(ctx: Context<RejectSubmission>) -> Result<()> {
        crate::instructions::reject_submission::reject_submission_handler(ctx)
    }

    pub fn fund_quest(
        ctx: Context<FundQuest>,
        reward_funding_amount: u64,
        additional_deposit_amount: u64,
        extend_duration_seconds: i64,
    ) -> Result<()> {
        crate::instructions::fund_quest::fund_quest_handler(
            ctx,
            reward_funding_amount,
            additional_deposit_amount,
            extend_duration_seconds,
        )
    }

    pub fn close_quest(ctx: Context<CloseQuest>) -> Result<()> {
        crate::instructions::close_quest::close_quest_handler(ctx)
    }

    pub fn settle_quest(ctx: Context<SettleQuest>) -> Result<()> {
        crate::instructions::settle_quest::settle_quest_handler(ctx)
    }
}
