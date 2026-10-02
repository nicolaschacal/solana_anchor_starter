use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::{
    token_2022::{
        spl_token_2022::{
            extension::{BaseStateWithExtensions, PodStateWithExtensions},
            instruction::AuthorityType,
            pod::PodMint,
        },
        SetAuthority,
    },
    token_2022_extensions::{
        spl_token_metadata_interface::state::{Field, TokenMetadata},
        token_metadata::{token_metadata_update_field, TokenMetadataUpdateField},
    },
    token_interface::{
        mint_to, token_metadata_initialize, MintTo, Token2022, TokenAccount,
        TokenMetadataInitialize,
    },
};

pub mod merkle;

declare_id!("7AnfhSTGK11PUqep6wdfkCcSuwhAsaU4RwYfDGdcWyfp");

pub const MAX_FAMILIES: usize = 16;
pub const MAX_URI_LENGTH: usize = 128;
pub const REBYTER_GENE_COUNT: usize = 14;
pub const REBYTER_DNA_V2_BYTES: usize = 62;
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

    /// Creates a 1/1 Token-2022 Rebyter whose complete persistent game
    /// state lives inside the mint account's TokenMetadata extension.
    ///
    /// No per-Rebyter PDA account is created. The only asset/state account is
    /// the mint itself, matching Rebyters' single-account design.
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
        let mint_key = ctx.accounts.mint.key();
        let dna = solana_sha256_hasher::hashv(&[
            b"rebyter-dna-v2",
            owner_key.as_ref(),
            mint_key.as_ref(),
            &clock.slot.to_le_bytes(),
            &clock.unix_timestamp.to_le_bytes(),
        ])
        .to_bytes();

        // Permanent gene order:
        // activity, sociability, independence, nocturnal, carnivore, herbivore,
        // piscivore, frugivore, size, strength, speed, resilience, mutation, rarity.
        let mut genes = [0u8; REBYTER_GENE_COUNT];
        for (index, gene) in genes.iter_mut().enumerate() {
            *gene = dna[index] % 101;
        }

        // The only custom TokenMetadata field is DNA.
        // DNA is a base58-encoded binary blob containing both immutable genes
        // and mutable gameplay state. Its first byte versions the layout.
        require!(tree_version <= u16::MAX as u32, RegistryError::Version);
        require!(evolution_id <= u16::MAX as u32, RegistryError::Exhausted);

        // DNA v2 stores only information that cannot be reconstructed from the
        // atlas. The creation hash is used as entropy, but is deliberately not
        // stored: the 14 resulting genes are the permanent genetics.
        let hp = 100u16 + u16::from(genes[11]) * 2;
        let atk = 20u16 + u16::from(genes[9]);
        let def = 20u16 + u16::from(genes[11]);
        let spd = 20u16 + u16::from(genes[10]);
        let dna_blob = pack_rebyter_dna_v2(
            family_id,
            0,
            tree_version as u16,
            evolution_id as u16,
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
            hp,
            atk,
            def,
            spd,
            clock.unix_timestamp as u32,
            clock.unix_timestamp as u32,
        );
        let additional_metadata = vec![
            ("DNA".to_string(), bs58::encode(dna_blob).into_string()),
        ];

        // Pre-fund the mint for the complete final TLV metadata size before
        // Token-2022 reallocates it while adding the custom fields.
        let final_metadata = TokenMetadata {
            name: name.clone(),
            symbol: "RBYT".to_string(),
            uri: metadata_uri.clone(),
            additional_metadata: additional_metadata.clone(),
            ..Default::default()
        };
        let metadata_lamports = Rent::get()?.minimum_balance(final_metadata.tlv_size_of()?);
        if metadata_lamports > 0 {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    Transfer {
                        from: ctx.accounts.owner.to_account_info(),
                        to: ctx.accounts.mint.to_account_info(),
                    },
                ),
                metadata_lamports,
            )?;
        }

        let bump = ctx.bumps.rebyter_authority;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"rebyter_authority",
            mint_key.as_ref(),
            &[bump],
        ]];

        token_metadata_initialize(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TokenMetadataInitialize {
                    program_id: ctx.accounts.token_program.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    metadata: ctx.accounts.mint.to_account_info(),
                    mint_authority: ctx.accounts.rebyter_authority.to_account_info(),
                    update_authority: ctx.accounts.rebyter_authority.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            name,
            "RBYT".to_string(),
            metadata_uri,
        )?;

        for (key, value) in additional_metadata {
            token_metadata_update_field(
                CpiContext::new(
                    ctx.accounts.token_program.key(),
                    TokenMetadataUpdateField {
                        program_id: ctx.accounts.token_program.to_account_info(),
                        metadata: ctx.accounts.mint.to_account_info(),
                        update_authority: ctx.accounts.rebyter_authority.to_account_info(),
                    },
                )
                .with_signer(signer_seeds),
                Field::Key(key),
                value,
            )?;
        }

        mint_to(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.rebyter_authority.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            1,
        )?;

        // A Rebyter is permanently 1/1. Gameplay remains mutable through the
        // TokenMetadata update authority, but no additional supply can exist.
        anchor_spl::token_2022::set_authority(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SetAuthority {
                    current_authority: ctx.accounts.rebyter_authority.to_account_info(),
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            AuthorityType::MintTokens,
            None,
        )?;

        emit!(RebyterCreated {
            owner: owner_key,
            mint: mint_key,
            family_id,
            evolution_id,
        });

        Ok(())
    }

    /// Feed with one of four food groups: 0 meat, 1 plant, 2 fish, 3 fruit.
    pub fn feed(ctx: Context<InteractRebyter>, food_type: u8) -> Result<()> {
        require!(food_type < 4, RegistryError::InvalidFood);
        apply_interaction(&ctx.accounts, InteractionKind::Feed(food_type))
    }

    /// Play increases activity and bond while consuming energy/fullness.
    pub fn play(ctx: Context<InteractRebyter>) -> Result<()> {
        apply_interaction(&ctx.accounts, InteractionKind::Play)
    }

    /// Care focuses on bond and restores a small amount of energy.
    pub fn care(ctx: Context<InteractRebyter>) -> Result<()> {
        apply_interaction(&ctx.accounts, InteractionKind::Care)
    }
}

