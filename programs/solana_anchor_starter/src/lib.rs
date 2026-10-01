use anchor_lang::prelude::*;
use mpl_core::{
    instructions::CreateV1CpiBuilder,
    types::{Attribute, Attributes, Plugin, PluginAuthorityPair},
};

pub mod merkle;

declare_id!("7AnfhSTGK11PUqep6wdfkCcSuwhAsaU4RwYfDGdcWyfp");

pub const MAX_FAMILIES: usize = 16;
pub const MAX_URI_LENGTH: usize = 128;
pub const REBYTER_GENE_COUNT: usize = 14;
pub const CREATE_REBYTER_PRICE_LAMPORTS: u64 = 0;
pub const LOADER: Pubkey = pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");

#[program]
pub mod solana_anchor_starter {
    use super::*;

    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        // Upgradeable-loader ProgramData: enum tag, slot, Option<authority>.
        let data = ctx.accounts.program_data.try_borrow_data()?;
        require!(
            data.len() >= 45 && data[..4] == 3u32.to_le_bytes() && data[12] == 1,
            RegistryError::Bootstrap
        );
        require!(
            data[13..45] == ctx.accounts.authority.key().to_bytes(),
            RegistryError::Bootstrap
        );
        let root = &mut ctx.accounts.registry;
        root.authority = ctx.accounts.authority.key();
        root.next_evolution_id = 1;
        root.next_versions = [1; MAX_FAMILIES];
        Ok(())
    }

    pub fn reserve_evolution_ids(
        ctx: Context<Admin>,
        expected_next: u32,
        count: u16,
    ) -> Result<()> {
        let root = &mut ctx.accounts.registry;
        require!(
            count > 0 && expected_next == root.next_evolution_id,
            RegistryError::Stale
        );
        let end = expected_next
            .checked_add(u32::from(count))
            .ok_or(RegistryError::Exhausted)?;
        require!(end <= 65536, RegistryError::Exhausted);
        root.next_evolution_id = end;
        emit!(IdsReserved {
            start: expected_next,
            count
        });
        Ok(())
    }

    pub fn create_tree(
        ctx: Context<CreateTree>,
        family_id: u8,
        version: u32,
        merkle_root: [u8; 32],
        content_hash: [u8; 32],
        uri: String,
    ) -> Result<()> {
        let family = family_index(family_id)?;
        let root = &mut ctx.accounts.registry;
        require!(
            version != 0 && version == root.next_versions[family],
            RegistryError::Version
        );
        require!(
            !uri.is_empty()
                && uri.len() <= MAX_URI_LENGTH
                && uri.starts_with("https://")
                && !uri.chars().any(char::is_control),
            RegistryError::Uri
        );
        require!(
            merkle_root != [0; 32] && content_hash != [0; 32],
            RegistryError::Hash
        );
        root.next_versions[family] = version.checked_add(1).ok_or(RegistryError::Exhausted)?;
        let tree = &mut ctx.accounts.tree;
        tree.family_id = family_id;
        tree.version = version;
        tree.merkle_root = merkle_root;
        tree.content_hash = content_hash;
        tree.uri_len = uri.len() as u16;
        tree.uri[..uri.len()].copy_from_slice(uri.as_bytes());
        tree.created_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn activate_tree(ctx: Context<ManageTree>, family_id: u8, version: u32) -> Result<()> {
        let family = family_index(family_id)?;
        require!(
            ctx.accounts.tree.family_id == family_id && ctx.accounts.tree.version == version,
            RegistryError::Version
        );
        ctx.accounts.registry.active_versions[family] = version;
        Ok(())
    }

    pub fn close_tree(ctx: Context<CloseTree>, family_id: u8, version: u32) -> Result<()> {
        let family = family_index(family_id)?;
        require!(
            ctx.accounts.tree.family_id == family_id && ctx.accounts.tree.version == version,
            RegistryError::Version
        );
        require!(
            ctx.accounts.registry.active_versions[family] != version,
            RegistryError::Active
        );
        Ok(())
    }

    pub fn set_authority(ctx: Context<Admin>, new_authority: Pubkey) -> Result<()> {
        require!(new_authority != Pubkey::default(), RegistryError::Authority);
        ctx.accounts.registry.authority = new_authority;
        Ok(())
    }

    /// Creates one Metaplex Core Asset whose complete Rebyter state lives
    /// in a single on-chain Attributes plugin field named DNA.
    ///
    /// The Core Asset is the Rebyter. There is no mint account and no ATA.
    /// A PDA address is used only as update authority; no account is created
    /// at that PDA and no state is stored there.
    pub fn create_rebyter(
        ctx: Context<CreateRebyter>,
        family_id: u8,
        tree_version: u32,
        evolution_id: u32,
        evolution_leaf_hash: [u8; 32],
        proof: Vec<[u8; 32]>,
        name: String,
        metadata_uri: String,
    ) -> Result<()> {
        let family = family_index(family_id)?;
        require!(family_id == 0, RegistryError::FamilyLocked);
        require!(
            ctx.accounts.registry.active_versions[family] == tree_version
                && ctx.accounts.tree.family_id == family_id
                && ctx.accounts.tree.version == tree_version,
            RegistryError::InactiveTree
        );
        require!(
            merkle::verify_evolution_hash_proof(
                evolution_leaf_hash,
                &proof,
                &ctx.accounts.tree.merkle_root,
            ),
            RegistryError::InvalidEvolutionProof
        );
        require!(
            !name.is_empty() && name.len() <= 32 && !name.chars().any(char::is_control),
            RegistryError::InvalidMetadata
        );
        require!(
            !metadata_uri.is_empty()
                && metadata_uri.len() <= MAX_URI_LENGTH
                && metadata_uri.starts_with("https://")
                && !metadata_uri.chars().any(char::is_control),
            RegistryError::InvalidMetadata
        );

        let clock = Clock::get()?;
        let owner_key = ctx.accounts.owner.key();
        let asset_key = ctx.accounts.asset.key();
        let genome_seed = solana_sha256_hasher::hashv(&[
            b"rebyter-dna-v1",
            owner_key.as_ref(),
            asset_key.as_ref(),
            &clock.slot.to_le_bytes(),
            &clock.unix_timestamp.to_le_bytes(),
        ])
        .to_bytes();

        // Permanent gene order:
        // activity, sociability, independence, nocturnal, carnivore, herbivore,
        // piscivore, frugivore, size, strength, speed, resilience, mutation, rarity.
        let mut genes = [0u8; REBYTER_GENE_COUNT];
        for (index, gene) in genes.iter_mut().enumerate() {
            *gene = genome_seed[index] % 101;
        }

        let dna_blob = pack_rebyter_dna_v1(
            family_id,
            0,
            tree_version,
            evolution_id,
            &evolution_leaf_hash,
            &genome_seed,
            &genes,
            10,
            0,
            0,
            100,
            100,
            [0; 4],
            [0; 4],
            0,
            0,
            clock.unix_timestamp,
            clock.unix_timestamp,
        );
        let dna_base58 = bs58::encode(dna_blob).into_string();

        let plugins = vec![PluginAuthorityPair {
            plugin: Plugin::Attributes(Attributes {
                attribute_list: vec![Attribute {
                    key: "DNA".to_string(),
                    value: dna_base58,
                }],
            }),
            authority: None,
        }];

        let mut create = CreateV1CpiBuilder::new(&ctx.accounts.core_program.to_account_info());
        create
            .asset(&ctx.accounts.asset.to_account_info())
            .authority(Some(&ctx.accounts.owner.to_account_info()))
            .payer(&ctx.accounts.owner.to_account_info())
            .owner(Some(&ctx.accounts.owner.to_account_info()))
            .update_authority(Some(&ctx.accounts.rebyter_authority.to_account_info()))
            .system_program(&ctx.accounts.system_program.to_account_info())
            .name(name)
            .uri(metadata_uri)
            .plugins(plugins);
        create.invoke()?;

        emit!(RebyterCreated {
            owner: owner_key,
            asset: asset_key,
            family_id,
            evolution_id,
        });

        Ok(())
    }
}

