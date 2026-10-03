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
pub const REBYTER_GENE_COUNT: usize = 4;
pub const REBYTER_DNA_V3_BYTES: usize = 60;

pub const CONDITION_TIRED: u8 = 1 << 0;
pub const CONDITION_OVERFED: u8 = 1 << 1;
pub const CONDITION_SICK: u8 = 1 << 2;
pub const CONDITION_INJURED: u8 = 1 << 3;
pub const MAX_RULE_BYTES: usize = 1024;
pub const CREATE_REBYTER_PRICE_LAMPORTS: u64 = 0;
pub const PLAYER_PROFILE_INITIAL_DISCOVERY_CAPACITY: usize = 8;
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

    pub fn initialize_player(ctx: Context<InitializePlayer>) -> Result<()> {
        let profile = &mut ctx.accounts.player_profile;
        profile.owner = ctx.accounts.owner.key();
        profile.created_at = Clock::get()?.unix_timestamp;
        profile.discoveries = Vec::new();

        emit!(PlayerProfileInitialized {
            owner: profile.owner,
            created_at: profile.created_at,
        });
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

    pub fn create_rule_set(
        ctx: Context<CreateRuleSet>,
        family_id: u8,
        tree_version: u32,
        rules_root: [u8; 32],
    ) -> Result<()> {
        require!(rules_root != [0; 32], RegistryError::Hash);
        require!(
            ctx.accounts.tree.family_id == family_id
                && ctx.accounts.tree.version == tree_version,
            RegistryError::Version
        );
        let rule_set = &mut ctx.accounts.rule_set;
        rule_set.family_id = family_id;
        rule_set.tree_version = tree_version;
        rule_set.rules_root = rules_root;
        rule_set.created_at = Clock::get()?.unix_timestamp;
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

        if ctx.accounts.player_profile.owner == Pubkey::default() {
            ctx.accounts.player_profile.owner = ctx.accounts.owner.key();
            ctx.accounts.player_profile.created_at = Clock::get()?.unix_timestamp;
            ctx.accounts.player_profile.discoveries = Vec::new();
            emit!(PlayerProfileInitialized {
                owner: ctx.accounts.owner.key(),
                created_at: ctx.accounts.player_profile.created_at,
            });
        } else {
            require!(
                ctx.accounts.player_profile.owner == ctx.accounts.owner.key(),
                RegistryError::NotOwner
            );
        }
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
            b"rebyter-dna-v3",
            owner_key.as_ref(),
            mint_key.as_ref(),
            &clock.slot.to_le_bytes(),
            &clock.unix_timestamp.to_le_bytes(),
        ])
        .to_bytes();

        // Permanent gene order (predispositions, never progression):
        // metabolism, temperament, rhythm, mutation.
        let mut genes = [0u8; REBYTER_GENE_COUNT];
        for (index, gene) in genes.iter_mut().enumerate() {
            *gene = dna[index] % 101;
        }

        // The only custom TokenMetadata field is DNA.
        // DNA v3 deliberately stores only irreducible individual state.
        // Family, stage and atlas version are derived/verified from the active
        // atlas and its Merkle proofs instead of being duplicated in each NFT.
        require!(evolution_id <= u16::MAX as u32, RegistryError::Exhausted);

        record_discovery(
            &mut ctx.accounts.player_profile,
            &ctx.accounts.owner,
            &ctx.accounts.system_program,
            evolution_id as u16,
        )?;

        let now = clock.unix_timestamp.max(0) as u32;
        let dna_blob = pack_rebyter_dna_v3(
            evolution_id as u16,
            &genes,
            10,
            0,
            0,
            70,
            100,
            0,
            [0; 4],
            [0; 4],
            0,
            0,
            100,
            20,
            20,
            20,
            now,
            now,
            now,
            0,
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

    /// Play builds bond and a little speed while consuming energy/fullness.
    pub fn play(ctx: Context<InteractRebyter>) -> Result<()> {
        apply_interaction(&ctx.accounts, InteractionKind::Play)
    }

    /// Care strengthens bond and helps a well-rested Rebyter recover from bad conditions.
    pub fn care(ctx: Context<InteractRebyter>) -> Result<()> {
        apply_interaction(&ctx.accounts, InteractionKind::Care)
    }

    /// Rest restores energy. It is not a cooldown: it is a player action and can
    /// be used whenever desired, but it gives no stat farming advantage.
    pub fn rest(ctx: Context<InteractRebyter>) -> Result<()> {
        apply_interaction(&ctx.accounts, InteractionKind::Rest)
    }

    /// Train with one of six machines:
    /// 0 power, 1 endurance, 2 defense, 3 speed, 4 combat, 5 balanced.
    pub fn train(ctx: Context<InteractRebyter>, training_type: u8) -> Result<()> {
        require!(training_type < 6, RegistryError::InvalidTraining);
        apply_interaction(&ctx.accounts, InteractionKind::Train(training_type))
    }

    pub fn evolve(
        ctx: Context<EvolveRebyter>,
        target_id: u16,
        target_stage: u8,
        target_name: String,
        target_uri: String,
        rule_bytes: Vec<u8>,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        require!(!target_name.is_empty() && target_name.len() <= 32, RegistryError::InvalidMetadata);
        require!(target_uri.is_empty() || (target_uri.starts_with("https://") && target_uri.len() <= MAX_URI_LENGTH), RegistryError::InvalidMetadata);
        require!(!rule_bytes.is_empty() && rule_bytes.len() <= MAX_RULE_BYTES, RegistryError::InvalidRule);

        let mut dna = read_rebyter_dna(&ctx.accounts.mint.to_account_info())?;
        let clock = Clock::get()?;
        materialize_lazy_state(&mut dna, clock.unix_timestamp.max(0) as u32);

        // DNA v3 is not pinned to a historical atlas version. Evolutions are
        // always proven against the currently active atlas selected by registry.
        let family = family_index(ctx.accounts.tree.family_id)?;
        require!(
            ctx.accounts.registry.active_versions[family] == ctx.accounts.tree.version,
            RegistryError::InactiveTree
        );
        let expected_tree = Pubkey::find_program_address(
            &[
                b"tree",
                &[ctx.accounts.tree.family_id],
                &ctx.accounts.tree.version.to_le_bytes(),
            ],
            &crate::ID,
        ).0;
        require!(ctx.accounts.tree.key() == expected_tree, RegistryError::InvalidRule);

        let leaf = rule_leaf_hash(
            ctx.accounts.tree.family_id,
            ctx.accounts.tree.version,
            dna.evolution_id,
            target_id,
            target_stage,
            target_name.as_bytes(),
            target_uri.as_bytes(),
            &rule_bytes,
        )?;

        // DNA v3 starts from unified atlas proofs only.
        require!(ctx.accounts.rule_set.key() == ctx.accounts.tree.key(), RegistryError::InvalidRule);
        let rules_root = ctx.accounts.tree.merkle_root;
        require!(
            merkle::verify_evolution_hash_proof(leaf, &proof, &rules_root),
            RegistryError::InvalidEvolutionProof
        );
        msg!("evolve: rule proof verified");
        require!(
            evaluate_compact_rule(&rule_bytes, &dna, clock.unix_timestamp.max(0) as u32)?,
            RegistryError::EvolutionRequirements
        );
        msg!("evolve: rule requirements verified");

        let source_id = dna.evolution_id;
        // Also record the current form. This safely backfills a player who
        // starts using profiles after owning an older Rebyter.
        record_discovery(
            &mut ctx.accounts.player_profile,
            &ctx.accounts.owner,
            &ctx.accounts.system_program,
            source_id,
        )?;
        record_discovery(
            &mut ctx.accounts.player_profile,
            &ctx.accounts.owner,
            &ctx.accounts.system_program,
            target_id,
        )?;
        msg!("evolve: player discoveries updated");

        dna.evolution_id = target_id;
        dna.stage_entered_at = clock.unix_timestamp.max(0) as u32;
        dna.last_state_at = dna.stage_entered_at;
        let dna_base58 = bs58::encode(dna.encode()).into_string();

        // TokenMetadata is variable length. Pre-fund the mint if a new form has
        // a longer name/URI before Token-2022 reallocates the extension.
        let required_lamports = {
            let mint_info = ctx.accounts.mint.to_account_info();
            let data = mint_info.try_borrow_data()?;
            let state = PodStateWithExtensions::<PodMint>::unpack(&data)
                .map_err(|_| error!(RegistryError::InvalidMetadata))?;
            let mut metadata = state
                .get_variable_len_extension::<TokenMetadata>()
                .map_err(|_| error!(RegistryError::InvalidMetadata))?;
            metadata.update(Field::Key("DNA".to_string()), dna_base58.clone());
            metadata.update(Field::Name, target_name.clone());
            if !target_uri.is_empty() {
                metadata.update(Field::Uri, target_uri.clone());
            }
            let new_len = state
                .try_get_new_account_len_for_variable_len_extension(&metadata)
                .map_err(|_| error!(RegistryError::InvalidMetadata))?;
            Rent::get()?.minimum_balance(new_len)
        };
        let current_lamports = ctx.accounts.mint.to_account_info().lamports();
        if required_lamports > current_lamports {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    Transfer {
                        from: ctx.accounts.owner.to_account_info(),
                        to: ctx.accounts.mint.to_account_info(),
                    },
                ),
                required_lamports - current_lamports,
            )?;
        }

        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.bumps.rebyter_authority;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"rebyter_authority",
            mint_key.as_ref(),
            &[bump],
        ]];

        for (field, value) in [
            (Field::Key("DNA".to_string()), dna_base58),
            (Field::Name, target_name.clone()),
        ] {
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
                field,
                value,
            )?;
        }
        if !target_uri.is_empty() {
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
                Field::Uri,
                target_uri,
            )?;
        }

        emit!(RebyterEvolved {
            owner: ctx.accounts.owner.key(),
            mint: mint_key,
            source_id,
            target_id,
            stage: target_stage,
        });
        Ok(())
    }
}

