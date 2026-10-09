#![allow(dead_code)]
pub use anchor_lang::{
    AccountDeserialize, AccountSerialize,
    prelude::Pubkey,
    solana_program::{instruction::Instruction, system_instruction, system_program},
    InstructionData, ToAccountMetas,
};
pub use anchor_spl::{
    associated_token::{self, get_associated_token_address_with_program_id},
    token_2022::{self, spl_token_2022},
};
pub use litesvm::LiteSVM;
pub use solana_anchor_starter::{accounts, instruction, PlayerProfile, LOADER};
pub use solana_keypair::Keypair;
pub use solana_message::{Message, VersionedMessage};
pub use solana_signer::Signer;
pub use solana_transaction::versioned::VersionedTransaction;
pub use spl_token_2022::{extension::ExtensionType, state::Mint};

pub const PACK_GEMS: u64 = 100;
pub const PACK_PRICE: u64 = 100_000_000; // 0.1 SOL
pub const FOOD_ID: u16 = 1;
pub const FOOD_PRICE_GEMS: u64 = 10;
pub const FOOD_UNITS: u16 = 10;

pub fn program_id() -> Pubkey {
    solana_anchor_starter::ID
}
pub fn registry() -> Pubkey {
    Pubkey::find_program_address(&[b"registry"], &program_id()).0
}
pub fn economy() -> Pubkey {
    Pubkey::find_program_address(&[b"economy3"], &program_id()).0
}
pub fn item_pda(id: u16) -> Pubkey {
    Pubkey::find_program_address(&[b"item3", &id.to_le_bytes()], &program_id()).0
}
pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(owner, mint, &token_2022::ID)
}
pub fn ix(data: impl InstructionData, acc: impl ToAccountMetas) -> Instruction {
    Instruction::new_with_bytes(program_id(), &data.data(), acc.to_account_metas(None))
}
pub fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    extra: &[&Keypair],
    ixs: Vec<Instruction>,
) -> Result<(), String> {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(&ixs, Some(&payer.pubkey()), &svm.latest_blockhash());
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers[..]).unwrap();
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{:?}", e.err))
}
pub fn token_amount(svm: &LiteSVM, account: &Pubkey) -> u64 {
    match svm.get_account(account) {
        Some(a) if a.data.len() >= 72 => u64::from_le_bytes(a.data[64..72].try_into().unwrap()),
        _ => 0,
    }
}
pub fn lamports(svm: &LiteSVM, key: &Pubkey) -> u64 {
    svm.get_account(key).map(|a| a.lamports).unwrap_or(0)
}

/// Creates a Token-2022 mint with 0 decimals and the given extensions.
pub fn create_mint(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Keypair,
    authority: &Pubkey,
    non_transferable: bool,
    delegate: Option<Pubkey>,
) -> Result<(), String> {
    let mut extensions = vec![];
    if non_transferable {
        extensions.push(ExtensionType::NonTransferable);
    }
    if delegate.is_some() {
        extensions.push(ExtensionType::PermanentDelegate);
    }
    let space = ExtensionType::try_calculate_account_len::<Mint>(&extensions).unwrap();
    let rent = svm.minimum_balance_for_rent_exemption(space);
    let mut ixs = vec![system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        rent,
        space as u64,
        &token_2022::ID,
    )];
    if non_transferable {
        ixs.push(
            spl_token_2022::instruction::initialize_non_transferable_mint(
                &token_2022::ID,
                &mint.pubkey(),
            )
            .unwrap(),
        );
    }
    if let Some(delegate) = delegate {
        ixs.push(
            spl_token_2022::instruction::initialize_permanent_delegate(
                &token_2022::ID,
                &mint.pubkey(),
                &delegate,
            )
            .unwrap(),
        );
    }
    ixs.push(
        spl_token_2022::instruction::initialize_mint2(
            &token_2022::ID,
            &mint.pubkey(),
            authority,
            None,
            0,
        )
        .unwrap(),
    );
    send(svm, payer, &[mint], ixs)
}

pub struct World {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub player: Keypair,
    pub other: Keypair,
    pub treasury: Pubkey,
    pub gem_mint: Pubkey,
    pub food_mint: Pubkey,
}

pub fn init_registry(svm: &mut LiteSVM, admin: &Keypair) {
    let program_data = Pubkey::find_program_address(&[program_id().as_ref()], &LOADER).0;
    send(
        svm,
        admin,
        &[],
        vec![ix(
            instruction::InitializeRegistry {},
            accounts::InitializeRegistry {
                authority: admin.pubkey(),
                registry: registry(),
                program_data,
                system_program: system_program::ID,
            },
        )],
    )
    .expect("registry initializes");
}