fn pack_rebyter_dna_v1(
    family_id: u8,
    stage: u8,
    tree_version: u32,
    evolution_id: u32,
    evolution_leaf_hash: &[u8; 32],
    genome_seed: &[u8; 32],
    genes: &[u8; REBYTER_GENE_COUNT],
    weight: u16,
    bond: u16,
    activity: u32,
    hunger: u16,
    energy: u16,
    diet: [u16; 4],
    time_interactions: [u16; 4],
    total_interactions: u32,
    cycle: u16,
    last_interaction: i64,
    created_at: i64,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(128);
    out.push(1);
    out.push(family_id);
    out.push(stage);
    out.extend_from_slice(&tree_version.to_le_bytes());
    out.extend_from_slice(&evolution_id.to_le_bytes());
    out.extend_from_slice(evolution_leaf_hash);
    out.extend_from_slice(genome_seed);
    out.extend_from_slice(genes);
    out.extend_from_slice(&weight.to_le_bytes());
    out.extend_from_slice(&bond.to_le_bytes());
    out.extend_from_slice(&activity.to_le_bytes());
    out.extend_from_slice(&hunger.to_le_bytes());
    out.extend_from_slice(&energy.to_le_bytes());
    for value in diet {
        out.extend_from_slice(&value.to_le_bytes());
    }
    for value in time_interactions {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out.extend_from_slice(&total_interactions.to_le_bytes());
    out.extend_from_slice(&cycle.to_le_bytes());
    out.extend_from_slice(&last_interaction.to_le_bytes());
    out.extend_from_slice(&created_at.to_le_bytes());
    out
}

fn family_index(id: u8) -> Result<usize> {
    require!(id < 8, RegistryError::Family);
    Ok(usize::from(id))
}

#[account]
#[derive(InitSpace)]
pub struct RegistryRoot {
    pub authority: Pubkey,
    pub next_evolution_id: u32,
    pub active_versions: [u32; MAX_FAMILIES],
    pub next_versions: [u32; MAX_FAMILIES],
}

#[account]
#[derive(InitSpace)]
pub struct EvolutionTree {
    pub family_id: u8,
    pub version: u32,
    pub merkle_root: [u8; 32],
    pub content_hash: [u8; 32],
    pub uri_len: u16,
    pub uri: [u8; MAX_URI_LENGTH],
    pub created_at: i64,
}


#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + RegistryRoot::INIT_SPACE, seeds = [b"registry"], bump)]
    pub registry: Account<'info, RegistryRoot>,
    /// CHECK: PDA and loader ownership verified here; loader state and authority checked in handler.
    #[account(owner = LOADER, address = Pubkey::find_program_address(&[crate::ID.as_ref()], &LOADER).0)]
    pub program_data: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Admin<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"registry"], bump, has_one = authority)]
    pub registry: Account<'info, RegistryRoot>,
}