#[derive(Clone, Copy)]
enum InteractionKind {
    Feed(u8),
    Play,
    Care,
    Rest,
    Train(u8),
}

#[derive(Clone)]
struct RebyterDnaV3 {
    evolution_id: u16,
    genes: [u8; REBYTER_GENE_COUNT],
    weight: u8,
    bond: u8,
    discipline: u8,
    fullness: u8,
    energy: u8,
    condition: u8,
    diet: [u16; 4],
    time_interactions: [u16; 4],
    total_interactions: u16,
    cycle: u8,
    hp: u16,
    atk: u16,
    def: u16,
    spd: u16,
    last_state_at: u32,
    stage_entered_at: u32,
    created_at: u32,
    learned_skills: u64,
}

impl RebyterDnaV3 {
    fn decode(bytes: &[u8]) -> Result<Self> {
        require!(
            bytes.len() == REBYTER_DNA_V3_BYTES && bytes[0] == 3,
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
                data[*offset], data[*offset + 1], data[*offset + 2], data[*offset + 3],
            ]);
            *offset += 4;
            value
        };
        let take_u64 = |data: &[u8], offset: &mut usize| -> u64 {
            let value = u64::from_le_bytes([
                data[*offset], data[*offset + 1], data[*offset + 2], data[*offset + 3],
                data[*offset + 4], data[*offset + 5], data[*offset + 6], data[*offset + 7],
            ]);
            *offset += 8;
            value
        };

        let evolution_id = take_u16(bytes, &mut o);
        let mut genes = [0u8; REBYTER_GENE_COUNT];
        genes.copy_from_slice(&bytes[o..o + REBYTER_GENE_COUNT]);
        o += REBYTER_GENE_COUNT;
        let weight = take_u8(bytes, &mut o);
        let bond = take_u8(bytes, &mut o);
        let discipline = take_u8(bytes, &mut o);
        let fullness = take_u8(bytes, &mut o);
        let energy = take_u8(bytes, &mut o);
        let condition = take_u8(bytes, &mut o);
        let mut diet = [0u16; 4];
        for value in diet.iter_mut() { *value = take_u16(bytes, &mut o); }
        let mut time_interactions = [0u16; 4];
        for value in time_interactions.iter_mut() { *value = take_u16(bytes, &mut o); }
        let total_interactions = take_u16(bytes, &mut o);
        let cycle = take_u8(bytes, &mut o);
        let hp = take_u16(bytes, &mut o);
        let atk = take_u16(bytes, &mut o);
        let def = take_u16(bytes, &mut o);
        let spd = take_u16(bytes, &mut o);
        let last_state_at = take_u32(bytes, &mut o);
        let stage_entered_at = take_u32(bytes, &mut o);
        let created_at = take_u32(bytes, &mut o);
        let learned_skills = take_u64(bytes, &mut o);

        Ok(Self {
            evolution_id, genes, weight, bond, discipline, fullness, energy,
            condition, diet, time_interactions, total_interactions, cycle,
            hp, atk, def, spd, last_state_at, stage_entered_at, created_at,
            learned_skills,
        })
    }

    fn encode(&self) -> Vec<u8> {
        pack_rebyter_dna_v3(
            self.evolution_id, &self.genes, self.weight, self.bond,
            self.discipline, self.fullness, self.energy, self.condition,
            self.diet, self.time_interactions, self.total_interactions,
            self.cycle, self.hp, self.atk, self.def, self.spd,
            self.last_state_at, self.stage_entered_at, self.created_at,
            self.learned_skills,
        )
    }
}