pub fn init_economy_ix(authority: &Pubkey, gem_mint: &Pubkey, treasury: &Pubkey) -> Instruction {
    ix(
        instruction::InitializeEconomy {
            treasury: *treasury,
        },
        accounts::InitializeEconomy {
            authority: *authority,
            registry: registry(),
            economy: economy(),
            gem_mint: *gem_mint,
            token_program: token_2022::ID,
            system_program: system_program::ID,
        },
    )
}
pub fn set_pack_ix(authority: &Pubkey, pack_id: u8, gems: u64, price: u64) -> Instruction {
    ix(
        instruction::SetGemPack {
            pack_id,
            gems,
            price_lamports: price,
        },
        accounts::AdminEconomy {
            authority: *authority,
            registry: registry(),
            economy: economy(),
        },
    )
}
pub fn create_item_ix(authority: &Pubkey, id: u16, mint: &Pubkey, price: u64, units: u16) -> Instruction {
    create_special_item_ix(authority, id, mint, price, units, solana_anchor_starter::NO_MACHINE, 0, 0)
}
/// A plain item, a training machine (`machine_training`, `machine_bonus`) or an evolution item (`evo_target`).
pub fn create_special_item_ix(
    authority: &Pubkey,
    id: u16,
    mint: &Pubkey,
    price: u64,
    units: u16,
    machine_training: u8,
    machine_bonus: u8,
    evo_target: u16,
) -> Instruction {
    ix(
        instruction::CreateItemType {
            item_id: id,
            price_gems: price,
            units_per_purchase: units,
            machine_training,
            machine_bonus,
            evo_target,
        },
        accounts::CreateItemType {
            authority: *authority,
            registry: registry(),
            economy: economy(),
            item_type: item_pda(id),
            item_mint: *mint,
            token_program: token_2022::ID,
            system_program: system_program::ID,
        },
    )
}
pub fn update_item_ix(authority: &Pubkey, id: u16, price: u64, active: bool) -> Instruction {
    ix(
        instruction::UpdateItemType {
            price_gems: price,
            active,
        },
        accounts::UpdateItemType {
            authority: *authority,
            registry: registry(),
            item_type: item_pda(id),
        },
    )
}
pub fn buy_gems_ix(owner: &Pubkey, gem_mint: &Pubkey, treasury: &Pubkey, pack_id: u8) -> Instruction {
    ix(
        instruction::BuyGems { pack_id },
        accounts::BuyGems {
            owner: *owner,
            economy: economy(),
            treasury: *treasury,
            gem_mint: *gem_mint,
            owner_gem_account: ata(owner, gem_mint),
            token_program: token_2022::ID,
            associated_token_program: associated_token::ID,
            system_program: system_program::ID,
        },
    )
}
pub fn buy_item_ix(owner: &Pubkey, gem_mint: &Pubkey, item_mint: &Pubkey, id: u16, quantity: u16) -> Instruction {
    ix(
        instruction::BuyItem { quantity },
        accounts::BuyItem {
            owner: *owner,
            economy: economy(),
            item_type: item_pda(id),
            gem_mint: *gem_mint,
            owner_gem_account: ata(owner, gem_mint),
            item_mint: *item_mint,
            owner_item_account: ata(owner, item_mint),
            token_program: token_2022::ID,
            associated_token_program: associated_token::ID,
            system_program: system_program::ID,
        },
    )
}

