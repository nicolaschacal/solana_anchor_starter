//! Habitats are 1/1 NFTs that keep their own layout. The starter habitat is free once per wallet.

mod common;
use common::*;
use solana_anchor_starter::{PlacedSlot, PropSlot, HABITAT_LAYOUT_BYTES, STARTER_MEALS};

fn prop(kind: u8, n: i16) -> PropSlot {
    PropSlot { kind, x: -14_000 + n, z: -26_000 + n, h: 1_800, r: 1_000 }
}

fn some_props(count: usize) -> [PropSlot; 14] {
    let mut props = [PropSlot::default(); 14];
    for (n, slot) in props.iter_mut().enumerate().take(count) {
        *slot = prop((n % 11) as u8, n as i16);
    }
    props
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
    // A fresh habitat has an empty, unset layout of fixed size.
    let bytes = habitat_layout_bytes(&w.svm, &mint);
    assert_eq!(bytes.len(), HABITAT_LAYOUT_BYTES);
    assert!(bytes.iter().all(|b| *b == 0));

    // Claiming a second free habitat is refused.
    assert!(buy_habitat(&mut w.svm, &w.player, STARTER_HABITAT, &w.gem_mint, false).is_err());
}

#[test]
fn the_layout_is_saved_inside_the_habitat_and_read_back() {
    let (mut w, mint) = started();
    let player = w.player.pubkey();
    let mut placed = [PlacedSlot::default(); 3];
    placed[0] = PlacedSlot { mint: Pubkey::new_unique(), i: 18, j: 30 };
    placed[1] = PlacedSlot { mint: Pubkey::new_unique(), i: 19, j: 31 };
    let ixs = vec![habitat_layout_ix(&player, &mint, placed, some_props(5), 5)];
    send(&mut w.svm, &w.player, &[], ixs).expect("save layout");

    let bytes = habitat_layout_bytes(&w.svm, &mint);
    assert_eq!(bytes.len(), HABITAT_LAYOUT_BYTES);
    assert_eq!(bytes[0], 1, "layout flagged as set");
    assert_eq!(&bytes[1..33], placed[0].mint.as_ref());
    assert_eq!((bytes[33], bytes[34]), (18, 30));
    assert_eq!(bytes[1 + 102], 5, "prop count");

    // Saving again replaces it (and can shrink it).
    let ixs = vec![habitat_layout_ix(&player, &mint, [PlacedSlot::default(); 3], some_props(0), 0)];
    send(&mut w.svm, &w.player, &[], ixs).expect("save an empty layout");
    assert_eq!(habitat_layout_bytes(&w.svm, &mint)[1 + 102], 0);
}

#[test]
fn malformed_layouts_are_rejected() {
    let (mut w, mint) = started();
    let player = w.player.pubkey();
    // More objects than slots.
    let ixs = vec![habitat_layout_ix(&player, &mint, [PlacedSlot::default(); 3], some_props(14), 15)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // An object kind the client does not know.
    let mut props = some_props(3);
    props[1].kind = 11;
    let ixs = vec![habitat_layout_ix(&player, &mint, [PlacedSlot::default(); 3], props, 3)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // A zero-size object.
    let mut props = some_props(3);
    props[2].h = 0;
    let ixs = vec![habitat_layout_ix(&player, &mint, [PlacedSlot::default(); 3], props, 3)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // The same Rebyter twice.
    let dup = PlacedSlot { mint: Pubkey::new_unique(), i: 1, j: 1 };
    let ixs = vec![habitat_layout_ix(&player, &mint, [dup, dup, PlacedSlot::default()], some_props(1), 1)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // Nothing was written.
    assert!(habitat_layout_bytes(&w.svm, &mint).iter().all(|b| *b == 0));
}

#[test]
fn only_the_holder_can_change_a_habitat() {
    let (mut w, mint) = started();
    let other = w.other.pubkey();
    // The other wallet holds no token of this habitat.
    let ixs = vec![habitat_layout_ix(&other, &mint, [PlacedSlot::default(); 3], some_props(1), 1)];
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