fn utc_time_bucket(unix_timestamp: i64) -> usize {
    let hour = (unix_timestamp.rem_euclid(86_400) / 3_600) as u8;
    match hour {
        0..=5 => 0,
        6..=11 => 1,
        12..=17 => 2,
        _ => 3,
    }
}

fn has_condition(dna: &RebyterDnaV3, flag: u8) -> bool { dna.condition & flag != 0 }
fn add_condition(dna: &mut RebyterDnaV3, flag: u8) { dna.condition |= flag; }
fn clear_condition(dna: &mut RebyterDnaV3, flag: u8) { dna.condition &= !flag; }

fn materialize_lazy_state(dna: &mut RebyterDnaV3, now: u32) {
    if now <= dna.last_state_at { return; }
    let hours = now.saturating_sub(dna.last_state_at) / 3_600;
    if hours == 0 { return; }

    let metabolism = u32::from(dna.genes[0]);
    let fullness_per_hour = 1u32.saturating_add(metabolism / 34);
    let recovery_per_hour = 2u32.saturating_add(metabolism / 50);
    dna.fullness = dna.fullness.saturating_sub(
        hours.saturating_mul(fullness_per_hour).min(100) as u8
    );
    dna.energy = dna.energy.saturating_add(
        hours.saturating_mul(recovery_per_hour).min(100) as u8
    ).min(100);

    if dna.fullness <= 80 { clear_condition(dna, CONDITION_OVERFED); }
    if dna.energy >= 40 { clear_condition(dna, CONDITION_TIRED); }
    if dna.fullness == 0 && hours >= 12 { add_condition(dna, CONDITION_SICK); }
    dna.last_state_at = now;
}