/// A world with the registry and economy initialised, one gem pack (id 0) and one food item.
pub fn world() -> World {
    let mut svm = LiteSVM::new();
    let admin = Keypair::new();
    let player = Keypair::new();
    let other = Keypair::new();
    svm.add_program(
        program_id(),
        include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/solana_anchor_starter.so"
        )),
    )
    .unwrap();
    let program_data = Pubkey::find_program_address(&[program_id().as_ref()], &LOADER).0;
    let mut account = svm.get_account(&program_data).unwrap();
    account.data[12] = 1;
    account.data[13..45].copy_from_slice(admin.pubkey().as_ref());
    svm.set_account(program_data, account).unwrap();
    for key in [&admin, &player, &other] {
        svm.airdrop(&key.pubkey(), 5_000_000_000).unwrap();
    }
    init_registry(&mut svm, &admin);

    let treasury = Keypair::new().pubkey();
    let gem = Keypair::new();
    let food = Keypair::new();
    create_mint(&mut svm, &admin, &gem, &economy(), true, Some(economy())).unwrap();
    create_mint(&mut svm, &admin, &food, &economy(), false, None).unwrap();
    send(
        &mut svm,
        &admin,
        &[],
        vec![
            init_economy_ix(&admin.pubkey(), &gem.pubkey(), &treasury),
            set_pack_ix(&admin.pubkey(), 0, PACK_GEMS, PACK_PRICE),
            create_item_ix(&admin.pubkey(), FOOD_ID, &food.pubkey(), FOOD_PRICE_GEMS, FOOD_UNITS),
        ],
    )
    .expect("economy initializes");

    send(
        &mut svm,
        &admin,
        &[],
        vec![
            set_food_ix(&admin.pubkey(), RATION_UNITS, FOOD_PRICES),
            create_habitat_type_ix(&admin.pubkey(), STARTER_HABITAT, 0),
            create_habitat_type_ix(&admin.pubkey(), PAID_HABITAT, PAID_HABITAT_PRICE),
        ],
    )
    .expect("food and habitats configure");
    World {
        svm,
        admin,
        player,
        other,
        treasury,
        gem_mint: gem.pubkey(),
        food_mint: food.pubkey(),
    }
}


pub const DAY: i64 = 86_400;
pub const RATION_UNITS: u8 = 5;
/// Gem price of one meal, index type * 4 + tier.
pub const FOOD_PRICES: [u64; 16] = [4, 6, 9, 12, 3, 4, 6, 8, 4, 6, 9, 12, 3, 4, 6, 8];
pub const STARTER_HABITAT: u16 = 100;
pub const PAID_HABITAT: u16 = 101;
pub const PAID_HABITAT_PRICE: u64 = 50;

pub fn daily_pda(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"profile4", owner.as_ref()], &program_id()).0
}

pub fn set_time(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock: anchor_lang::solana_program::clock::Clock = svm.get_sysvar();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
}

/// Edits a player's daily account directly (to simulate counted actions).
pub fn edit_daily(svm: &mut LiteSVM, owner: &Pubkey, edit: impl FnOnce(&mut PlayerProfile)) {
    let key = daily_pda(owner);
    let mut account = svm.get_account(&key).expect("daily account exists");
    let mut daily = PlayerProfile::try_deserialize(&mut &account.data[..]).unwrap();
    edit(&mut daily);
    let mut data = Vec::new();
    daily.try_serialize(&mut data).unwrap();
    account.data[..data.len()].copy_from_slice(&data);
    svm.set_account(key, account).unwrap();
}

pub fn read_daily(svm: &LiteSVM, owner: &Pubkey) -> PlayerProfile {
    let account = svm.get_account(&daily_pda(owner)).expect("daily account exists");
    PlayerProfile::try_deserialize(&mut &account.data[..]).unwrap()
}

pub fn set_food_ix(authority: &Pubkey, ration_units: u8, prices: [u64; 16]) -> Instruction {
    ix(
        instruction::SetFood { ration_units, prices },
        accounts::AdminEconomy {
            authority: *authority,
            registry: registry(),
            economy: economy(),
        },
    )
}
pub fn init_daily_ix(owner: &Pubkey) -> Instruction {
    ix(
        instruction::InitializePlayer {},
        accounts::InitializePlayer {
            owner: *owner,
            player_profile: daily_pda(owner),
            system_program: system_program::ID,
        },
    )
}
pub fn claim_ration_ix(owner: &Pubkey) -> Instruction {
    ix(
        instruction::ClaimDailyRation {},
        accounts::ClaimDailyRation {
            owner: *owner,
            economy: economy(),
            player_profile: daily_pda(owner),
        },
    )
}
pub fn claim_quest_ix(owner: &Pubkey, slot: u8) -> Instruction {
    ix(
        instruction::ClaimQuest { slot },
        accounts::ClaimQuest {
            owner: *owner,
            player_profile: daily_pda(owner),
        },
    )
}
pub fn buy_food_ix(owner: &Pubkey, gem_mint: &Pubkey, food_type: u8, tier: u8, amount: u16) -> Instruction {
    ix(
        instruction::BuyFood { food_type, tier, amount },
        accounts::BuyFood {
            owner: *owner,
            economy: economy(),
            player_profile: daily_pda(owner),
            gem_mint: *gem_mint,
            owner_gem_account: ata(owner, gem_mint),
            token_program: token_2022::ID,
        },
    )
}
pub fn create_habitat_type_ix(authority: &Pubkey, id: u16, price: u64) -> Instruction {
    ix(
        instruction::CreateHabitatType { item_id: id, price_gems: price },
        accounts::CreateHabitatType {
            authority: *authority,
            registry: registry(),
            item_type: item_pda(id),
            system_program: system_program::ID,
        },
    )
}
pub fn habitat_authority(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"habitat_authority", mint.as_ref()], &program_id()).0
}

