//! Habitats are 1/1 NFTs that keep their own layout. The starter habitat is free once per wallet.

mod common;
use common::*;
use solana_anchor_starter::{PlacedSlot, PropSlot, STARTER_MEALS};

/// Limits of the starter island (5x5) as registered by the test world.
const STARTER_PLACED: usize = 3;
const STARTER_PROPS: usize = 14;

fn prop(kind: u8, n: i16) -> PropSlot {
    PropSlot { kind, x: -14_000 + n, z: -26_000 + n, h: 1_800, r: 1_000 }
}

fn some_props(count: usize) -> Vec<PropSlot> {
    (0..count).map(|n| prop((n % 11) as u8, n as i16)).collect()
}

fn slots(count: usize) -> Vec<PlacedSlot> {
    (0..count).map(|n| PlacedSlot { mint: Pubkey::new_unique(), i: 10 + n as u8, j: 20 }).collect()
}

fn started() -> (World, Pubkey) {
    let mut w = world();
    let player = w.player.pubkey();
    send(&mut w.svm, &w.player, &[], vec![init_daily_ix(&player)]).unwrap();
    let mint = buy_habitat(&mut w.svm, &w.player, STARTER_HABITAT, &w.gem_mint, false).expect("starter pack");
    (w, mint)
}

#[test]
fn the_starter_pack_gives_a_habitat_and_the_first_meals_once() {
    let (mut w, mint) = started();
    let player = w.player.pubkey();
    assert_eq!(token_amount(&w.svm, &ata(&player, &mint)), 1);
    let profile = read_daily(&w.svm, &player);
    assert!(profile.starter_claimed);
    assert_eq!(profile.active_habitat, mint);
    let mut expected = [0u16; 16];
    for food_type in 0..4 {
        expected[food_type * 4] = STARTER_MEALS;
    }
    assert_eq!(profile.food, expected);
    // A fresh habitat has a blank, unset layout of a single byte.
    assert_eq!(habitat_layout_bytes(&w.svm, &mint), vec![0u8]);

    // Claiming a second free habitat is refused.
    assert!(buy_habitat(&mut w.svm, &w.player, STARTER_HABITAT, &w.gem_mint, false).is_err());
}

#[test]
fn the_layout_is_saved_inside_the_habitat_and_read_back() {
    let (mut w, mint) = started();
    let player = w.player.pubkey();
    let placed = slots(2);
    let ixs = vec![habitat_layout_ix(&player, &mint, placed.clone(), some_props(5), STARTER_HABITAT)];
    send(&mut w.svm, &w.player, &[], ixs).expect("save layout");

    let bytes = habitat_layout_bytes(&w.svm, &mint);
    assert_eq!(bytes.len(), 1 + 1 + 2 * 34 + 1 + 5 * 9);
    assert_eq!(bytes[0], 1, "layout flagged as set");
    assert_eq!(bytes[1], 2, "placed count");
    assert_eq!(&bytes[2..34], placed[0].mint.as_ref());
    assert_eq!((bytes[34], bytes[35]), (placed[0].i, placed[0].j));
    assert_eq!(bytes[2 + 68], 5, "prop count");

    // Saving again replaces it (and can shrink it).
    let ixs = vec![habitat_layout_ix(&player, &mint, vec![], vec![], STARTER_HABITAT)];
    send(&mut w.svm, &w.player, &[], ixs).expect("save an empty layout");
    assert_eq!(habitat_layout_bytes(&w.svm, &mint), vec![1, 0, 0]);
}

#[test]
fn the_islands_own_layout_limit_fits_and_the_owner_pays_for_the_growth() {
    let (mut w, mint) = started();
    let player = w.player.pubkey();
    let rent_before = w.svm.get_account(&mint).unwrap().lamports;
    let ixs = vec![habitat_layout_ix(&player, &mint, slots(STARTER_PLACED), some_props(STARTER_PROPS), STARTER_HABITAT)];
    send(&mut w.svm, &w.player, &[], ixs).expect("save the island's largest layout");
    assert_eq!(habitat_layout_bytes(&w.svm, &mint).len(), 1 + 1 + STARTER_PLACED * 34 + 1 + STARTER_PROPS * 9);
    assert!(w.svm.get_account(&mint).unwrap().lamports > rent_before, "the mint was topped up with rent");
    // Saving the same size again costs no more rent.
    let rent_full = w.svm.get_account(&mint).unwrap().lamports;
    let ixs = vec![habitat_layout_ix(&player, &mint, slots(STARTER_PLACED), some_props(STARTER_PROPS), STARTER_HABITAT)];
    send(&mut w.svm, &w.player, &[], ixs).expect("save again");
    assert_eq!(w.svm.get_account(&mint).unwrap().lamports, rent_full);
}