#[derive(Accounts)]
#[instruction(family_id: u8, version: u32)]
pub struct CreateTree<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"registry"], bump, has_one = authority)]
    pub registry: Account<'info, RegistryRoot>,
    #[account(init, payer = authority, space = 8 + EvolutionTree::INIT_SPACE, seeds = [b"tree".as_ref(), &[family_id], &version.to_le_bytes()], bump)]
    pub tree: Account<'info, EvolutionTree>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(family_id: u8, version: u32)]
pub struct ManageTree<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"registry"], bump, has_one = authority)]
    pub registry: Account<'info, RegistryRoot>,
    #[account(seeds = [b"tree", &[family_id], &version.to_le_bytes()], bump)]
    pub tree: Account<'info, EvolutionTree>,
}

#[derive(Accounts)]
#[instruction(family_id: u8, version: u32)]
pub struct CloseTree<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"registry"], bump, has_one = authority)]
    pub registry: Account<'info, RegistryRoot>,
    #[account(mut, close = authority, seeds = [b"tree", &[family_id], &version.to_le_bytes()], bump)]
    pub tree: Account<'info, EvolutionTree>,
}

#[derive(Accounts)]
#[instruction(family_id: u8, tree_version: u32)]
pub struct CreateRebyter<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"registry"], bump)]
    pub registry: Account<'info, RegistryRoot>,
    #[account(
        seeds = [b"tree", &[family_id], &tree_version.to_le_bytes()],
        bump
    )]
    pub tree: Account<'info, EvolutionTree>,
    /// CHECK: PDA address only. No account is created here; Core stores all
    /// Rebyter data in the Asset account and uses this address as update authority.
    #[account(
        seeds = [b"rebyter_authority", asset.key().as_ref()],
        bump
    )]
    pub rebyter_authority: UncheckedAccount<'info>,
    /// The Core Asset keypair signs creation. The account is created by MPL Core.
    #[account(mut)]
    pub asset: Signer<'info>,
    /// CHECK: constrained to the canonical MPL Core program id.
    #[account(address = mpl_core::ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct IdsReserved {
    pub start: u32,
    pub count: u16,
}

#[event]
pub struct RebyterCreated {
    pub owner: Pubkey,
    pub asset: Pubkey,
    pub family_id: u8,
    pub evolution_id: u32,
}

#[error_code]
pub enum RegistryError {
    #[msg("Only the deployed program upgrade authority can initialize")]
    Bootstrap,
    #[msg("Family is invalid or reserved")]
    Family,
    #[msg("Version must be the next unused version")]
    Version,
    #[msg("URI must be HTTPS and at most 128 UTF-8 bytes")]
    Uri,
    #[msg("Hash must not be zero")]
    Hash,
    #[msg("Cannot close the active tree")]
    Active,
    #[msg("Counter exhausted")]
    Exhausted,
    #[msg("Allocation changed; refresh registry")]
    Stale,
    #[msg("Invalid authority")]
    Authority,
    #[msg("This Rebyter family is not open for creation yet")]
    FamilyLocked,
    #[msg("The requested evolution tree is not the active family tree")]
    InactiveTree,
    #[msg("The BIT reference could not be verified against the active atlas")]
    InvalidEvolutionProof,
    #[msg("Rebyter metadata is invalid")]
    InvalidMetadata,
}