fn read_rebyter_dna(mint: &AccountInfo<'_>) -> Result<RebyterDnaV3> {
    let data = mint.try_borrow_data()?;
    let mint_state = PodStateWithExtensions::<PodMint>::unpack(&data)
        .map_err(|_| error!(RegistryError::InvalidMetadata))?;
    let metadata = mint_state
        .get_variable_len_extension::<TokenMetadata>()
        .map_err(|_| error!(RegistryError::InvalidMetadata))?;
    let dna_base58 = metadata.additional_metadata.iter()
        .find(|(key, _)| key == "DNA")
        .map(|(_, value)| value)
        .ok_or_else(|| error!(RegistryError::UnsupportedDna))?;
    let bytes = bs58::decode(dna_base58).into_vec()
        .map_err(|_| error!(RegistryError::UnsupportedDna))?;
    RebyterDnaV3::decode(&bytes)
}

fn scaled_gain(base: u16, tier: u8) -> u16 {
    match tier { 2 => base, 1 => base.saturating_add(1) / 2, _ => 0 }
}
fn temperament_bond_bonus(dna: &RebyterDnaV3) -> u8 { dna.genes[1] / 50 }

fn maybe_unlock_training_skill(dna: &mut RebyterDnaV3, training_type: u8, full_effect: bool) {
    if !full_effect { return; }
    let bit = match training_type {
        0 if dna.atk >= 50 => Some(3),
        1 if dna.hp >= 150 => Some(4),
        2 if dna.def >= 50 => Some(5),
        3 if dna.spd >= 50 => Some(6),
        4 if u32::from(dna.atk) + u32::from(dna.def) + u32::from(dna.spd) >= 150 => Some(7),
        5 if dna.hp >= 120 && dna.atk >= 35 && dna.def >= 35 && dna.spd >= 35 => Some(8),
        _ => None,
    };
    if let Some(index) = bit { dna.learned_skills |= 1u64 << index; }
}

