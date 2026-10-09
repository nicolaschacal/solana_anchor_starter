//! Economy tests: Gems (bought with SOL, burned on spend, non-transferable) and the item catalog.
//! Run `anchor build` first: the tests load the compiled program from target/deploy.

use anchor_lang::{
    prelude::Pubkey,
    solana_program::{instruction::Instruction, system_instruction, system_program},
    InstructionData, ToAccountMetas,
};
use anchor_spl::{
    associated_token::{self, get_associated_token_address_with_program_id},
    token_2022::{self, spl_token_2022},
};
use litesvm::LiteSVM;
use solana_anchor_starter::{accounts, instruction, LOADER};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;
use spl_token_2022::{extension::ExtensionType, state::Mint};

const PACK_GEMS: u64 = 100;
const PACK_PRICE: u64 = 100_000_000; // 0.1 SOL
const FOOD_ID: u16 = 1;
const FOOD_PRICE_GEMS: u64 = 10;
const FOOD_UNITS: u16 = 10;

fn program_id() -> Pubkey {
    solana_anchor_starter::ID
}
fn registry() -> Pubkey {
    Pubkey::find_program_address(&[b"registry"], &program_id()).0
}
fn economy() -> Pubkey {
    Pubkey::find_program_address(&[b"economy"], &program_id()).0
}
fn item_pda(id: u16) -> Pubkey {
    Pubkey::find_program_address(&[b"item", &id.to_le_bytes()], &program_id()).0
}
fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(owner, mint, &token_2022::ID)
}
fn ix(data: impl InstructionData, acc: impl ToAccountMetas) -> Instruction {
    Instruction::new_with_bytes(program_id(), &data.data(), acc.to_account_metas(None))
}
fn send(
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
fn token_amount(svm: &LiteSVM, account: &Pubkey) -> u64 {
    match svm.get_account(account) {
        Some(a) if a.data.len() >= 72 => u64::from_le_bytes(a.data[64..72].try_into().unwrap()),
        _ => 0,
    }
}
fn lamports(svm: &LiteSVM, key: &Pubkey) -> u64 {
    svm.get_account(key).map(|a| a.lamports).unwrap_or(0)
}

/// Creates a Token-2022 mint with 0 decimals and the given extensions.
fn create_mint(
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

struct World {
    svm: LiteSVM,
    admin: Keypair,
    player: Keypair,
    other: Keypair,
    treasury: Pubkey,
    gem_mint: Pubkey,
    food_mint: Pubkey,
}

fn init_registry(svm: &mut LiteSVM, admin: &Keypair) {
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

fn init_economy_ix(authority: &Pubkey, gem_mint: &Pubkey, treasury: &Pubkey) -> Instruction {
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
fn set_pack_ix(authority: &Pubkey, pack_id: u8, gems: u64, price: u64) -> Instruction {
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
fn create_item_ix(authority: &Pubkey, id: u16, mint: &Pubkey, price: u64, units: u16) -> Instruction {
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
fn update_item_ix(authority: &Pubkey, id: u16, price: u64, active: bool) -> Instruction {
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
fn buy_gems_ix(owner: &Pubkey, gem_mint: &Pubkey, treasury: &Pubkey, pack_id: u8) -> Instruction {
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
fn buy_item_ix(owner: &Pubkey, gem_mint: &Pubkey, item_mint: &Pubkey, id: u16, quantity: u16) -> Instruction {
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
fn world() -> World {
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

#[test]
fn buying_gems_pays_the_treasury_and_mints_gems() {
    let mut w = world();
    let before = lamports(&w.svm, &w.treasury);
    let ixs = vec![buy_gems_ix(&w.player.pubkey(), &w.gem_mint, &w.treasury, 0)];
    send(&mut w.svm, &w.player, &[], ixs).expect("buy gems");
    assert_eq!(lamports(&w.svm, &w.treasury) - before, PACK_PRICE);
    assert_eq!(token_amount(&w.svm, &ata(&w.player.pubkey(), &w.gem_mint)), PACK_GEMS);
}

#[test]
fn buying_an_item_burns_gems_and_mints_units() {
    let mut w = world();
    let player = w.player.pubkey();
    let ixs = vec![buy_gems_ix(&player, &w.gem_mint, &w.treasury, 0)];
    send(&mut w.svm, &w.player, &[], ixs).unwrap();

    let ixs = vec![buy_item_ix(&player, &w.gem_mint, &w.food_mint, FOOD_ID, 2)];
    send(&mut w.svm, &w.player, &[], ixs).expect("buy item");
    // 2 purchases: 20 gems burned, 2 x 10 units minted.
    assert_eq!(token_amount(&w.svm, &ata(&player, &w.gem_mint)), PACK_GEMS - 2 * FOOD_PRICE_GEMS);
    assert_eq!(token_amount(&w.svm, &ata(&player, &w.food_mint)), 2 * u64::from(FOOD_UNITS));
}

#[test]
fn buying_without_enough_gems_changes_nothing() {
    let mut w = world();
    let player = w.player.pubkey();
    let ixs = vec![buy_gems_ix(&player, &w.gem_mint, &w.treasury, 0)];
    send(&mut w.svm, &w.player, &[], ixs).unwrap();

    // 11 purchases cost 110 gems; the player has 100.
    let ixs = vec![buy_item_ix(&player, &w.gem_mint, &w.food_mint, FOOD_ID, 11)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    assert_eq!(token_amount(&w.svm, &ata(&player, &w.gem_mint)), PACK_GEMS);
    assert_eq!(token_amount(&w.svm, &ata(&player, &w.food_mint)), 0);
}

#[test]
fn quantity_must_be_between_one_and_ninety_nine() {
    let mut w = world();
    let player = w.player.pubkey();
    let ixs = vec![buy_gems_ix(&player, &w.gem_mint, &w.treasury, 0)];
    send(&mut w.svm, &w.player, &[], ixs).unwrap();
    for quantity in [0u16, 100] {
        let ixs = vec![buy_item_ix(&player, &w.gem_mint, &w.food_mint, FOOD_ID, quantity)];
        assert!(send(&mut w.svm, &w.player, &[], ixs).is_err(), "quantity {quantity}");
    }
}

#[test]
fn gems_cannot_be_transferred_between_wallets() {
    let mut w = world();
    let player = w.player.pubkey();
    let other = w.other.pubkey();
    // Both wallets hold gems so that the destination token account exists.
    for wallet in [&w.player, &w.other] {
        let ixs = vec![buy_gems_ix(&wallet.pubkey(), &w.gem_mint, &w.treasury, 0)];
        send(&mut w.svm, wallet, &[], ixs).unwrap();
    }
    let transfer = spl_token_2022::instruction::transfer_checked(
        &token_2022::ID,
        &ata(&player, &w.gem_mint),
        &w.gem_mint,
        &ata(&other, &w.gem_mint),
        &player,
        &[],
        10,
        0,
    )
    .unwrap();
    assert!(send(&mut w.svm, &w.player, &[], vec![transfer]).is_err());
    assert_eq!(token_amount(&w.svm, &ata(&player, &w.gem_mint)), PACK_GEMS);
    assert_eq!(token_amount(&w.svm, &ata(&other, &w.gem_mint)), PACK_GEMS);
}

#[test]
fn inactive_packs_and_items_cannot_be_bought() {
    let mut w = world();
    let player = w.player.pubkey();
    // Pack 1 was never configured.
    let ixs = vec![buy_gems_ix(&player, &w.gem_mint, &w.treasury, 1)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());

    let ixs = vec![buy_gems_ix(&player, &w.gem_mint, &w.treasury, 0)];
    send(&mut w.svm, &w.player, &[], ixs).unwrap();

    let ixs = vec![update_item_ix(&w.admin.pubkey(), FOOD_ID, FOOD_PRICE_GEMS, false)];
    send(&mut w.svm, &w.admin, &[], ixs).unwrap();
    let ixs = vec![buy_item_ix(&player, &w.gem_mint, &w.food_mint, FOOD_ID, 1)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
}

#[test]
fn gem_payments_only_go_to_the_configured_treasury() {
    let mut w = world();
    let thief = Keypair::new().pubkey();
    let ixs = vec![buy_gems_ix(&w.player.pubkey(), &w.gem_mint, &thief, 0)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    assert_eq!(lamports(&w.svm, &thief), 0);
}

#[test]
fn only_the_registry_authority_can_manage_the_economy() {
    let mut w = world();
    let other = w.other.pubkey();
    let ixs = vec![set_pack_ix(&other, 2, 5, 5)];
    assert!(send(&mut w.svm, &w.other, &[], ixs).is_err());
    let ixs = vec![update_item_ix(&other, FOOD_ID, 1, true)];
    assert!(send(&mut w.svm, &w.other, &[], ixs).is_err());
    let extra = Keypair::new();
    create_mint(&mut w.svm, &w.admin, &extra, &economy(), false, None).unwrap();
    let ixs = vec![create_item_ix(&other, 2, &extra.pubkey(), 5, 1)];
    assert!(send(&mut w.svm, &w.other, &[], ixs).is_err());
}

#[test]
fn a_gem_pack_needs_both_gems_and_a_price_or_neither() {
    let mut w = world();
    let admin = w.admin.pubkey();
    for (gems, price) in [(0u64, 5u64), (5, 0)] {
        let ixs = vec![set_pack_ix(&admin, 3, gems, price)];
        assert!(send(&mut w.svm, &w.admin, &[], ixs).is_err());
    }
    // Both zero disables the pack again.
    let ixs = vec![set_pack_ix(&admin, 0, 0, 0)];
    send(&mut w.svm, &w.admin, &[], ixs).expect("disable pack");
    let ixs = vec![buy_gems_ix(&w.player.pubkey(), &w.gem_mint, &w.treasury, 0)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
}

/// The economy must refuse a gem mint that could be traded or that it does not control.
#[test]
fn the_economy_rejects_badly_shaped_gem_mints() {
    let mut svm = LiteSVM::new();
    let admin = Keypair::new();
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
    svm.airdrop(&admin.pubkey(), 5_000_000_000).unwrap();
    init_registry(&mut svm, &admin);
    let treasury = Keypair::new().pubkey();

    let cases: [(&str, bool, Option<Pubkey>, Pubkey); 3] = [
        ("transferable", false, Some(economy()), economy()),
        ("no permanent delegate", true, None, economy()),
        ("authority is not the economy", true, Some(economy()), admin.pubkey()),
    ];
    for (name, non_transferable, delegate, authority) in cases {
        let mint = Keypair::new();
        create_mint(&mut svm, &admin, &mint, &authority, non_transferable, delegate).unwrap();
        let ixs = vec![init_economy_ix(&admin.pubkey(), &mint.pubkey(), &treasury)];
        assert!(send(&mut svm, &admin, &[], ixs).is_err(), "{name} must be rejected");
    }
    // A correct mint is accepted afterwards.
    let good = Keypair::new();
    create_mint(&mut svm, &admin, &good, &economy(), true, Some(economy())).unwrap();
    let ixs = vec![init_economy_ix(&admin.pubkey(), &good.pubkey(), &treasury)];
    send(&mut svm, &admin, &[], ixs).expect("well-shaped gem mint is accepted");
}
