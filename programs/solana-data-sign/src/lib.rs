use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod solana_data_sign {
    use super::*;

    /// Initialize a new data signature account
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let data_signature = &mut ctx.accounts.data_signature;
        data_signature.authority = ctx.accounts.authority.key();
        data_signature.signature_count = 0;
        Ok(())
    }

    /// Store a data signature on-chain
    pub fn store_signature(
        ctx: Context<StoreSignature>,
        data_hash: [u8; 32],
        signature: [u8; 64],
        timestamp: i64,
    ) -> Result<()> {
        let data_signature = &mut ctx.accounts.data_signature;
        let signature_record = &mut ctx.accounts.signature_record;

        // Verify the authority
        require!(
            data_signature.authority == ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );

        // Store the signature record
        signature_record.data_hash = data_hash;
        signature_record.signature = signature;
        signature_record.timestamp = timestamp;
        signature_record.signer = ctx.accounts.authority.key();
        signature_record.index = data_signature.signature_count;

        // Increment the signature count
        data_signature.signature_count += 1;

        Ok(())
    }

    /// Verify a stored signature
    pub fn verify_signature(
        ctx: Context<VerifySignature>,
        data_hash: [u8; 32],
    ) -> Result<bool> {
        let signature_record = &ctx.accounts.signature_record;

        // Check if the data hash matches
        Ok(signature_record.data_hash == data_hash)
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + DataSignature::INIT_SPACE
    )]
    pub data_signature: Account<'info, DataSignature>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StoreSignature<'info> {
    #[account(mut)]
    pub data_signature: Account<'info, DataSignature>,
    #[account(
        init,
        payer = authority,
        space = 8 + SignatureRecord::INIT_SPACE,
        seeds = [
            b"signature",
            data_signature.key().as_ref(),
            &data_signature.signature_count.to_le_bytes()
        ],
        bump
    )]
    pub signature_record: Account<'info, SignatureRecord>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifySignature<'info> {
    pub signature_record: Account<'info, SignatureRecord>,
}

#[account]
#[derive(InitSpace)]
pub struct DataSignature {
    pub authority: Pubkey,
    pub signature_count: u64,
}

#[account]
#[derive(InitSpace)]
pub struct SignatureRecord {
    pub data_hash: [u8; 32],
    pub signature: [u8; 64],
    pub timestamp: i64,
    pub signer: Pubkey,
    pub index: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized: Only the authority can perform this action")]
    Unauthorized,
}