fn apply_interaction(accounts: &InteractRebyter<'_>, kind: InteractionKind) -> Result<()> {
    let mut dna = read_rebyter_dna(&accounts.mint.to_account_info())?;
    let clock = Clock::get()?;
    let now = clock.unix_timestamp.max(0) as u32;
    materialize_lazy_state(&mut dna, now);

    match kind {
        InteractionKind::Feed(food_type) => {
            let i = usize::from(food_type);
            let was_overfed = has_condition(&dna, CONDITION_OVERFED) || dna.fullness >= 90;
            let fullness_gain = [22u8, 16, 18, 14][i];
            let base_weight = [2u8, 1, 1, 1][i];
            let weight_gain = base_weight.saturating_sub(dna.genes[0] / 60).max(1);
            dna.diet[i] = dna.diet[i].saturating_add(1);
            dna.fullness = dna.fullness.saturating_add(fullness_gain).min(100);
            dna.weight = dna.weight.saturating_add(weight_gain);
            dna.energy = dna.energy.saturating_add(4).min(100);
            if dna.fullness < 80 && !was_overfed {
                dna.bond = dna.bond.saturating_add(1 + temperament_bond_bonus(&dna)).min(100);
            }
            if was_overfed {
                let already_overfed = has_condition(&dna, CONDITION_OVERFED);
                dna.discipline = dna.discipline.saturating_sub(2);
                add_condition(&mut dna, CONDITION_OVERFED);
                if already_overfed && dna.fullness >= 100 { add_condition(&mut dna, CONDITION_SICK); }
            } else if dna.fullness >= 95 {
                add_condition(&mut dna, CONDITION_OVERFED);
            }
        }
        InteractionKind::Play => {
            let energy_before = dna.energy;
            let fullness_before = dna.fullness;
            dna.energy = dna.energy.saturating_sub(12);
            dna.fullness = dna.fullness.saturating_sub(4);
            dna.weight = dna.weight.saturating_sub(1);

            if energy_before >= 20 && fullness_before >= 10 && !has_condition(&dna, CONDITION_SICK) {
                dna.bond = dna.bond.saturating_add(3 + temperament_bond_bonus(&dna)).min(100);
            } else {
                // The action is allowed, but forcing play while depleted is bad care.
                dna.bond = dna.bond.saturating_sub(1);
                dna.discipline = dna.discipline.saturating_sub(1);
            }

            if energy_before >= 40 && !has_condition(&dna, CONDITION_SICK) {
                dna.spd = dna.spd.saturating_add(1);
            }
            if energy_before < 20 {
                if has_condition(&dna, CONDITION_TIRED) { add_condition(&mut dna, CONDITION_SICK); }
                add_condition(&mut dna, CONDITION_TIRED);
            }
            if fullness_before == 0 {
                add_condition(&mut dna, CONDITION_SICK);
            }
        }
        InteractionKind::Care => {
            let can_benefit = dna.energy >= 15 && dna.fullness >= 10;
            dna.energy = dna.energy.saturating_sub(2);
            dna.fullness = dna.fullness.saturating_sub(1);
            if can_benefit {
                dna.bond = dna.bond.saturating_add(4 + temperament_bond_bonus(&dna)).min(100);
            } else {
                // Repeating Care on a depleted companion is interaction, not free Bond.
                dna.discipline = dna.discipline.saturating_sub(1);
            }
            if has_condition(&dna, CONDITION_SICK)
                && dna.energy >= 50 && dna.fullness >= 20 && dna.fullness <= 90
            {
                clear_condition(&mut dna, CONDITION_SICK);
                dna.discipline = dna.discipline.saturating_add(1).min(100);
            }
            if has_condition(&dna, CONDITION_INJURED) && dna.energy >= 70 {
                clear_condition(&mut dna, CONDITION_INJURED);
            }
        }
        InteractionKind::Rest => {
            let needed_rest = dna.energy < 70 || has_condition(&dna, CONDITION_TIRED);
            let fullness_before = dna.fullness;
            dna.energy = dna.energy.saturating_add(30).min(100);
            dna.fullness = dna.fullness.saturating_sub(2);
            if needed_rest {
                dna.discipline = dna.discipline.saturating_add(1).min(100);
            } else if fullness_before < 10 {
                // Spamming unnecessary rest while starving is poor routine.
                dna.discipline = dna.discipline.saturating_sub(1);
            }
            if dna.energy >= 40 { clear_condition(&mut dna, CONDITION_TIRED); }
            if dna.energy >= 70 && dna.fullness >= 20 && !has_condition(&dna, CONDITION_OVERFED) {
                clear_condition(&mut dna, CONDITION_SICK);
            }
            if dna.energy >= 85 { clear_condition(&mut dna, CONDITION_INJURED); }
            if fullness_before == 0 { add_condition(&mut dna, CONDITION_SICK); }
        }
        InteractionKind::Train(training_type) => {
            let energy_before = dna.energy;
            let sick_or_injured = has_condition(&dna, CONDITION_SICK)
                || has_condition(&dna, CONDITION_INJURED);
            let mut tier: u8 = if energy_before >= 50 { 2 } else if energy_before >= 20 { 1 } else { 0 };
            if sick_or_injured { tier = tier.saturating_sub(1); }
            let (hp_gain, atk_gain, def_gain, spd_gain, energy_cost, weight_loss) = match training_type {
                0 => (1u16, 3u16, 0u16, 0u16, 22u8, 1u8),
                1 => (4, 0, 0, 1, 24, 2),
                2 => (1, 0, 3, 0, 18, 0),
                3 => (0, 1, 0, 3, 22, 2),
                4 => (0, 2, 1, 1, 25, 1),
                5 => (1, 1, 1, 1, 16, 1),
                _ => return err!(RegistryError::InvalidTraining),
            };
            dna.hp = dna.hp.saturating_add(scaled_gain(hp_gain, tier));
            dna.atk = dna.atk.saturating_add(scaled_gain(atk_gain, tier));
            dna.def = dna.def.saturating_add(scaled_gain(def_gain, tier));
            dna.spd = dna.spd.saturating_add(scaled_gain(spd_gain, tier));
            dna.energy = dna.energy.saturating_sub(energy_cost);
            dna.fullness = dna.fullness.saturating_sub(6);
            dna.weight = dna.weight.saturating_sub(weight_loss);
            if tier > 0 {
                dna.discipline = dna.discipline.saturating_add(if training_type == 4 { 2 } else { 1 }).min(100);
            } else {
                dna.discipline = dna.discipline.saturating_sub(2);
                dna.bond = dna.bond.saturating_sub(1);
                if has_condition(&dna, CONDITION_TIRED) {
                    add_condition(&mut dna, CONDITION_SICK | CONDITION_INJURED);
                }
                add_condition(&mut dna, CONDITION_TIRED);
            }
            if energy_before < 10 || (sick_or_injured && energy_before < 30) {
                add_condition(&mut dna, CONDITION_INJURED);
            }
            maybe_unlock_training_skill(&mut dna, training_type, tier == 2);
        }
    }

    let bucket = utc_time_bucket(clock.unix_timestamp);
    dna.time_interactions[bucket] = dna.time_interactions[bucket].saturating_add(1);
    dna.total_interactions = dna.total_interactions.saturating_add(1);
    dna.last_state_at = now;

    let dna_base58 = bs58::encode(dna.encode()).into_string();
    let mint_key = accounts.mint.key();
    let (_, bump) = Pubkey::find_program_address(&[b"rebyter_authority", mint_key.as_ref()], &crate::ID);
    let signer_seeds: &[&[&[u8]]] = &[&[b"rebyter_authority", mint_key.as_ref(), &[bump]]];
    token_metadata_update_field(
        CpiContext::new(
            accounts.token_program.key(),
            TokenMetadataUpdateField {
                program_id: accounts.token_program.to_account_info(),
                metadata: accounts.mint.to_account_info(),
                update_authority: accounts.rebyter_authority.to_account_info(),
            },
        ).with_signer(signer_seeds),
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
            InteractionKind::Rest => 3,
            InteractionKind::Train(_) => 4,
        },
        time_bucket: bucket as u8,
        total_interactions: dna.total_interactions,
    });
    Ok(())
}