#[test]
fn malformed_layouts_are_rejected() {
    let (mut w, mint) = started();
    let player = w.player.pubkey();
    // More objects or Rebyters than this kind of island holds.
    let ixs = vec![habitat_layout_ix(&player, &mint, vec![], some_props(STARTER_PROPS + 1), STARTER_HABITAT)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    let ixs = vec![habitat_layout_ix(&player, &mint, slots(STARTER_PLACED + 1), vec![], STARTER_HABITAT)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // An object kind the client does not know.
    let mut props = some_props(3);
    props[1].kind = 11;
    let ixs = vec![habitat_layout_ix(&player, &mint, vec![], props, STARTER_HABITAT)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // A zero-size object.
    let mut props = some_props(3);
    props[2].h = 0;
    let ixs = vec![habitat_layout_ix(&player, &mint, vec![], props, STARTER_HABITAT)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // The same Rebyter twice, or an empty slot.
    let dup = PlacedSlot { mint: Pubkey::new_unique(), i: 1, j: 1 };
    let ixs = vec![habitat_layout_ix(&player, &mint, vec![dup, dup], some_props(1), STARTER_HABITAT)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    let ixs = vec![habitat_layout_ix(&player, &mint, vec![PlacedSlot::default()], vec![], STARTER_HABITAT)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // Nothing was written.
    assert_eq!(habitat_layout_bytes(&w.svm, &mint), vec![0u8]);
}

#[test]
fn only_the_holder_can_change_a_habitat() {
    let (mut w, mint) = started();
    let other = w.other.pubkey();
    // The other wallet holds no token of this habitat.
    let ixs = vec![habitat_layout_ix(&other, &mint, vec![], some_props(1), STARTER_HABITAT)];
    assert!(send(&mut w.svm, &w.other, &[], ixs).is_err());
    let ixs = vec![select_habitat_ix(&other, &mint)];
    assert!(send(&mut w.svm, &w.other, &[], ixs).is_err());
}

#[test]
fn a_paid_habitat_burns_gems_and_can_be_selected() {
    let (mut w, first) = started();
    let player = w.player.pubkey();
    // Not enough Gems yet.
    assert!(buy_habitat(&mut w.svm, &w.player, PAID_HABITAT, &w.gem_mint, true).is_err());

    send(&mut w.svm, &w.player, &[], vec![buy_gems_ix(&player, &w.gem_mint, &w.treasury, 0)]).unwrap();
    let second = buy_habitat(&mut w.svm, &w.player, PAID_HABITAT, &w.gem_mint, true).expect("buy a habitat");
    assert_eq!(token_amount(&w.svm, &ata(&player, &w.gem_mint)), PACK_GEMS - PAID_HABITAT_PRICE);
    assert_eq!(read_daily(&w.svm, &player).active_habitat, second);

    send(&mut w.svm, &w.player, &[], vec![select_habitat_ix(&player, &first)]).expect("select the first one");
    assert_eq!(read_daily(&w.svm, &player).active_habitat, first);
}

#[test]
fn habitats_need_a_profile_and_an_active_type() {
    let mut w = world();
    // No profile yet.
    assert!(buy_habitat(&mut w.svm, &w.player, STARTER_HABITAT, &w.gem_mint, false).is_err());
    // A mint-backed item id is not a habitat type.
    let player = w.player.pubkey();
    send(&mut w.svm, &w.player, &[], vec![init_daily_ix(&player)]).unwrap();
    assert!(buy_habitat(&mut w.svm, &w.player, FOOD_ID, &w.gem_mint, false).is_err());
}

#[test]
fn each_kind_of_island_has_its_own_limits_on_chain() {
    let (mut w, starter) = started();
    let player = w.player.pubkey();
    send(&mut w.svm, &w.player, &[], vec![buy_gems_ix(&player, &w.gem_mint, &w.treasury, 0)]).unwrap();
    let paid = buy_habitat(&mut w.svm, &w.player, PAID_HABITAT, &w.gem_mint, true).expect("buy the medium island");

    // The medium island (5 Rebyters, 24 objects) takes more than the starter does...
    let ixs = vec![habitat_layout_ix(&player, &paid, slots(5), some_props(24), PAID_HABITAT)];
    send(&mut w.svm, &w.player, &[], ixs).expect("the medium island holds 5 and 24");
    // ...but not more than its own limit.
    let ixs = vec![habitat_layout_ix(&player, &paid, slots(6), vec![], PAID_HABITAT)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    let ixs = vec![habitat_layout_ix(&player, &paid, vec![], some_props(25), PAID_HABITAT)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());

    // The starter island refuses what the medium one accepts.
    let ixs = vec![habitat_layout_ix(&player, &starter, slots(4), vec![], STARTER_HABITAT)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // A habitat cannot borrow another kind's limits: the kind must match the NFT.
    let ixs = vec![habitat_layout_ix(&player, &starter, slots(5), some_props(20), PAID_HABITAT)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
}

#[test]
fn island_limits_must_be_sensible_when_registered() {
    let mut w = world();
    let admin = w.admin.pubkey();
    for (placed, props) in [(0u8, 10u8), (3, 0), (9, 10), (3, 41)] {
        let ixs = vec![create_habitat_type_with_limits_ix(&admin, 300, 10, placed, props)];
        assert!(send(&mut w.svm, &w.admin, &[], ixs).is_err(), "{placed}/{props}");
    }
}
