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
    Pubkey::find_program_address(&[b"economy"], &program_id()).0
}
pub fn item_pda(id: u16) -> Pubkey {
    Pubkey::find_program_address(&[b"item", &id.to_le_bytes()], &program_id()).0
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
    pub spark_mint: Pubkey,
    pub ration_mints: [Pubkey; 4],
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
    ix(
        instruction::CreateItemType {
            item_id: id,
            price_gems: price,
            units_per_purchase: units,
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

    let spark = Keypair::new();
    create_mint(&mut svm, &admin, &spark, &economy(), true, None).unwrap();
    let ration: [Keypair; 4] = [Keypair::new(), Keypair::new(), Keypair::new(), Keypair::new()];
    for mint in &ration {
        create_mint(&mut svm, &admin, mint, &economy(), false, None).unwrap();
    }
    let ration_mints = [
        ration[0].pubkey(),
        ration[1].pubkey(),
        ration[2].pubkey(),
        ration[3].pubkey(),
    ];
    send(
        &mut svm,
        &admin,
        &[],
        vec![
            set_sparks_ix(&admin.pubkey(), &spark.pubkey()),
            set_ration_ix(&admin.pubkey(), RATION_UNITS, ration_mints),
        ],
    )
    .expect("sparks and ration configure");
    World {
        svm,
        admin,
        player,
        other,
        treasury,
        gem_mint: gem.pubkey(),
        food_mint: food.pubkey(),
        spark_mint: spark.pubkey(),
        ration_mints,
    }
}


pub const DAY: i64 = 86_400;
pub const RATION_UNITS: u8 = 5;

pub fn daily_pda(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"profile", owner.as_ref()], &program_id()).0
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

pub fn set_sparks_ix(authority: &Pubkey, spark_mint: &Pubkey) -> Instruction {
    ix(
        instruction::SetSparksMint {},
        accounts::SetSparksMint {
            authority: *authority,
            registry: registry(),
            economy: economy(),
            spark_mint: *spark_mint,
            token_program: token_2022::ID,
        },
    )
}
pub fn set_ration_ix(authority: &Pubkey, units: u8, mints: [Pubkey; 4]) -> Instruction {
    ix(
        instruction::SetRation { units, mints },
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
pub fn claim_ration_ix(owner: &Pubkey, mints: &[Pubkey; 4]) -> Instruction {
    ix(
        instruction::ClaimDailyRation {},
        accounts::ClaimDailyRation {
            owner: *owner,
            economy: economy(),
            player_profile: daily_pda(owner),
            meat_mint: mints[0],
            plant_mint: mints[1],
            fish_mint: mints[2],
            fruit_mint: mints[3],
            owner_meat: ata(owner, &mints[0]),
            owner_plant: ata(owner, &mints[1]),
            owner_fish: ata(owner, &mints[2]),
            owner_fruit: ata(owner, &mints[3]),
            token_program: token_2022::ID,
            associated_token_program: associated_token::ID,
            system_program: system_program::ID,
        },
    )
}
pub fn claim_quest_ix(owner: &Pubkey, spark_mint: &Pubkey, slot: u8) -> Instruction {
    ix(
        instruction::ClaimQuest { slot },
        accounts::ClaimQuest {
            owner: *owner,
            economy: economy(),
            player_profile: daily_pda(owner),
            spark_mint: *spark_mint,
            owner_spark_account: ata(owner, spark_mint),
            token_program: token_2022::ID,
            associated_token_program: associated_token::ID,
            system_program: system_program::ID,
        },
    )
}

pub fn buy_item_sparks_ix(owner: &Pubkey, spark_mint: &Pubkey, item_mint: &Pubkey, id: u16, quantity: u16) -> Instruction {
    ix(
        instruction::BuyItemSparks { quantity },
        accounts::BuyItemSparks {
            owner: *owner,
            economy: economy(),
            item_type: item_pda(id),
            spark_mint: *spark_mint,
            owner_spark_account: ata(owner, spark_mint),
            item_mint: *item_mint,
            owner_item_account: ata(owner, item_mint),
            token_program: token_2022::ID,
            associated_token_program: associated_token::ID,
            system_program: system_program::ID,
        },
    )
}

pub fn food_config() -> Pubkey {
    Pubkey::find_program_address(&[b"food"], &program_id()).0
}
pub fn set_bound_food_ix(authority: &Pubkey, mints: &[Pubkey; 4]) -> Instruction {
    ix(
        instruction::SetBoundFood {},
        accounts::SetBoundFood {
            authority: *authority,
            registry: registry(),
            economy: economy(),
            food_config: food_config(),
            meat_mint: mints[0],
            plant_mint: mints[1],
            fish_mint: mints[2],
            fruit_mint: mints[3],
            token_program: token_2022::ID,
            system_program: system_program::ID,
        },
    )
}

pub fn set_layout_ix(
    owner: &Pubkey,
    placed: [solana_anchor_starter::PlacedSlot; 3],
    props: [solana_anchor_starter::PropSlot; 14],
    prop_count: u8,
) -> Instruction {
    ix(
        instruction::SetLayout { placed, props, prop_count },
        accounts::SetLayout {
            owner: *owner,
            player_profile: daily_pda(owner),
        },
    )
}
