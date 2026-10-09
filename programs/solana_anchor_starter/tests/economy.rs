//! Economy tests: Gems (bought with SOL, burned on spend, non-transferable) and the item catalog.
//! Run `anchor build` first: the tests load the compiled program from target/deploy.

mod common;
use common::*;

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

/// Food is bought with Gems and lands in the profile as meals; nothing is minted.
#[test]
fn food_is_bought_with_gems_into_the_profile() {
    let mut w = world();
    let player = w.player.pubkey();
    send(&mut w.svm, &w.player, &[], vec![init_daily_ix(&player)]).unwrap();
    send(&mut w.svm, &w.player, &[], vec![buy_gems_ix(&player, &w.gem_mint, &w.treasury, 0)]).unwrap();

    // Two packs of fish (type 2): 2 x 12 Gems, 2 x 5 meals.
    send(&mut w.svm, &w.player, &[], vec![buy_food_ix(&player, &w.gem_mint, 2, 2)]).expect("buy food");
    assert_eq!(token_amount(&w.svm, &ata(&player, &w.gem_mint)), PACK_GEMS - 2 * FOOD_PRICES[2]);
    assert_eq!(read_daily(&w.svm, &player).food, [0, 0, 2 * u16::from(PACK_MEALS), 0]);

    // Unknown food, no packs, too many packs and too few Gems change nothing.
    for (kind, packs) in [(4u8, 1u16), (0, 0), (0, 100), (0, 50)] {
        assert!(send(&mut w.svm, &w.player, &[], vec![buy_food_ix(&player, &w.gem_mint, kind, packs)]).is_err());
    }
    assert_eq!(read_daily(&w.svm, &player).food, [0, 0, 2 * u16::from(PACK_MEALS), 0]);
}

#[test]
fn food_needs_a_profile() {
    let mut w = world();
    let player = w.player.pubkey();
    send(&mut w.svm, &w.player, &[], vec![buy_gems_ix(&player, &w.gem_mint, &w.treasury, 0)]).unwrap();
    assert!(send(&mut w.svm, &w.player, &[], vec![buy_food_ix(&player, &w.gem_mint, 0, 1)]).is_err());
}