/// Sets the compute unit limit (hand-built so the tests need no extra crate).
pub fn compute_limit_ix(units: u32) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction::new_with_bytes(
        "ComputeBudget111111111111111111111111111111".parse().unwrap(),
        &data,
        vec![],
    )
}

/// Buys (or claims, for the free starter) one habitat NFT the way the client does: the mint with a
/// metadata pointer, the owner's token account and `create_habitat` in one transaction.
pub fn buy_habitat(svm: &mut LiteSVM, owner: &Keypair, item_id: u16, gem_mint: &Pubkey, paid: bool) -> Result<Pubkey, String> {
    let mint = Keypair::new();
    let authority = habitat_authority(&mint.pubkey());
    let space = ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::MetadataPointer]).unwrap();
    let rent = svm.minimum_balance_for_rent_exemption(space);
    let owner_key = owner.pubkey();
    let ixs = vec![
        compute_limit_ix(600_000),
        system_instruction::create_account(&owner_key, &mint.pubkey(), rent, space as u64, &token_2022::ID),
        spl_token_2022::extension::metadata_pointer::instruction::initialize(
            &token_2022::ID,
            &mint.pubkey(),
            Some(authority),
            Some(mint.pubkey()),
        )
        .unwrap(),
        spl_token_2022::instruction::initialize_mint2(&token_2022::ID, &mint.pubkey(), &authority, None, 0).unwrap(),
        associated_token::spl_associated_token_account::instruction::create_associated_token_account(
            &owner_key,
            &owner_key,
            &mint.pubkey(),
            &token_2022::ID,
        ),
        ix(
            instruction::CreateHabitat {
                item_id,
                name: "Test habitat".to_string(),
                metadata_uri: "https://example.com/habitat.json".to_string(),
            },
            accounts::CreateHabitat {
                owner: owner_key,
                player_profile: daily_pda(&owner_key),
                economy: economy(),
                item_type: item_pda(item_id),
                gem_mint: *gem_mint,
                owner_gem_account: if paid { Some(ata(&owner_key, gem_mint)) } else { None },
                habitat_authority: authority,
                mint: mint.pubkey(),
                owner_token_account: ata(&owner_key, &mint.pubkey()),
                token_program: token_2022::ID,
                system_program: system_program::ID,
            },
        ),
    ];
    send(svm, owner, &[&mint], ixs).map(|_| mint.pubkey())
}

pub fn habitat_layout_ix(
    owner: &Pubkey,
    mint: &Pubkey,
    placed: [solana_anchor_starter::PlacedSlot; 3],
    props: [solana_anchor_starter::PropSlot; 14],
    prop_count: u8,
) -> Instruction {
    ix(
        instruction::SetHabitatLayout { placed, props, prop_count },
        accounts::HabitatLayout {
            owner: *owner,
            mint: *mint,
            owner_token_account: ata(owner, mint),
            habitat_authority: habitat_authority(mint),
            token_program: token_2022::ID,
        },
    )
}

pub fn select_habitat_ix(owner: &Pubkey, mint: &Pubkey) -> Instruction {
    ix(
        instruction::SelectHabitat {},
        accounts::SelectHabitat {
            owner: *owner,
            mint: *mint,
            owner_token_account: ata(owner, mint),
            player_profile: daily_pda(owner),
            token_program: token_2022::ID,
        },
    )
}

/// The raw layout bytes stored inside a habitat mint's metadata (the LAYOUT field, hex-decoded).
pub fn habitat_layout_bytes(svm: &LiteSVM, mint: &Pubkey) -> Vec<u8> {
    let data = svm.get_account(mint).expect("habitat mint exists").data;
    let needle = b"LAYOUT";
    let at = data.windows(needle.len()).position(|w| w == needle).expect("LAYOUT field present");
    let len_at = at + needle.len();
    let len = u32::from_le_bytes(data[len_at..len_at + 4].try_into().unwrap()) as usize;
    let hex = &data[len_at + 4..len_at + 4 + len];
    hex.chunks(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}