#[derive(Clone, Copy)]
enum InteractionKind {
    Feed(u8),
    Play,
    Care,
}

#[derive(Clone)]
struct RebyterDnaV2 {
    family_id: u8,
    stage: u8,
    tree_version: u16,
    evolution_id: u16,
    genes: [u8; REBYTER_GENE_COUNT],
    weight: u8,
    bond: u8,
    activity: u16,
    hunger: u8,
    energy: u8,
    diet: [u16; 4],
    time_interactions: [u16; 4],
    total_interactions: u16,
    cycle: u8,
    hp: u16,
    atk: u16,
    def: u16,
    spd: u16,
    last_interaction: u32,
    created_at: u32,
}

impl RebyterDnaV2 {
    fn decode(bytes: &[u8]) -> Result<Self> {
        require!(
            bytes.len() == REBYTER_DNA_V2_BYTES && bytes[0] == 2,
            RegistryError::UnsupportedDna
        );
        let mut o = 1usize;
        let take_u8 = |data: &[u8], offset: &mut usize| -> u8 {
            let value = data[*offset];
            *offset += 1;
            value
        };
        let take_u16 = |data: &[u8], offset: &mut usize| -> u16 {
            let value = u16::from_le_bytes([data[*offset], data[*offset + 1]]);
            *offset += 2;
            value
        };
        let take_u32 = |data: &[u8], offset: &mut usize| -> u32 {
            let value = u32::from_le_bytes([
                data[*offset],
                data[*offset + 1],
                data[*offset + 2],
                data[*offset + 3],
            ]);
            *offset += 4;
            value
        };

        let family_id = take_u8(bytes, &mut o);
        let stage = take_u8(bytes, &mut o);
        let tree_version = take_u16(bytes, &mut o);
        let evolution_id = take_u16(bytes, &mut o);
        let mut genes = [0u8; REBYTER_GENE_COUNT];
        genes.copy_from_slice(&bytes[o..o + REBYTER_GENE_COUNT]);
        o += REBYTER_GENE_COUNT;
        let weight = take_u8(bytes, &mut o);
        let bond = take_u8(bytes, &mut o);
        let activity = take_u16(bytes, &mut o);
        let hunger = take_u8(bytes, &mut o);
        let energy = take_u8(bytes, &mut o);
        let mut diet = [0u16; 4];
        for value in diet.iter_mut() {
            *value = take_u16(bytes, &mut o);
        }
        let mut time_interactions = [0u16; 4];
        for value in time_interactions.iter_mut() {
            *value = take_u16(bytes, &mut o);
        }
        let total_interactions = take_u16(bytes, &mut o);
        let cycle = take_u8(bytes, &mut o);
        let hp = take_u16(bytes, &mut o);
        let atk = take_u16(bytes, &mut o);
        let def = take_u16(bytes, &mut o);
        let spd = take_u16(bytes, &mut o);
        let last_interaction = take_u32(bytes, &mut o);
        let created_at = take_u32(bytes, &mut o);

        Ok(Self {
            family_id, stage, tree_version, evolution_id, genes, weight, bond,
            activity, hunger, energy, diet, time_interactions,
            total_interactions, cycle, hp, atk, def, spd,
            last_interaction, created_at,
        })
    }