fn rule_leaf_hash(
    family_id: u8,
    tree_version: u32,
    source_id: u16,
    target_id: u16,
    target_stage: u8,
    target_name: &[u8],
    target_uri: &[u8],
    rule_bytes: &[u8],
) -> Result<[u8; 32]> {
    require!(target_name.len() <= u8::MAX as usize, RegistryError::InvalidRule);
    require!(target_uri.len() <= u16::MAX as usize, RegistryError::InvalidRule);
    require!(rule_bytes.len() <= u16::MAX as usize, RegistryError::InvalidRule);
    Ok(solana_sha256_hasher::hashv(&[
        &[2],
        &[family_id],
        &tree_version.to_le_bytes(),
        &source_id.to_le_bytes(),
        &target_id.to_le_bytes(),
        &[target_stage],
        &[target_name.len() as u8],
        target_name,
        &(target_uri.len() as u16).to_le_bytes(),
        target_uri,
        &(rule_bytes.len() as u16).to_le_bytes(),
        rule_bytes,
    ]).to_bytes())
}

struct RuleCursor<'a> {
    data: &'a [u8],
    offset: usize,
}
impl<'a> RuleCursor<'a> {
    fn new(data: &'a [u8]) -> Self { Self { data, offset: 0 } }
    fn u8(&mut self) -> Result<u8> {
        require!(self.offset < self.data.len(), RegistryError::InvalidRule);
        let v = self.data[self.offset];
        self.offset += 1;
        Ok(v)
    }
    fn u16(&mut self) -> Result<u16> {
        require!(self.offset + 2 <= self.data.len(), RegistryError::InvalidRule);
        let v = u16::from_le_bytes([self.data[self.offset], self.data[self.offset + 1]]);
        self.offset += 2;
        Ok(v)
    }
}

fn percentage(value: u16, total: u32) -> u16 {
    // BPF integer division must never receive a zero denominator. Using
    // max(1) is equivalent to returning 0 when value/total are both zero,
    // while making the divisor non-zero at the instruction level.
    let denominator = total.max(1);
    ((u32::from(value).saturating_mul(100)) / denominator).min(100) as u16
}

fn metric_value(metric: u8, dna: &RebyterDnaV3, now: u32) -> Result<u16> {
    let diet_total: u32 = dna.diet.iter().map(|v| u32::from(*v)).sum();
    let time_total: u32 = dna.time_interactions.iter().map(|v| u32::from(*v)).sum();
    let value = match metric {
        0..=3 => u16::from(dna.genes[usize::from(metric)]),
        4 => percentage(dna.diet[0], diet_total),
        5 => percentage(dna.diet[2], diet_total),
        6 => percentage(dna.diet[1], diet_total),
        7 => percentage(dna.diet[3], diet_total),
        8 => percentage(dna.time_interactions[1], time_total),
        9 => percentage(dna.time_interactions[2], time_total),
        10 => percentage(dna.time_interactions[3], time_total),
        11 => percentage(dna.time_interactions[0], time_total),
        12 => u16::from(dna.weight),
        13 => u16::from(dna.bond),
        14 => u16::from(dna.discipline),
        15 => u16::from(dna.fullness),
        16 => u16::from(dna.energy),
        17 => dna.total_interactions,
        18 => u16::from(dna.cycle),
        19 => ((now.saturating_sub(dna.stage_entered_at)) / 3_600).min(u16::MAX as u32) as u16,
        20 => dna.hp,
        21 => dna.atk,
        22 => dna.def,
        23 => dna.spd,
        24 => if has_condition(dna, CONDITION_SICK) { 1 } else { 0 },
        25 => if has_condition(dna, CONDITION_INJURED) { 1 } else { 0 },
        26 => dna.learned_skills.count_ones().min(u16::MAX as u32) as u16,
        _ => return err!(RegistryError::InvalidRule),
    };
    Ok(value)
}

fn condition_passes(cursor: &mut RuleCursor<'_>, dna: &RebyterDnaV3, now: u32) -> Result<bool> {
    let metric_count = cursor.u8()?;
    require!(metric_count > 0 && metric_count <= 16, RegistryError::InvalidRule);
    let mut value = 0u32;
    for _ in 0..metric_count {
        let metric = cursor.u8()?;
        msg!("evolve: evaluating metric {}", metric);
        value = value.saturating_add(u32::from(metric_value(metric, dna, now)?));
    }
    let test = cursor.u8()?;
    let lo = u32::from(cursor.u16()?);
    let hi = u32::from(cursor.u16()?);
    Ok(match test {
        0 => value >= lo,
        1 => value >= lo && value <= hi,
        2 => value <= hi,
        3 => value == lo,
        _ => return err!(RegistryError::InvalidRule),
    })
}

fn evaluate_compact_rule(bytes: &[u8], dna: &RebyterDnaV3, now: u32) -> Result<bool> {
    let mut cursor = RuleCursor::new(bytes);
    require!(cursor.u8()? == 1, RegistryError::InvalidRule);
    let required_groups = cursor.u8()?;
    let group_count = cursor.u8()?;
    require!(group_count <= 7 && required_groups <= group_count, RegistryError::InvalidRule);

    let mut passed_groups = 0u8;
    for _ in 0..group_count {
        let _group_id = cursor.u8()?;
        let alt_count = cursor.u8()?;
        require!(alt_count > 0 && alt_count <= 16, RegistryError::InvalidRule);
        let mut group_passed = false;
        for _ in 0..alt_count {
            let condition_count = cursor.u8()?;
            require!(condition_count > 0 && condition_count <= 16, RegistryError::InvalidRule);
            let mut alt_passed = true;
            for _ in 0..condition_count {
                alt_passed &= condition_passes(&mut cursor, dna, now)?;
            }
            group_passed |= alt_passed;
        }
        if group_passed {
            passed_groups = passed_groups.saturating_add(1);
        }
    }

    let mandatory_count = cursor.u8()?;
    require!(mandatory_count <= 32, RegistryError::InvalidRule);
    let mut mandatory_passed = true;
    for _ in 0..mandatory_count {
        mandatory_passed &= condition_passes(&mut cursor, dna, now)?;
    }
    require!(cursor.offset == bytes.len(), RegistryError::InvalidRule);

    // No generic interaction-count or "player-shaped group" gate.
    // Eligibility is defined only by the verified atlas rule.
    Ok(mandatory_passed && passed_groups >= required_groups)
}

fn record_discovery<'info>(
    profile: &mut Account<'info, PlayerProfile>,
    payer: &Signer<'info>,
    system_program: &Program<'info, System>,
    evolution_id: u16,
) -> Result<()> {
    if profile.discoveries.contains(&evolution_id) {
        return Ok(());
    }

    let next_len = profile.discoveries.len().saturating_add(1);
    let required_space = PlayerProfile::space_for(next_len);
    let profile_info = profile.to_account_info();

    if profile_info.data_len() < required_space {
        let required_lamports = Rent::get()?.minimum_balance(required_space);
        let current_lamports = profile_info.lamports();
        if required_lamports > current_lamports {
            transfer(
                CpiContext::new(
                    system_program.key(),
                    Transfer {
                        from: payer.to_account_info(),
                        to: profile_info.clone(),
                    },
                ),
                required_lamports - current_lamports,
            )?;
        }
        profile_info.resize(required_space)?;
    }

    profile.discoveries.push(evolution_id);
    emit!(PlayerDiscovery {
        owner: profile.owner,
        evolution_id,
        discoveries: profile.discoveries.len() as u32,
    });
    Ok(())
}

