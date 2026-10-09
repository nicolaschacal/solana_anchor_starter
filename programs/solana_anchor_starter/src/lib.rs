use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{
        spl_token_2022::{
            extension::{
                non_transferable::NonTransferable, permanent_delegate::PermanentDelegate,
                BaseStateWithExtensions, PodStateWithExtensions,
            },
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
        burn, mint_to, token_metadata_initialize, Burn, Mint, MintTo, Token2022, TokenAccount,
        TokenMetadataInitialize,
    },
};

pub mod merkle;

declare_id!("7AnfhSTGK11PUqep6wdfkCcSuwhAsaU4RwYfDGdcWyfp");

pub const MAX_FAMILIES: usize = 16;
pub const MAX_URI_LENGTH: usize = 128;
pub const REBYTER_DNA_BYTES: usize = 50;

pub const CONDITION_TIRED: u8 = 1 << 0;
pub const CONDITION_OVERFED: u8 = 1 << 1;
pub const CONDITION_SICK: u8 = 1 << 2;
pub const CONDITION_INJURED: u8 = 1 << 3;
pub const MAX_RULE_BYTES: usize = 1024;
pub const CREATE_REBYTER_PRICE_LAMPORTS: u64 = 0;
pub const PLAYER_PROFILE_INITIAL_DISCOVERY_CAPACITY: usize = 8;
pub const LOADER: Pubkey = pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");
pub const MAX_GEM_PACKS: usize = 8;
pub const MAX_PURCHASE_QUANTITY: u16 = 99;
pub const SECONDS_PER_DAY: i64 = 86_400;
pub const QUESTS_PER_DAY: usize = 3;
/// Action kinds counted in `PlayerProfile::counts`.
pub const ACTION_FEED: usize = 0;
pub const ACTION_PLAY: usize = 1;
pub const ACTION_CARE: usize = 2;
pub const ACTION_REST: usize = 3;
pub const ACTION_TRAIN: usize = 4;
/// Daily quest templates: (action kind, how many times, meals of food as the reward).
pub const QUEST_TEMPLATES: [(u8, u8, u8); 8] = [
    (0, 3, 1),
    (1, 3, 1),
    (2, 2, 1),
    (4, 1, 1),
    (0, 5, 2),
    (1, 5, 2),
    (3, 1, 1),
    (4, 3, 2),
];
/// Meals of each food a new player starts with (part of the starter pack).
pub const STARTER_MEALS: u16 = 3;
pub const FOOD_TYPES: usize = 4;
pub const FOOD_TIERS: usize = 4;
/// Counters in the profile: food type * 4 + tier (0 = plain, 3 = feast).
pub const FOOD_SLOTS: usize = FOOD_TYPES * FOOD_TIERS;
/// Saturation and weight of a meal, in percent of the plain meal, per tier.
pub const FOOD_TIER_PCT: [u16; FOOD_TIERS] = [100, 150, 220, 300];
/// How much a meal of each tier counts in the diet history that drives evolution.
pub const FOOD_TIER_DIET: [u16; FOOD_TIERS] = [1, 2, 3, 4];
/// `machine_training` of an item that is not a training machine.
pub const NO_MACHINE: u8 = 255;
/// Highest bonus (percent) a machine can give.
pub const MAX_MACHINE_BONUS: u8 = 200;
/// A habitat NFT keeps its layout in one metadata field (hex) that grows with what is placed, and the
/// owner pays the rent of the extra bytes when saving: set flag, placed count, placed Rebyters (34
/// bytes each), prop count, props (9 bytes each). A blank habitat is the single byte 0.
pub const BLANK_LAYOUT: [u8; 1] = [0];

/// Game day number (UTC). Day 0 means "never", so the first real day is 1.
pub fn game_day(unix_timestamp: i64) -> u32 {
    (unix_timestamp.max(0) / SECONDS_PER_DAY) as u32 + 1
}

/// The quest in `slot` (0..3) for a game day: (action kind, target, meals). Everyone gets the
/// same three quests on a given day, derived from the day number alone (no server, no oracle).
pub fn quest_for(day: u32, slot: usize) -> (u8, u8, u8) {
    const OFFSETS: [usize; QUESTS_PER_DAY] = [0, 3, 5];
    QUEST_TEMPLATES[(day as usize + OFFSETS[slot]) % QUEST_TEMPLATES.len()]
}

/// Which food (0 meat, 1 plant, 2 fish, 3 fruit) a quest pays out.
pub fn quest_food(day: u32, slot: usize) -> usize {
    (day as usize + slot) % 4
}

fn to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[usize::from(b >> 4)] as char);
        out.push(DIGITS[usize::from(b & 15)] as char);
    }
    out
}