    fn encode(&self) -> Vec<u8> {
        pack_rebyter_dna_v2(
            self.family_id,
            self.stage,
            self.tree_version,
            self.evolution_id,
            &self.genes,
            self.weight,
            self.bond,
            self.activity,
            self.hunger,
            self.energy,
            self.diet,
            self.time_interactions,
            self.total_interactions,
            self.cycle,
            self.hp,
            self.atk,
            self.def,
            self.spd,
            self.last_interaction,
            self.created_at,
        )
    }
}

fn utc_time_bucket(unix_timestamp: i64) -> usize {
    let hour = (unix_timestamp.rem_euclid(86_400) / 3_600) as u8;
    match hour {
        0..=5 => 0,   // dawn / madrugada
        6..=11 => 1,  // morning
        12..=17 => 2, // afternoon
        _ => 3,       // night
    }
}

fn read_rebyter_dna(mint: &AccountInfo<'_>) -> Result<RebyterDnaV2> {
    let data = mint.try_borrow_data()?;
    let mint_state = PodStateWithExtensions::<PodMint>::unpack(&data)
        .map_err(|_| error!(RegistryError::InvalidMetadata))?;
    let metadata = mint_state
        .get_variable_len_extension::<TokenMetadata>()
        .map_err(|_| error!(RegistryError::InvalidMetadata))?;
    let dna_base58 = metadata
        .additional_metadata
        .iter()
        .find(|(key, _)| key == "DNA")
        .map(|(_, value)| value)
        .ok_or_else(|| error!(RegistryError::UnsupportedDna))?;
    let bytes = bs58::decode(dna_base58)
        .into_vec()
        .map_err(|_| error!(RegistryError::UnsupportedDna))?;
    RebyterDnaV2::decode(&bytes)
}