fn pack_rebyter_dna_v3(
    evolution_id: u16,
    genes: &[u8; REBYTER_GENE_COUNT],
    weight: u8,
    bond: u8,
    discipline: u8,
    fullness: u8,
    energy: u8,
    condition: u8,
    diet: [u16; 4],
    time_interactions: [u16; 4],
    total_interactions: u16,
    cycle: u8,
    hp: u16,
    atk: u16,
    def: u16,
    spd: u16,
    last_state_at: u32,
    stage_entered_at: u32,
    created_at: u32,
    learned_skills: u64,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(REBYTER_DNA_V3_BYTES);
    out.push(3);
    out.extend_from_slice(&evolution_id.to_le_bytes());
    out.extend_from_slice(genes);
    out.push(weight);
    out.push(bond);
    out.push(discipline);
    out.push(fullness);
    out.push(energy);
    out.push(condition);
    for value in diet { out.extend_from_slice(&value.to_le_bytes()); }
    for value in time_interactions { out.extend_from_slice(&value.to_le_bytes()); }
    out.extend_from_slice(&total_interactions.to_le_bytes());
    out.push(cycle);
    out.extend_from_slice(&hp.to_le_bytes());
    out.extend_from_slice(&atk.to_le_bytes());
    out.extend_from_slice(&def.to_le_bytes());
    out.extend_from_slice(&spd.to_le_bytes());
    out.extend_from_slice(&last_state_at.to_le_bytes());
    out.extend_from_slice(&stage_entered_at.to_le_bytes());
    out.extend_from_slice(&created_at.to_le_bytes());
    out.extend_from_slice(&learned_skills.to_le_bytes());
    debug_assert_eq!(out.len(), REBYTER_DNA_V3_BYTES);
    out
}