/// Serializes a habitat layout (see BLANK_LAYOUT for the format).
fn encode_layout(placed: &[PlacedSlot], props: &[PropSlot]) -> Vec<u8> {
    let mut out = Vec::with_capacity(3 + placed.len() * 34 + props.len() * 9);
    out.push(1);
    out.push(placed.len() as u8);
    for slot in placed {
        out.extend_from_slice(slot.mint.as_ref());
        out.push(slot.i);
        out.push(slot.j);
    }
    out.push(props.len() as u8);
    for p in props {
        out.push(p.kind);
        out.extend_from_slice(&p.x.to_le_bytes());
        out.extend_from_slice(&p.z.to_le_bytes());
        out.extend_from_slice(&p.h.to_le_bytes());
        out.extend_from_slice(&p.r.to_le_bytes());
    }
    out
}

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
        profile.bump = ctx.bumps.player_profile;
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

    // ---------------------------------------------------------------------
    // Economy: Gems (bought with SOL, burned on spend) and item catalog.
    // ---------------------------------------------------------------------

    /// Creates the economy singleton. The gem mint is created client-side
    /// (Token-2022, 0 decimals, NonTransferable, PermanentDelegate = economy
    /// PDA, mint authority = economy PDA, no freeze authority) and validated here.
    pub fn initialize_economy(ctx: Context<InitializeEconomy>, treasury: Pubkey) -> Result<()> {
        require!(treasury != Pubkey::default(), RegistryError::Authority);
        let economy_key = ctx.accounts.economy.key();
        validate_economy_mint(
            &ctx.accounts.gem_mint,
            &economy_key,
            Some(true),
            ctx.accounts.token_program.key(),
        )?;
        let economy = &mut ctx.accounts.economy;
        economy.treasury = treasury;
        economy.gem_mint = ctx.accounts.gem_mint.key();
        economy.gem_packs = [GemPack::default(); MAX_GEM_PACKS];
        economy.food_prices = [0; FOOD_SLOTS];
        economy.ration_units = 0;
        economy.bump = ctx.bumps.economy;
        Ok(())
    }

    pub fn set_treasury(ctx: Context<AdminEconomy>, treasury: Pubkey) -> Result<()> {
        require!(treasury != Pubkey::default(), RegistryError::Authority);
        ctx.accounts.economy.treasury = treasury;
        Ok(())
    }

    /// Sets (or disables with zeros) a gem pack. Prices are in lamports.
    pub fn set_gem_pack(
        ctx: Context<AdminEconomy>,
        pack_id: u8,
        gems: u64,
        price_lamports: u64,
    ) -> Result<()> {
        require!(usize::from(pack_id) < MAX_GEM_PACKS, RegistryError::InvalidQuantity);
        require!(
            (gems == 0) == (price_lamports == 0),
            RegistryError::PackInactive
        );
        ctx.accounts.economy.gem_packs[usize::from(pack_id)] = GemPack { gems, price_lamports };
        Ok(())
    }

    /// Registers an item mint (created client-side, 0 decimals, mint authority =
    /// economy PDA). Items are plain transferable tokens bought with Gems. A training machine
    /// names the training it improves and its bonus (percent of the gains); an evolution item
    /// names the evolution id it turns a Rebyter into. Plain items pass NO_MACHINE, 0 and 0.
    pub fn create_item_type(
        ctx: Context<CreateItemType>,
        item_id: u16,
        price_gems: u64,
        units_per_purchase: u16,
        machine_training: u8,
        machine_bonus: u8,
        evo_target: u16,
    ) -> Result<()> {
        require!(price_gems > 0 && units_per_purchase > 0, RegistryError::InvalidQuantity);
        let is_machine = machine_training != NO_MACHINE;
        require!(!is_machine || (machine_training < 6 && machine_bonus > 0 && machine_bonus <= MAX_MACHINE_BONUS), RegistryError::InvalidMachine);
        require!(is_machine || machine_bonus == 0, RegistryError::InvalidMachine);
        require!(!(is_machine && evo_target != 0), RegistryError::InvalidMachine);
        let economy_key = ctx.accounts.economy.key();
        validate_economy_mint(
            &ctx.accounts.item_mint,
            &economy_key,
            None,
            ctx.accounts.token_program.key(),
        )?;
        let item = &mut ctx.accounts.item_type;
        item.item_id = item_id;
        item.mint = ctx.accounts.item_mint.key();
        item.price_gems = price_gems;
        item.units_per_purchase = units_per_purchase;
        item.active = true;
        item.machine_training = machine_training;
        item.machine_bonus = machine_bonus;
        item.evo_target = evo_target;
        item.max_placed = 0;
        item.max_props = 0;
        item.bump = ctx.bumps.item_type;
        Ok(())
    }

    /// Registers a habitat kind (no shared mint: every habitat is its own 1/1 NFT). A price of 0
    /// is the starter habitat, which each wallet can claim once.
    pub fn create_habitat_type(
        ctx: Context<CreateHabitatType>,
        item_id: u16,
        price_gems: u64,
        max_placed: u8,
        max_props: u8,
    ) -> Result<()> {
        require!(
            max_placed > 0
                && usize::from(max_placed) <= MAX_PLACED_SLOTS
                && max_props > 0
                && usize::from(max_props) <= MAX_PROP_SLOTS,
            RegistryError::InvalidLayout
        );
        let item = &mut ctx.accounts.item_type;
        item.item_id = item_id;
        item.mint = Pubkey::default();
        item.price_gems = price_gems;
        item.units_per_purchase = 1;
        item.active = true;
        item.machine_training = NO_MACHINE;
        item.machine_bonus = 0;
        item.evo_target = 0;
        item.max_placed = max_placed;
        item.max_props = max_props;
        item.bump = ctx.bumps.item_type;
        Ok(())
    }

    pub fn update_item_type(
        ctx: Context<UpdateItemType>,
        price_gems: u64,
        active: bool,
    ) -> Result<()> {
        require!(price_gems > 0, RegistryError::InvalidQuantity);
        ctx.accounts.item_type.price_gems = price_gems;
        ctx.accounts.item_type.active = active;
        Ok(())
    }

    /// Player pays SOL to the treasury and receives gems.
    pub fn buy_gems(ctx: Context<BuyGems>, pack_id: u8) -> Result<()> {
        require!(usize::from(pack_id) < MAX_GEM_PACKS, RegistryError::InvalidQuantity);
        let pack = ctx.accounts.economy.gem_packs[usize::from(pack_id)];
        require!(pack.gems > 0 && pack.price_lamports > 0, RegistryError::PackInactive);

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            pack.price_lamports,
        )?;

        let bump = [ctx.accounts.economy.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[b"economy3", &bump]];
        mint_to(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.gem_mint.to_account_info(),
                    to: ctx.accounts.owner_gem_account.to_account_info(),
                    authority: ctx.accounts.economy.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            pack.gems,
        )?;
        emit!(GemsPurchased {
            owner: ctx.accounts.owner.key(),
            pack_id,
            gems: pack.gems,
            price_lamports: pack.price_lamports,
        });
        Ok(())
    }

    /// Player burns gems (fixed catalog price) and receives item units.
    pub fn buy_item(ctx: Context<BuyItem>, quantity: u16) -> Result<()> {
        require!(
            quantity >= 1 && quantity <= MAX_PURCHASE_QUANTITY,
            RegistryError::InvalidQuantity
        );
        let item = &ctx.accounts.item_type;
        require!(item.active, RegistryError::ItemInactive);
        require!(item.mint != Pubkey::default(), RegistryError::WrongCurrency);
        let cost = item
            .price_gems
            .checked_mul(u64::from(quantity))
            .ok_or(RegistryError::MathOverflow)?;
        let units = u64::from(item.units_per_purchase)
            .checked_mul(u64::from(quantity))
            .ok_or(RegistryError::MathOverflow)?;
        require!(
            ctx.accounts.owner_gem_account.amount >= cost,
            RegistryError::InsufficientGems
        );

        burn(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Burn {
                    mint: ctx.accounts.gem_mint.to_account_info(),
                    from: ctx.accounts.owner_gem_account.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            cost,
        )?;

        let bump = [ctx.accounts.economy.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[b"economy3", &bump]];
        mint_to(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.item_mint.to_account_info(),
                    to: ctx.accounts.owner_item_account.to_account_info(),
                    authority: ctx.accounts.economy.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            units,
        )?;
        emit!(ItemPurchased {
            owner: ctx.accounts.owner.key(),
            item_id: item.item_id,
            quantity,
            gems_spent: cost,
            units,
        });
        Ok(())
    }

    // ---------------------------------------------------------------------
    // Food, daily ration and quests. Food is a set of small counters inside the
    // player's own profile: free to earn, paid for with Gems, never a token.
    // ---------------------------------------------------------------------

    /// Sets the food economy: meals of each plain food in the daily ration (0 = off) and the Gem
    /// price of one meal for every food (meat, plants, fish, fruit) and tier (index type * 4 + tier).
    pub fn set_food(
        ctx: Context<AdminEconomy>,
        ration_units: u8,
        prices: [u64; FOOD_SLOTS],
    ) -> Result<()> {
        require!(prices.iter().all(|p| *p > 0), RegistryError::InvalidQuantity);
        let economy = &mut ctx.accounts.economy;
        economy.ration_units = ration_units;
        economy.food_prices = prices;
        Ok(())
    }

    /// Player burns Gems and gets `amount` meals of one food and tier added to their profile.
    pub fn buy_food(ctx: Context<BuyFood>, food_type: u8, tier: u8, amount: u16) -> Result<()> {
        require!(usize::from(food_type) < FOOD_TYPES, RegistryError::InvalidFood);
        require!(usize::from(tier) < FOOD_TIERS, RegistryError::InvalidFood);
        require!(
            amount >= 1 && amount <= MAX_PURCHASE_QUANTITY,
            RegistryError::InvalidQuantity
        );
        let slot = usize::from(food_type) * FOOD_TIERS + usize::from(tier);
        let price = ctx.accounts.economy.food_prices[slot];
        require!(price > 0, RegistryError::ItemInactive);
        let cost = price
            .checked_mul(u64::from(amount))
            .ok_or(RegistryError::MathOverflow)?;
        require!(
            ctx.accounts.owner_gem_account.amount >= cost,
            RegistryError::InsufficientGems
        );
        burn(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Burn {
                    mint: ctx.accounts.gem_mint.to_account_info(),
                    from: ctx.accounts.owner_gem_account.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            cost,
        )?;
        let food = &mut ctx.accounts.player_profile.food[slot];
        *food = food.checked_add(amount).ok_or(RegistryError::MathOverflow)?;
        emit!(FoodPurchased {
            owner: ctx.accounts.owner.key(),
            food_type,
            tier,
            meals: amount,
            gems_spent: cost,
        });
        Ok(())
    }

    /// Once per UTC day: adds the free ration (all four foods) to the player's profile.
    pub fn claim_daily_ration(ctx: Context<ClaimDailyRation>) -> Result<()> {
        let units = ctx.accounts.economy.ration_units;
        require!(units > 0, RegistryError::RationNotConfigured);
        let day = game_day(Clock::get()?.unix_timestamp);
        let profile = &mut ctx.accounts.player_profile;
        require!(profile.ration_day < day, RegistryError::RationAlreadyClaimed);
        profile.ration_day = day;
        for food_type in 0..FOOD_TYPES {
            let slot = food_type * FOOD_TIERS;
            profile.food[slot] = profile.food[slot].saturating_add(u16::from(units));
        }
        emit!(RationClaimed {
            owner: ctx.accounts.owner.key(),
            day,
            units,
        });
        Ok(())
    }

    /// Claims the meals of one of today's quests once the program has counted
    /// enough of the matching actions (feed, play, care, rest, train) today.
    pub fn claim_quest(ctx: Context<ClaimQuest>, slot: u8) -> Result<()> {
        require!(usize::from(slot) < QUESTS_PER_DAY, RegistryError::InvalidQuest);
        let day = game_day(Clock::get()?.unix_timestamp);
        let (kind, target, meals) = quest_for(day, usize::from(slot));
        let food_type = quest_food(day, usize::from(slot));
        let profile = &mut ctx.accounts.player_profile;
        require!(profile.quest_day == day, RegistryError::QuestNotComplete);
        require!(
            profile.counts[usize::from(kind)] >= target,
            RegistryError::QuestNotComplete
        );
        let bit = 1u8 << slot;
        require!(profile.claimed & bit == 0, RegistryError::QuestAlreadyClaimed);
        profile.claimed |= bit;
        let food_slot = food_type * FOOD_TIERS;
        profile.food[food_slot] = profile.food[food_slot].saturating_add(u16::from(meals));
        emit!(QuestClaimed {
            owner: ctx.accounts.owner.key(),
            day,
            slot,
            food_type: food_type as u8,
            meals,
        });
        Ok(())
    }

    /// Creates a habitat as its own 1/1 Token-2022 NFT. The layout (where the Rebyters and
    /// objects stand) lives inside the NFT's metadata, so it travels with the habitat. A free
    /// habitat type is the starter pack: claimable once per wallet, it also gives the first
    /// meals. Other habitats cost Gems. The new habitat becomes the active one.
    pub fn create_habitat(
        ctx: Context<CreateHabitat>,
        item_id: u16,
        name: String,
        metadata_uri: String,
    ) -> Result<()> {
        let item = &ctx.accounts.item_type;
        require!(item.active && item.mint == Pubkey::default(), RegistryError::ItemInactive);
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
        let price = item.price_gems;
        let mint_key = ctx.accounts.mint.key();
        if price == 0 {
            let profile = &mut ctx.accounts.player_profile;
            require!(!profile.starter_claimed, RegistryError::StarterClaimed);
            profile.starter_claimed = true;
            for food_type in 0..FOOD_TYPES {
                profile.food[food_type * FOOD_TIERS] = STARTER_MEALS;
            }
        } else {
            let gems = ctx
                .accounts
                .owner_gem_account
                .as_ref()
                .ok_or(RegistryError::InsufficientGems)?;
            require!(gems.amount >= price, RegistryError::InsufficientGems);
            burn(
                CpiContext::new(
                    ctx.accounts.token_program.key(),
                    Burn {
                        mint: ctx.accounts.gem_mint.to_account_info(),
                        from: gems.to_account_info(),
                        authority: ctx.accounts.owner.to_account_info(),
                    },
                ),
                price,
            )?;
        }
        ctx.accounts.player_profile.active_habitat = mint_key;

        let blank = to_hex(&BLANK_LAYOUT);
        let additional_metadata = vec![
            ("HABITAT".to_string(), item_id.to_string()),
            ("LAYOUT".to_string(), blank),
        ];
        let final_metadata = TokenMetadata {
            name: name.clone(),
            symbol: "HBTT".to_string(),
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

        let bump = ctx.bumps.habitat_authority;
        let signer_seeds: &[&[&[u8]]] = &[&[b"habitat_authority", mint_key.as_ref(), &[bump]]];
        token_metadata_initialize(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TokenMetadataInitialize {
                    program_id: ctx.accounts.token_program.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    metadata: ctx.accounts.mint.to_account_info(),
                    mint_authority: ctx.accounts.habitat_authority.to_account_info(),
                    update_authority: ctx.accounts.habitat_authority.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            name,
            "HBTT".to_string(),
            metadata_uri,
        )?;
        for (key, value) in additional_metadata {
            token_metadata_update_field(
                CpiContext::new(
                    ctx.accounts.token_program.key(),
                    TokenMetadataUpdateField {
                        program_id: ctx.accounts.token_program.to_account_info(),
                        metadata: ctx.accounts.mint.to_account_info(),
                        update_authority: ctx.accounts.habitat_authority.to_account_info(),
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
                    authority: ctx.accounts.habitat_authority.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            1,
        )?;
        anchor_spl::token_2022::set_authority(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SetAuthority {
                    current_authority: ctx.accounts.habitat_authority.to_account_info(),
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            AuthorityType::MintTokens,
            None,
        )?;
        emit!(HabitatCreated {
            owner: ctx.accounts.owner.key(),
            mint: mint_key,
            item_id,
        });
        Ok(())
    }

    /// Saves the layout inside the habitat NFT: which Rebyters stand where and where each
    /// object is. Nothing here has economic value; what is *owned* is read from the wallet
    /// when the habitat is shown.
    pub fn set_habitat_layout(
        ctx: Context<HabitatLayout>,
        placed: Vec<PlacedSlot>,
        props: Vec<PropSlot>,
    ) -> Result<()> {
        // The island's own limits come from its kind, fixed when the kind was registered.
        let item = &ctx.accounts.item_type;
        require!(
            placed.len() <= usize::from(item.max_placed) && props.len() <= usize::from(item.max_props),
            RegistryError::InvalidLayout
        );
        for prop in props.iter() {
            require!(prop.kind < PROP_KINDS && prop.h > 0, RegistryError::InvalidLayout);
        }
        for (n, slot) in placed.iter().enumerate() {
            require!(slot.mint != Pubkey::default(), RegistryError::InvalidLayout);
            require!(
                !placed[..n].iter().any(|other| other.mint == slot.mint),
                RegistryError::InvalidLayout
            );
        }
        let value = to_hex(&encode_layout(&placed, &props));

        // The field grows (or shrinks): pre-fund the mint for the new metadata size, paid by the owner.
        let required_lamports = {
            let mint_info = ctx.accounts.mint.to_account_info();
            let data = mint_info.try_borrow_data()?;
            let state = PodStateWithExtensions::<PodMint>::unpack(&data)
                .map_err(|_| error!(RegistryError::InvalidMetadata))?;
            let mut metadata = state
                .get_variable_len_extension::<TokenMetadata>()
                .map_err(|_| error!(RegistryError::InvalidMetadata))?;
            // The HABITAT field (only this program can write it) says which kind of island this is.
            let kind = metadata
                .additional_metadata
                .iter()
                .find(|(key, _)| key == "HABITAT")
                .map(|(_, value)| value.as_str())
                .ok_or_else(|| error!(RegistryError::InvalidMetadata))?;
            require!(
                kind == ctx.accounts.item_type.item_id.to_string(),
                RegistryError::InvalidLayout
            );
            metadata.update(Field::Key("LAYOUT".to_string()), value.clone());
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
        let bump = ctx.bumps.habitat_authority;
        let signer_seeds: &[&[&[u8]]] = &[&[b"habitat_authority", mint_key.as_ref(), &[bump]]];
        token_metadata_update_field(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TokenMetadataUpdateField {
                    program_id: ctx.accounts.token_program.to_account_info(),
                    metadata: ctx.accounts.mint.to_account_info(),
                    update_authority: ctx.accounts.habitat_authority.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            Field::Key("LAYOUT".to_string()),
            value,
        )
    }

    /// Chooses which habitat in the wallet is the one shown when the game opens.
    pub fn select_habitat(ctx: Context<SelectHabitat>) -> Result<()> {
        ctx.accounts.player_profile.active_habitat = ctx.accounts.mint.key();
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
            ctx.accounts.player_profile.bump = ctx.bumps.player_profile;
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

        // The only custom TokenMetadata field is DNA.
        // DNA deliberately stores only the current visible gameplay state.
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
        let dna_blob = pack_rebyter_dna(
            evolution_id as u16,
            10,
            0,
            0,
            0,
            70,
            100,
            0,
            [0; 4],
            [0; 4],
            0,
            100,
            20,
            20,
            20,
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

    /// Feed with one of four food groups (0 meat, 1 plant, 2 fish, 3 fruit) and one of four
    /// tiers (0 plain .. 3 feast). Uses up one meal of that food and tier from the profile.
    pub fn feed(ctx: Context<InteractRebyter>, food_type: u8, tier: u8) -> Result<()> {
        require!(usize::from(food_type) < FOOD_TYPES, RegistryError::InvalidFood);
        require!(usize::from(tier) < FOOD_TIERS, RegistryError::InvalidFood);
        let meals = &mut ctx.accounts.player_profile.food[usize::from(food_type) * FOOD_TIERS + usize::from(tier)];
        require!(*meals > 0, RegistryError::NoFood);
        *meals -= 1;
        interact_with(&ctx.accounts, InteractionKind::Feed(food_type, tier))?;
        record_action(&mut ctx.accounts.player_profile, ACTION_FEED)
    }

    /// Play builds bond and a little speed while consuming energy/fullness.
    pub fn play(ctx: Context<InteractRebyter>) -> Result<()> {
        interact_with(&ctx.accounts, InteractionKind::Play)?;
        record_action(&mut ctx.accounts.player_profile, ACTION_PLAY)
    }

    /// Care strengthens bond and helps a well-rested Rebyter recover from bad conditions.
    pub fn care(ctx: Context<InteractRebyter>) -> Result<()> {
        interact_with(&ctx.accounts, InteractionKind::Care)?;
        record_action(&mut ctx.accounts.player_profile, ACTION_CARE)
    }

    /// Rest restores energy. It is not a cooldown: it is a player action and can
    /// be used whenever desired, but it gives no stat farming advantage.
    pub fn rest(ctx: Context<InteractRebyter>) -> Result<()> {
        interact_with(&ctx.accounts, InteractionKind::Rest)?;
        record_action(&mut ctx.accounts.player_profile, ACTION_REST)
    }

    /// Train with one of six trainings:
    /// 0 power, 1 endurance, 2 defense, 3 speed, 4 combat, 5 balanced.
    /// Everyone trains at the normal rate. A specialised machine of the matching training held in
    /// the wallet (pass its item type and token account) adds its bonus to the gains.
    pub fn train(ctx: Context<TrainRebyter>, training_type: u8) -> Result<()> {
        require!(training_type < 6, RegistryError::InvalidTraining);
        let bonus = match (&ctx.accounts.item_type, &ctx.accounts.machine_account) {
            (None, None) => 0,
            (Some(item), Some(held)) => {
                require!(
                    item.active
                        && item.machine_training == training_type
                        && held.mint == item.mint
                        && held.amount >= 1,
                    RegistryError::InvalidMachine
                );
                item.machine_bonus
            }
            _ => return err!(RegistryError::InvalidMachine),
        };
        {
            let accounts = &ctx.accounts;
            let (mint, authority, token_program) = (
                accounts.mint.to_account_info(),
                accounts.rebyter_authority.to_account_info(),
                accounts.token_program.to_account_info(),
            );
            apply_interaction(
                &Target { owner: accounts.owner.key(), mint: &mint, rebyter_authority: &authority, token_program: &token_program },
                InteractionKind::Train(training_type, bonus),
            )?;
        }
        record_action(&mut ctx.accounts.player_profile, ACTION_TRAIN)
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

        // current DNA is not pinned to a historical atlas version. Evolutions are
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

        // current DNA starts from unified atlas proofs only.
        require!(ctx.accounts.rule_set.key() == ctx.accounts.tree.key(), RegistryError::InvalidRule);
        let rules_root = ctx.accounts.tree.merkle_root;
        require!(
            merkle::verify_evolution_hash_proof(leaf, &proof, &rules_root),
            RegistryError::InvalidEvolutionProof
        );
        msg!("evolve: rule proof verified");
        match (
            &ctx.accounts.item_type,
            &ctx.accounts.item_mint,
            &ctx.accounts.owner_item_account,
        ) {
            (None, None, None) => {
                require!(
                    evaluate_compact_rule(&rule_bytes, &dna, clock.unix_timestamp.max(0) as u32)?,
                    RegistryError::EvolutionRequirements
                );
                msg!("evolve: rule requirements verified");
            }
            (Some(item), Some(item_mint), Some(held)) => {
                require!(
                    item.active
                        && item.evo_target == target_id
                        && item_mint.key() == item.mint
                        && held.mint == item.mint
                        && held.amount >= 1,
                    RegistryError::InvalidEvolutionItem
                );
                burn(
                    CpiContext::new(
                        ctx.accounts.token_program.key(),
                        Burn {
                            mint: item_mint.to_account_info(),
                            from: held.to_account_info(),
                            authority: ctx.accounts.owner.to_account_info(),
                        },
                    ),
                    1,
                )?;
                msg!("evolve: evolution item used");
            }
            _ => return err!(RegistryError::InvalidEvolutionItem),
        }

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
        dna.care_mistakes = 0;
        dna.diet = [0; 4];
        dna.time_interactions = [0; 4];
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
    Feed(u8, u8),
    Play,
    Care,
    Rest,
    Train(u8, u8),
}

#[derive(Clone)]
struct RebyterDna {
    evolution_id: u16,
    weight: u8,
    bond: u8,
    discipline: u8,
    care_mistakes: u8,
    fullness: u8,
    energy: u8,
    condition: u8,
    diet: [u16; 4],
    time_interactions: [u16; 4],
    cycle: u8,
    hp: u16,
    atk: u16,
    def: u16,
    spd: u16,
    last_state_at: u32,
    stage_entered_at: u32,
    learned_skills: u64,
}

impl RebyterDna {
    fn decode(bytes: &[u8]) -> Result<Self> {
        require!(
            bytes.len() == REBYTER_DNA_BYTES,
            RegistryError::UnsupportedDna
        );
        let mut o = 0usize;
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
        let weight = take_u8(bytes, &mut o);
        let bond = take_u8(bytes, &mut o);
        let discipline = take_u8(bytes, &mut o);
        let care_mistakes = take_u8(bytes, &mut o);
        let fullness = take_u8(bytes, &mut o);
        let energy = take_u8(bytes, &mut o);
        let condition = take_u8(bytes, &mut o);
        let mut diet = [0u16; 4];
        for value in diet.iter_mut() { *value = take_u16(bytes, &mut o); }
        let mut time_interactions = [0u16; 4];
        for value in time_interactions.iter_mut() { *value = take_u16(bytes, &mut o); }
        let cycle = take_u8(bytes, &mut o);
        let hp = take_u16(bytes, &mut o);
        let atk = take_u16(bytes, &mut o);
        let def = take_u16(bytes, &mut o);
        let spd = take_u16(bytes, &mut o);
        let last_state_at = take_u32(bytes, &mut o);
        let stage_entered_at = take_u32(bytes, &mut o);
        let learned_skills = take_u64(bytes, &mut o);

        Ok(Self {
            evolution_id, weight, bond, discipline, care_mistakes, fullness,
            energy, condition, diet, time_interactions, cycle,
            hp, atk, def, spd, last_state_at, stage_entered_at,
            learned_skills,
        })
    }

    fn encode(&self) -> Vec<u8> {
        pack_rebyter_dna(
            self.evolution_id, self.weight, self.bond,
            self.discipline, self.care_mistakes, self.fullness, self.energy, self.condition,
            self.diet, self.time_interactions,
            self.cycle, self.hp, self.atk, self.def, self.spd,
            self.last_state_at, self.stage_entered_at,
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

fn has_condition(dna: &RebyterDna, flag: u8) -> bool { dna.condition & flag != 0 }
fn add_condition(dna: &mut RebyterDna, flag: u8) { dna.condition |= flag; }
fn clear_condition(dna: &mut RebyterDna, flag: u8) { dna.condition &= !flag; }
fn add_care_mistake(dna: &mut RebyterDna) {
    dna.care_mistakes = dna.care_mistakes.saturating_add(1);
}

fn materialize_lazy_state(dna: &mut RebyterDna, now: u32) {
    if now <= dna.last_state_at { return; }
    let hours = now.saturating_sub(dna.last_state_at) / 3_600;
    if hours == 0 { return; }

    dna.fullness = dna.fullness.saturating_sub(
        hours.saturating_mul(2).min(100) as u8
    );
    dna.energy = dna.energy.saturating_add(
        hours.saturating_mul(3).min(100) as u8
    ).min(100);

    if dna.fullness <= 80 { clear_condition(dna, CONDITION_OVERFED); }
    if dna.energy >= 40 { clear_condition(dna, CONDITION_TIRED); }
    if dna.fullness == 0 && hours >= 12 && !has_condition(dna, CONDITION_SICK) {
        add_condition(dna, CONDITION_SICK);
        add_care_mistake(dna);
    }
    dna.last_state_at = now;
}

fn read_rebyter_dna(mint: &AccountInfo<'_>) -> Result<RebyterDna> {
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
    RebyterDna::decode(&bytes)
}

fn scaled_gain(base: u16, tier: u8) -> u16 {
    match tier { 2 => base, 1 => base.saturating_add(1) / 2, _ => 0 }
}

fn maybe_unlock_training_skill(dna: &mut RebyterDna, training_type: u8, full_effect: bool) {
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

/// Counts a finished action for today's quests in the player's profile.
fn record_action(profile: &mut Account<'_, PlayerProfile>, kind: usize) -> Result<()> {
    let day = game_day(Clock::get()?.unix_timestamp);
    profile.record(kind, day);
    Ok(())
}

fn interact_with(accounts: &InteractRebyter<'_>, kind: InteractionKind) -> Result<()> {
    let (mint, authority, token_program) = (
        accounts.mint.to_account_info(),
        accounts.rebyter_authority.to_account_info(),
        accounts.token_program.to_account_info(),
    );
    apply_interaction(
        &Target { owner: accounts.owner.key(), mint: &mint, rebyter_authority: &authority, token_program: &token_program },
        kind,
    )
}

/// The accounts every interaction needs to rewrite a Rebyter's DNA.
struct Target<'a, 'info> {
    owner: Pubkey,
    mint: &'a AccountInfo<'info>,
    rebyter_authority: &'a AccountInfo<'info>,
    token_program: &'a AccountInfo<'info>,
}

fn apply_interaction(accounts: &Target<'_, '_>, kind: InteractionKind) -> Result<()> {
    let mut dna = read_rebyter_dna(accounts.mint)?;
    let clock = Clock::get()?;
    let now = clock.unix_timestamp.max(0) as u32;
    materialize_lazy_state(&mut dna, now);

    match kind {
        InteractionKind::Feed(food_type, food_tier) => {
            let i = usize::from(food_type);
            let pct = FOOD_TIER_PCT[usize::from(food_tier)];
            let was_overfed = has_condition(&dna, CONDITION_OVERFED) || dna.fullness >= 90;
            let fullness_gain = (u16::from([22u8, 16, 18, 14][i]) * pct / 100) as u8;
            let base_weight = [2u8, 1, 1, 1][i];
            let weight_gain = (u16::from(base_weight) * pct / 100).max(1) as u8;
            dna.diet[i] = dna.diet[i].saturating_add(FOOD_TIER_DIET[usize::from(food_tier)]);
            dna.fullness = dna.fullness.saturating_add(fullness_gain).min(100);
            dna.weight = dna.weight.saturating_add(weight_gain);
            dna.energy = dna.energy.saturating_add(4).min(100);
            if dna.fullness < 80 && !was_overfed {
                dna.bond = dna.bond.saturating_add(1).min(100);
            }
            if was_overfed {
                add_care_mistake(&mut dna);
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
                dna.bond = dna.bond.saturating_add(3).min(100);
            } else {
                // The action is allowed, but forcing play while depleted is a care mistake.
                add_care_mistake(&mut dna);
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
                dna.bond = dna.bond.saturating_add(4).min(100);
            } else {
                // Care on a depleted companion does not farm Bond.
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
                // Unnecessary rest while starving hurts routine, but Rest itself is not a care mistake.
                dna.discipline = dna.discipline.saturating_sub(1);
            }
            if dna.energy >= 40 { clear_condition(&mut dna, CONDITION_TIRED); }
            if dna.energy >= 70 && dna.fullness >= 20 && !has_condition(&dna, CONDITION_OVERFED) {
                clear_condition(&mut dna, CONDITION_SICK);
            }
            if dna.energy >= 85 { clear_condition(&mut dna, CONDITION_INJURED); }
            if fullness_before == 0 { add_condition(&mut dna, CONDITION_SICK); }
        }
        InteractionKind::Train(training_type, machine_bonus) => {
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
            let boosted = |gain: u16| {
                let g = scaled_gain(gain, tier);
                (g * (100 + u16::from(machine_bonus)) + 99) / 100
            };
            dna.hp = dna.hp.saturating_add(boosted(hp_gain));
            dna.atk = dna.atk.saturating_add(boosted(atk_gain));
            dna.def = dna.def.saturating_add(boosted(def_gain));
            dna.spd = dna.spd.saturating_add(boosted(spd_gain));
            dna.energy = dna.energy.saturating_sub(energy_cost);
            dna.fullness = dna.fullness.saturating_sub(6);
            dna.weight = dna.weight.saturating_sub(weight_loss);
            if tier > 0 {
                dna.discipline = dna.discipline.saturating_add(if training_type == 4 { 2 } else { 1 }).min(100);
            } else {
                add_care_mistake(&mut dna);
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
    dna.last_state_at = now;

    let dna_base58 = bs58::encode(dna.encode()).into_string();
    let mint_key = accounts.mint.key();
    let (_, bump) = Pubkey::find_program_address(&[b"rebyter_authority", mint_key.as_ref()], &crate::ID);
    let signer_seeds: &[&[&[u8]]] = &[&[b"rebyter_authority", mint_key.as_ref(), &[bump]]];
    token_metadata_update_field(
        CpiContext::new(
            accounts.token_program.key(),
            TokenMetadataUpdateField {
                program_id: accounts.token_program.clone(),
                metadata: accounts.mint.clone(),
                update_authority: accounts.rebyter_authority.clone(),
            },
        ).with_signer(signer_seeds),
        Field::Key("DNA".to_string()),
        dna_base58,
    )?;

    emit!(RebyterInteraction {
        owner: accounts.owner,
        mint: mint_key,
        action: match kind {
            InteractionKind::Feed(..) => 0,
            InteractionKind::Play => 1,
            InteractionKind::Care => 2,
            InteractionKind::Rest => 3,
            InteractionKind::Train(..) => 4,
        },
        time_bucket: bucket as u8,
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

fn metric_value(metric: u8, dna: &RebyterDna, now: u32) -> Result<u16> {
    let diet_total: u32 = dna.diet.iter().map(|v| u32::from(*v)).sum();
    let time_total: u32 = dna.time_interactions.iter().map(|v| u32::from(*v)).sum();
    let value = match metric {
        0 => percentage(dna.diet[0], diet_total),
        1 => percentage(dna.diet[2], diet_total),
        2 => percentage(dna.diet[1], diet_total),
        3 => percentage(dna.diet[3], diet_total),
        4 => percentage(dna.time_interactions[1], time_total),
        5 => percentage(dna.time_interactions[2], time_total),
        6 => percentage(dna.time_interactions[3], time_total),
        7 => percentage(dna.time_interactions[0], time_total),
        8 => u16::from(dna.weight),
        9 => u16::from(dna.bond),
        10 => u16::from(dna.discipline),
        11 => u16::from(dna.care_mistakes),
        12 => u16::from(dna.fullness),
        13 => u16::from(dna.energy),
        14 => u16::from(dna.cycle),
        15 => ((now.saturating_sub(dna.stage_entered_at)) / 60).min(u16::MAX as u32) as u16,
        16 => dna.hp,
        17 => dna.atk,
        18 => dna.def,
        19 => dna.spd,
        20 => if has_condition(dna, CONDITION_SICK) { 1 } else { 0 },
        21 => if has_condition(dna, CONDITION_INJURED) { 1 } else { 0 },
        22 => dna.learned_skills.count_ones().min(u16::MAX as u32) as u16,
        _ => return err!(RegistryError::InvalidRule),
    };
    Ok(value)
}

fn condition_passes(cursor: &mut RuleCursor<'_>, dna: &RebyterDna, now: u32) -> Result<bool> {
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

fn evaluate_compact_rule(bytes: &[u8], dna: &RebyterDna, now: u32) -> Result<bool> {
    let mut cursor = RuleCursor::new(bytes);
    require!(cursor.u8()? == 1, RegistryError::InvalidRule);
    let required_groups = cursor.u8()?;
    let group_count = cursor.u8()?;
    require!(group_count <= 6 && required_groups <= group_count, RegistryError::InvalidRule);

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

fn pack_rebyter_dna(
    evolution_id: u16,
    weight: u8,
    bond: u8,
    discipline: u8,
    care_mistakes: u8,
    fullness: u8,
    energy: u8,
    condition: u8,
    diet: [u16; 4],
    time_interactions: [u16; 4],
    cycle: u8,
    hp: u16,
    atk: u16,
    def: u16,
    spd: u16,
    last_state_at: u32,
    stage_entered_at: u32,
    learned_skills: u64,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(REBYTER_DNA_BYTES);
    out.extend_from_slice(&evolution_id.to_le_bytes());
    out.push(weight);
    out.push(bond);
    out.push(discipline);
    out.push(care_mistakes);
    out.push(fullness);
    out.push(energy);
    out.push(condition);
    for value in diet { out.extend_from_slice(&value.to_le_bytes()); }
    for value in time_interactions { out.extend_from_slice(&value.to_le_bytes()); }
    out.push(cycle);
    out.extend_from_slice(&hp.to_le_bytes());
    out.extend_from_slice(&atk.to_le_bytes());
    out.extend_from_slice(&def.to_le_bytes());
    out.extend_from_slice(&spd.to_le_bytes());
    out.extend_from_slice(&last_state_at.to_le_bytes());
    out.extend_from_slice(&stage_entered_at.to_le_bytes());
    out.extend_from_slice(&learned_skills.to_le_bytes());
    debug_assert_eq!(out.len(), REBYTER_DNA_BYTES);
    out
}

fn family_index(id: u8) -> Result<usize> {
    require!(id < 8, RegistryError::Family);
    Ok(usize::from(id))
}

/// The one per-wallet account: pokedex discoveries, food counters and the small fixed-size daily
/// state (ration day, quest counters). Fixed fields come first; only `discoveries` ever grows.
#[account]
pub struct PlayerProfile {
    pub owner: Pubkey,
    pub created_at: i64,
    /// Game day of the last claimed ration (0 = never).
    pub ration_day: u32,
    /// Game day the counters below belong to.
    pub quest_day: u32,
    /// Actions done on `quest_day`: feed, play, care, rest, train (saturating).
    pub counts: [u8; 5],
    /// Bit i set = quest slot i already claimed on `quest_day`.
    pub claimed: u8,
    pub bump: u8,
    /// True once the starter habitat (and its first meals) was claimed.
    pub starter_claimed: bool,
    /// The habitat NFT shown when the game opens (default key = none yet).
    pub active_habitat: Pubkey,
    /// Meals in stock, index food type * 4 + tier (meat, plants, fish, fruit; plain to feast).
    pub food: [u16; FOOD_SLOTS],
    pub discoveries: Vec<u16>,
}

/// A Rebyter in the habitat: its mint and tile.
#[derive(Clone, Copy, Default, AnchorSerialize, AnchorDeserialize, InitSpace)]
pub struct PlacedSlot {
    pub mint: Pubkey,
    pub i: u8,
    pub j: u8,
}

/// An object in the habitat. Position and size are fixed-point (value * 1000), rotation is a
/// fraction of a turn in 1/65535.
#[derive(Clone, Copy, Default, AnchorSerialize, AnchorDeserialize, InitSpace)]
pub struct PropSlot {
    pub kind: u8,
    pub x: i16,
    pub z: i16,
    pub h: u16,
    pub r: u16,
}

/// Largest layout any habitat can hold (the app limits each habitat by its size).
pub const MAX_PLACED_SLOTS: usize = 8;
pub const MAX_PROP_SLOTS: usize = 40;
/// How many object kinds the client knows (the palette order is part of the format).
pub const PROP_KINDS: u8 = 11;

impl PlayerProfile {
    // Anchor discriminator + owner + created_at + ration_day + quest_day + counts + claimed + bump
    // + starter flag + active habitat + food + Vec length prefix.
    pub const FIXED_SPACE: usize = 8 + 32 + 8 + 4 + 4 + 5 + 1 + 1 + 1 + 32 + FOOD_SLOTS * 2 + 4;

    pub fn space_for(discoveries: usize) -> usize {
        Self::FIXED_SPACE.saturating_add(discoveries.saturating_mul(2))
    }

    pub fn record(&mut self, kind: usize, day: u32) {
        if self.quest_day != day {
            self.quest_day = day;
            self.counts = [0; 5];
            self.claimed = 0;
        }
        self.counts[kind] = self.counts[kind].saturating_add(1);
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
        seeds = [b"profile4", owner.key().as_ref()],
        bump
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
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
        seeds = [b"profile4", owner.key().as_ref()],
        bump
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
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
#[instruction(item_id: u16)]
pub struct CreateHabitatType<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"registry"], bump, has_one = authority)]
    pub registry: Account<'info, RegistryRoot>,
    #[account(
        init,
        payer = authority,
        space = 8 + ItemType::INIT_SPACE,
        seeds = [b"item4", item_id.to_le_bytes().as_ref()],
        bump
    )]
    pub item_type: Account<'info, ItemType>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(item_id: u16)]
pub struct CreateHabitat<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"profile4", owner.key().as_ref()], bump = player_profile.bump, has_one = owner)]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(seeds = [b"economy3"], bump = economy.bump)]
    pub economy: Box<Account<'info, Economy>>,
    #[account(seeds = [b"item4", item_id.to_le_bytes().as_ref()], bump = item_type.bump)]
    pub item_type: Box<Account<'info, ItemType>>,
    #[account(mut, address = economy.gem_mint)]
    pub gem_mint: Box<InterfaceAccount<'info, Mint>>,
    /// Omit (null) for the free starter habitat.
    #[account(mut, token::mint = gem_mint, token::authority = owner, token::token_program = token_program)]
    pub owner_gem_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    /// CHECK: Program-derived authority; it stores no data and only signs Token-2022 CPIs.
    #[account(seeds = [b"habitat_authority", mint.key().as_ref()], bump)]
    pub habitat_authority: UncheckedAccount<'info>,
    /// CHECK: Token-2022 mint initialized by the client in the same transaction; it is the
    /// single account that stores the habitat.
    #[account(mut, owner = token_program.key())]
    pub mint: UncheckedAccount<'info>,
    /// CHECK: Owner ATA initialized by the client in the same transaction.
    #[account(mut, owner = token_program.key())]
    pub owner_token_account: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct HabitatLayout<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// The kind of island this habitat is: it holds the limits.
    #[account(seeds = [b"item4", item_type.item_id.to_le_bytes().as_ref()], bump = item_type.bump)]
    pub item_type: Box<Account<'info, ItemType>>,
    /// CHECK: Token-2022 mint holding the habitat; only our PDA can write its layout.
    #[account(mut, owner = token_program.key())]
    pub mint: UncheckedAccount<'info>,
    #[account(
        constraint = owner_token_account.mint == mint.key() @ RegistryError::NotOwner,
        constraint = owner_token_account.owner == owner.key() @ RegistryError::NotOwner,
        constraint = owner_token_account.amount == 1 @ RegistryError::NotOwner
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: PDA signs the metadata update and stores no data.
    #[account(seeds = [b"habitat_authority", mint.key().as_ref()], bump)]
    pub habitat_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SelectHabitat<'info> {
    pub owner: Signer<'info>,
    /// CHECK: any mint the owner holds one of; the client only shows genuine habitats.
    #[account(owner = token_program.key())]
    pub mint: UncheckedAccount<'info>,
    #[account(
        constraint = owner_token_account.mint == mint.key() @ RegistryError::NotOwner,
        constraint = owner_token_account.owner == owner.key() @ RegistryError::NotOwner,
        constraint = owner_token_account.amount == 1 @ RegistryError::NotOwner
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, seeds = [b"profile4", owner.key().as_ref()], bump = player_profile.bump, has_one = owner)]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct BuyFood<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"economy3"], bump = economy.bump)]
    pub economy: Account<'info, Economy>,
    #[account(mut, seeds = [b"profile4", owner.key().as_ref()], bump = player_profile.bump, has_one = owner)]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(mut, address = economy.gem_mint)]
    pub gem_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = gem_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub owner_gem_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Program<'info, Token2022>,
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
    /// The player's profile: counts the action for today's quests.
    #[account(mut, seeds = [b"profile4", owner.key().as_ref()], bump = player_profile.bump, has_one = owner)]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct TrainRebyter<'info> {
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
    #[account(mut, seeds = [b"profile4", owner.key().as_ref()], bump = player_profile.bump, has_one = owner)]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    /// Optional: the type of the specialised machine the wallet holds (only the program creates these).
    pub item_type: Option<Box<Account<'info, ItemType>>>,
    /// Optional: the wallet's token account of that machine.
    #[account(token::authority = owner, token::token_program = token_program)]
    pub machine_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct EvolveRebyter<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"profile4", owner.key().as_ref()],
        bump,
        has_one = owner
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
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
    /// CHECK: current DNA requires this to be the same address as `tree`; the
    /// unified active atlas root verifies both forms and gameplay rules.
    pub rule_set: UncheckedAccount<'info>,
    /// Optional evolution item: type, mint and the wallet's token account. When given, one unit is
    /// burnt and the item replaces the rule requirements (the path itself must still be in the atlas).
    pub item_type: Option<Box<Account<'info, ItemType>>>,
    #[account(mut)]
    pub item_mint: Option<Box<InterfaceAccount<'info, Mint>>>,
    #[account(mut, token::authority = owner, token::token_program = token_program)]
    pub owner_item_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
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
    #[msg("This interaction requires Rebyter current DNA")]
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
    #[msg("Mint does not meet the economy requirements")]
    InvalidMint,
    #[msg("This gem pack is not for sale")]
    PackInactive,
    #[msg("This item is not for sale")]
    ItemInactive,
    #[msg("Not enough Gems")]
    InsufficientGems,
    #[msg("Invalid quantity or id")]
    InvalidQuantity,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("The daily ration is not configured")]
    RationNotConfigured,
    #[msg("Today's ration was already claimed")]
    RationAlreadyClaimed,
    #[msg("Invalid quest slot")]
    InvalidQuest,
    #[msg("The quest is not complete today")]
    QuestNotComplete,
    #[msg("This quest was already claimed today")]
    QuestAlreadyClaimed,
    #[msg("Not enough Sparks")]
    InsufficientSparks,
    #[msg("You have no food of that kind")]
    NoFood,
    #[msg("The habitat layout is not valid")]
    InvalidLayout,
    #[msg("This item is bought with a different currency")]
    WrongCurrency,
    #[msg("The starter habitat was already claimed")]
    StarterClaimed,
    #[msg("That machine does not fit this training")]
    InvalidMachine,
    #[msg("That item does not evolve this Rebyter into that form")]
    InvalidEvolutionItem,
}

fn mint_is_non_transferable(mint: &InterfaceAccount<Mint>) -> Result<bool> {
    let info = mint.to_account_info();
    let data = info.try_borrow_data()?;
    let state = PodStateWithExtensions::<PodMint>::unpack(&data)
        .map_err(|_| error!(RegistryError::InvalidMint))?;
    Ok(state.get_extension::<NonTransferable>().is_ok())
}

/// Checks a client-created economy mint: Token-2022, 0 decimals, mint authority
/// is the economy PDA and no freeze authority. With `gem == Some(true)` it also
/// requires NonTransferable and the economy PDA as PermanentDelegate.
fn validate_economy_mint(
    mint: &InterfaceAccount<Mint>,
    economy: &Pubkey,
    gem: Option<bool>,
    token_program: Pubkey,
) -> Result<()> {
    require!(*mint.to_account_info().owner == token_program, RegistryError::InvalidMint);
    require!(mint.decimals == 0, RegistryError::InvalidMint);
    require!(
        Option::<Pubkey>::from(mint.mint_authority) == Some(*economy),
        RegistryError::InvalidMint
    );
    require!(mint.freeze_authority.is_none(), RegistryError::InvalidMint);
    if gem == Some(true) {
        let info = mint.to_account_info();
        let data = info.try_borrow_data()?;
        let state = PodStateWithExtensions::<PodMint>::unpack(&data)
            .map_err(|_| error!(RegistryError::InvalidMint))?;
        require!(
            state.get_extension::<NonTransferable>().is_ok(),
            RegistryError::InvalidMint
        );
        let delegate = state
            .get_extension::<PermanentDelegate>()
            .map_err(|_| error!(RegistryError::InvalidMint))?;
        let delegate: Option<Pubkey> = Option::<Pubkey>::from(delegate.delegate);
        require!(delegate == Some(*economy), RegistryError::InvalidMint);
    }
    Ok(())
}

#[derive(Clone, Copy, Default, AnchorSerialize, AnchorDeserialize, InitSpace)]
pub struct GemPack {
    pub gems: u64,
    pub price_lamports: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Economy {
    pub treasury: Pubkey,
    pub gem_mint: Pubkey,
    pub gem_packs: [GemPack; MAX_GEM_PACKS],
    /// Gem price of one meal, index food type * 4 + tier.
    pub food_prices: [u64; FOOD_SLOTS],
    /// Meals of each food in the free daily ration; 0 = off.
    pub ration_units: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ItemType {
    pub item_id: u16,
    pub mint: Pubkey,
    pub price_gems: u64,
    pub units_per_purchase: u16,
    pub active: bool,
    /// Training this item improves (0..6), or NO_MACHINE.
    pub machine_training: u8,
    /// Percent added to the gains of that training.
    pub machine_bonus: u8,
    /// Evolution id this item turns a Rebyter into (0 = not an evolution item).
    pub evo_target: u16,
    /// Habitats only: the most Rebyters and objects this kind of island can hold (0 for other items).
    pub max_placed: u8,
    pub max_props: u8,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitializeEconomy<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"registry"], bump, has_one = authority)]
    pub registry: Account<'info, RegistryRoot>,
    #[account(init, payer = authority, space = 8 + Economy::INIT_SPACE, seeds = [b"economy3"], bump)]
    pub economy: Account<'info, Economy>,
    pub gem_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminEconomy<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"registry"], bump, has_one = authority)]
    pub registry: Account<'info, RegistryRoot>,
    #[account(mut, seeds = [b"economy3"], bump = economy.bump)]
    pub economy: Account<'info, Economy>,
}

#[derive(Accounts)]
#[instruction(item_id: u16)]
pub struct CreateItemType<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"registry"], bump, has_one = authority)]
    pub registry: Account<'info, RegistryRoot>,
    #[account(seeds = [b"economy3"], bump = economy.bump)]
    pub economy: Account<'info, Economy>,
    #[account(
        init,
        payer = authority,
        space = 8 + ItemType::INIT_SPACE,
        seeds = [b"item4", item_id.to_le_bytes().as_ref()],
        bump
    )]
    pub item_type: Account<'info, ItemType>,
    pub item_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateItemType<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"registry"], bump, has_one = authority)]
    pub registry: Account<'info, RegistryRoot>,
    #[account(mut, seeds = [b"item4", item_type.item_id.to_le_bytes().as_ref()], bump = item_type.bump)]
    pub item_type: Account<'info, ItemType>,
}