fn apply_interaction(accounts: &InteractRebyter<'_>, kind: InteractionKind) -> Result<()> {
    let mut dna = read_rebyter_dna(&accounts.mint.to_account_info())?;
    let clock = Clock::get()?;

    match kind {
        InteractionKind::Feed(food_type) => {
            let i = usize::from(food_type);
            dna.diet[i] = dna.diet[i].saturating_add(1);
            dna.weight = dna.weight.saturating_add(1);
            dna.hunger = dna.hunger.saturating_add(20).min(100);
            dna.energy = dna.energy.saturating_add(4).min(100);
            dna.bond = dna.bond.saturating_add(1).min(100);
        }
        InteractionKind::Play => {
            dna.activity = dna.activity.saturating_add(10);
            dna.bond = dna.bond.saturating_add(3).min(100);
            dna.energy = dna.energy.saturating_sub(10);
            dna.hunger = dna.hunger.saturating_sub(5);
        }
        InteractionKind::Care => {
            dna.bond = dna.bond.saturating_add(5).min(100);
            dna.energy = dna.energy.saturating_add(6).min(100);
        }
    }

    let bucket = utc_time_bucket(clock.unix_timestamp);
    dna.time_interactions[bucket] = dna.time_interactions[bucket].saturating_add(1);
    dna.total_interactions = dna.total_interactions.saturating_add(1);
    dna.last_interaction = clock.unix_timestamp.max(0) as u32;

    let dna_base58 = bs58::encode(dna.encode()).into_string();
    let mint_key = accounts.mint.key();
    let (_, bump) = Pubkey::find_program_address(
        &[b"rebyter_authority", mint_key.as_ref()],
        &crate::ID,
    );
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"rebyter_authority",
        mint_key.as_ref(),
        &[bump],
    ]];

    token_metadata_update_field(
        CpiContext::new(
            accounts.token_program.key(),
            TokenMetadataUpdateField {
                program_id: accounts.token_program.to_account_info(),
                metadata: accounts.mint.to_account_info(),
                update_authority: accounts.rebyter_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        Field::Key("DNA".to_string()),
        dna_base58,
    )?;

    emit!(RebyterInteraction {
        owner: accounts.owner.key(),
        mint: mint_key,
        action: match kind {
            InteractionKind::Feed(_) => 0,
            InteractionKind::Play => 1,
            InteractionKind::Care => 2,
        },
        time_bucket: bucket as u8,
        total_interactions: dna.total_interactions,
    });

    Ok(())
}

fn pack_rebyter_dna_v2(
    family_id: u8,
    stage: u8,
    tree_version: u16,
    evolution_id: u16,
    genes: &[u8; REBYTER_GENE_COUNT],
    weight: u8,
    bond: u8,
    activity: u16,
    hunger: u8,
    energy: u8,
    diet: [u16; 4],
    time_interactions: [u16; 4],
    total_interactions: u16,
    cycle: u8,
    hp: u16,
    atk: u16,
    def: u16,
    spd: u16,
    last_interaction: u32,
    created_at: u32,
) -> Vec<u8> {
    // 62 bytes total. Keep this explicit and boring: compact enough to save
    // rent, simple enough that future gameplay instructions can mutate safely.
    let mut out = Vec::with_capacity(REBYTER_DNA_V2_BYTES);
    out.push(2);
    out.push(family_id);
    out.push(stage);
    out.extend_from_slice(&tree_version.to_le_bytes());
    out.extend_from_slice(&evolution_id.to_le_bytes());
    out.extend_from_slice(genes);
    out.push(weight);
    out.push(bond);
    out.extend_from_slice(&activity.to_le_bytes());
    out.push(hunger);
    out.push(energy);
    for value in diet {
        out.extend_from_slice(&value.to_le_bytes());
    }
    for value in time_interactions {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out.extend_from_slice(&total_interactions.to_le_bytes());
    out.push(cycle);
    out.extend_from_slice(&hp.to_le_bytes());
    out.extend_from_slice(&atk.to_le_bytes());
    out.extend_from_slice(&def.to_le_bytes());
    out.extend_from_slice(&spd.to_le_bytes());
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
    /// CHECK: Program-derived authority only; it stores no data and is not a
    /// second Rebyter account. It exists solely to sign Token-2022 metadata CPIs.
    #[account(
        seeds = [b"rebyter_authority", mint.key().as_ref()],
        bump
    )]
    pub rebyter_authority: UncheckedAccount<'info>,
    /// CHECK: Token-2022 mint is initialized by the client in the same
    /// transaction and is the single account that stores Rebyter state.
    #[account(mut, owner = token_program.key())]
    pub mint: UncheckedAccount<'info>,
    /// CHECK: Owner ATA is initialized by the client in the same transaction.
    #[account(mut, owner = token_program.key())]
    pub owner_token_account: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct InteractRebyter<'info> {
    pub owner: Signer<'info>,
    /// CHECK: Token-2022 mint; ownership and metadata are validated in the handler.
    #[account(mut, owner = token_program.key())]
    pub mint: UncheckedAccount<'info>,
    #[account(
        constraint = owner_token_account.mint == mint.key() @ RegistryError::NotOwner,
        constraint = owner_token_account.owner == owner.key() @ RegistryError::NotOwner,
        constraint = owner_token_account.amount == 1 @ RegistryError::NotOwner
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: PDA signs TokenMetadata updates and stores no account state.
    #[account(
        seeds = [b"rebyter_authority", mint.key().as_ref()],
        bump
    )]
    pub rebyter_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token2022>,
}

#[event]
pub struct RebyterInteraction {
    pub owner: Pubkey,
    pub mint: Pubkey,
    /// 0 feed, 1 play, 2 care.
    pub action: u8,
    /// 0 dawn, 1 morning, 2 afternoon, 3 night (UTC).
    pub time_bucket: u8,
    pub total_interactions: u16,
}

#[event]
pub struct IdsReserved {
    pub start: u32,
    pub count: u16,
}

#[event]
pub struct RebyterCreated {
    pub owner: Pubkey,
    pub mint: Pubkey,
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
    #[msg("This interaction requires compact DNA v2")]
    UnsupportedDna,
    #[msg("Wallet does not own this Rebyter")]
    NotOwner,
    #[msg("Food type must be meat, plant, fish, or fruit")]
    InvalidFood,
}