fn family_index(id: u8) -> Result<usize> {
    require!(id < 8, RegistryError::Family);
    Ok(usize::from(id))
}

#[account]
pub struct PlayerProfile {
    pub owner: Pubkey,
    pub created_at: i64,
    pub discoveries: Vec<u16>,
}

impl PlayerProfile {
    // Anchor discriminator + owner + created_at + Vec length prefix.
    pub const FIXED_SPACE: usize = 8 + 32 + 8 + 4;

    pub fn space_for(discoveries: usize) -> usize {
        Self::FIXED_SPACE.saturating_add(discoveries.saturating_mul(2))
    }
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

#[account]
#[derive(InitSpace)]
pub struct RuleSet {
    pub family_id: u8,
    pub tree_version: u32,
    pub rules_root: [u8; 32],
    pub created_at: i64,
}


#[derive(Accounts)]
pub struct InitializePlayer<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = PlayerProfile::space_for(PLAYER_PROFILE_INITIAL_DISCOVERY_CAPACITY),
        seeds = [b"player", owner.key().as_ref()],
        bump
    )]
    pub player_profile: Account<'info, PlayerProfile>,
    pub system_program: Program<'info, System>,
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
#[instruction(family_id: u8, tree_version: u32)]
pub struct CreateRuleSet<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"registry"], bump, has_one = authority)]
    pub registry: Account<'info, RegistryRoot>,
    #[account(
        seeds = [b"tree".as_ref(), &[family_id], &tree_version.to_le_bytes()],
        bump
    )]
    pub tree: Account<'info, EvolutionTree>,
    #[account(
        init,
        payer = authority,
        space = 8 + RuleSet::INIT_SPACE,
        seeds = [b"rules".as_ref(), &[family_id], &tree_version.to_le_bytes()],
        bump
    )]
    pub rule_set: Account<'info, RuleSet>,
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
    #[account(
        init_if_needed,
        payer = owner,
        space = PlayerProfile::space_for(PLAYER_PROFILE_INITIAL_DISCOVERY_CAPACITY),
        seeds = [b"player", owner.key().as_ref()],
        bump
    )]
    pub player_profile: Account<'info, PlayerProfile>,
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

#[derive(Accounts)]
pub struct EvolveRebyter<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"player", owner.key().as_ref()],
        bump,
        has_one = owner
    )]
    pub player_profile: Account<'info, PlayerProfile>,
    /// CHECK: Token-2022 mint; ownership and DNA are validated in the handler.
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
    #[account(seeds = [b"registry"], bump)]
    pub registry: Account<'info, RegistryRoot>,
    pub tree: Account<'info, EvolutionTree>,
    /// CHECK: DNA v3 requires this to be the same address as `tree`; the
    /// unified active atlas root verifies both forms and gameplay rules.
    pub rule_set: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct PlayerProfileInitialized {
    pub owner: Pubkey,
    pub created_at: i64,
}

#[event]
pub struct PlayerDiscovery {
    pub owner: Pubkey,
    pub evolution_id: u16,
    pub discoveries: u32,
}

#[event]
pub struct RebyterInteraction {
    pub owner: Pubkey,
    pub mint: Pubkey,
    /// 0 feed, 1 play, 2 care, 3 rest, 4 train.
    pub action: u8,
    /// 0 night, 1 morning, 2 day, 3 evening (UTC).
    pub time_bucket: u8,
    pub total_interactions: u16,
}

#[event]
pub struct RebyterEvolved {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub source_id: u16,
    pub target_id: u16,
    pub stage: u8,
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
    #[msg("This interaction requires Rebyter DNA v3")]
    UnsupportedDna,
    #[msg("Wallet does not own this Rebyter")]
    NotOwner,
    #[msg("Food type must be meat, plant, fish, or fruit")]
    InvalidFood,
    #[msg("Evolution rule proof or encoding is invalid")]
    InvalidRule,
    #[msg("Evolution target is invalid")]
    InvalidEvolution,
    #[msg("This Rebyter does not yet satisfy the evolution requirements")]
    EvolutionRequirements,
    #[msg("Training type must be power, endurance, defense, speed, combat, or balanced")]
    InvalidTraining,
}