#[derive(Accounts)]
pub struct BuyGems<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"economy3"], bump = economy.bump)]
    pub economy: Account<'info, Economy>,
    /// CHECK: must equal the treasury stored in the economy account.
    #[account(mut, address = economy.treasury)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut, address = economy.gem_mint)]
    pub gem_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = gem_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub owner_gem_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyItem<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"economy3"], bump = economy.bump)]
    pub economy: Account<'info, Economy>,
    #[account(seeds = [b"item4", item_type.item_id.to_le_bytes().as_ref()], bump = item_type.bump)]
    pub item_type: Account<'info, ItemType>,
    #[account(mut, address = economy.gem_mint)]
    pub gem_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = gem_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub owner_gem_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = item_type.mint)]
    pub item_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = item_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub owner_item_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimDailyRation<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"economy3"], bump = economy.bump)]
    pub economy: Account<'info, Economy>,
    #[account(mut, seeds = [b"profile4", owner.key().as_ref()], bump = player_profile.bump, has_one = owner)]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
}

#[derive(Accounts)]
pub struct ClaimQuest<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"profile4", owner.key().as_ref()], bump = player_profile.bump, has_one = owner)]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
}

#[event]
pub struct RationClaimed {
    pub owner: Pubkey,
    pub day: u32,
    pub units: u8,
}

#[event]
pub struct QuestClaimed {
    pub owner: Pubkey,
    pub day: u32,
    pub slot: u8,
    pub food_type: u8,
    pub meals: u8,
}

#[event]
pub struct FoodPurchased {
    pub owner: Pubkey,
    pub food_type: u8,
    pub tier: u8,
    pub meals: u16,
    pub gems_spent: u64,
}

#[event]
pub struct HabitatCreated {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub item_id: u16,
}

#[event]
pub struct GemsPurchased {
    pub owner: Pubkey,
    pub pack_id: u8,
    pub gems: u64,
    pub price_lamports: u64,
}

#[event]
pub struct ItemPurchased {
    pub owner: Pubkey,
    pub item_id: u16,
    pub quantity: u16,
    pub gems_spent: u64,
    pub units: u64,
}

