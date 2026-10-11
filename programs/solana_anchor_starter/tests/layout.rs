//! The island is a level and a layout stored in the player's profile. The starter pack (the first
//! meals) is free once per wallet; each expansion burns Gems.

mod common;
use common::*;
use solana_anchor_starter::{PlacedSlot, PropSlot, STARTER_MEALS};

/// Limits of the starter island (5x5).
const STARTER_PLACED: usize = 3;
const STARTER_PROPS: usize = 14;

fn prop(kind: u8, n: i16) -> PropSlot {
    PropSlot { kind, x: -14_000 + n, z: -26_000 + n, h: 1_800, r: 1_000 }
}

fn some_props(count: usize) -> Vec<PropSlot> {
    (0..count).map(|n| prop((n % 12) as u8, n as i16)).collect()
}

fn slots(count: usize) -> Vec<PlacedSlot> {
    (0..count).map(|n| PlacedSlot { mint: Pubkey::new_unique(), i: 10 + n as u8, j: 20 }).collect()
}

fn started() -> World {
    let mut w = world();
    let player = w.player.pubkey();
    send(&mut w.svm, &w.player, &[], vec![init_daily_ix(&player)]).unwrap();
    send(&mut w.svm, &w.player, &[], vec![claim_starter_ix(&player)]).expect("starter pack");
    w
}

fn gems(w: &mut World, packs: usize) {
    let player = w.player.pubkey();
    for _ in 0..packs {
        send(&mut w.svm, &w.player, &[], vec![buy_gems_ix(&player, &w.gem_mint, &w.treasury, 0)]).unwrap();
    }
}

#[test]
fn the_starter_pack_gives_the_first_meals_once() {
    let mut w = started();
    let player = w.player.pubkey();
    let profile = read_daily(&w.svm, &player);
    assert!(profile.starter_claimed);
    assert_eq!(profile.island_level, 0);
    let mut expected = [0u16; 16];
    for food_type in 0..4 {
        expected[food_type * 4] = STARTER_MEALS;
    }
    assert_eq!(profile.food, expected);
    // A fresh island has a blank, unset layout.
    assert_eq!(island_layout_bytes(&w.svm, &player), vec![0u8]);

    // Claiming twice is refused.
    assert!(send(&mut w.svm, &w.player, &[], vec![claim_starter_ix(&player)]).is_err());
}

#[test]
fn the_layout_is_saved_in_the_profile_and_read_back() {
    let mut w = started();
    let player = w.player.pubkey();
    let placed = slots(2);
    send(&mut w.svm, &w.player, &[], vec![island_layout_ix(&player, placed.clone(), some_props(5))]).expect("save layout");

    let bytes = island_layout_bytes(&w.svm, &player);
    assert_eq!(bytes.len(), 1 + 1 + 2 * 34 + 1 + 5 * 9);
    assert_eq!(bytes[0], 1, "layout flagged as set");
    assert_eq!(bytes[1], 2, "placed count");
    assert_eq!(&bytes[2..34], placed[0].mint.as_ref());
    assert_eq!((bytes[34], bytes[35]), (placed[0].i, placed[0].j));
    assert_eq!(bytes[2 + 68], 5, "prop count");

    // Saving again replaces it (and can shrink it).
    send(&mut w.svm, &w.player, &[], vec![island_layout_ix(&player, vec![], vec![])]).expect("save an empty layout");
    assert_eq!(island_layout_bytes(&w.svm, &player), vec![1, 0, 0]);
}

#[test]
fn the_starter_island_holds_its_limit() {
    let mut w = started();
    let player = w.player.pubkey();
    send(&mut w.svm, &w.player, &[], vec![island_layout_ix(&player, slots(STARTER_PLACED), some_props(STARTER_PROPS))]).expect("largest starter layout");
    assert_eq!(island_layout_bytes(&w.svm, &player).len(), 1 + 1 + STARTER_PLACED * 34 + 1 + STARTER_PROPS * 9);
}

#[test]
fn malformed_layouts_are_rejected() {
    let mut w = started();
    let player = w.player.pubkey();
    // More objects or Rebyters than this level holds.
    assert!(send(&mut w.svm, &w.player, &[], vec![island_layout_ix(&player, vec![], some_props(STARTER_PROPS + 1))]).is_err());
    assert!(send(&mut w.svm, &w.player, &[], vec![island_layout_ix(&player, slots(STARTER_PLACED + 1), vec![])]).is_err());
    // An object kind the client does not know.
    let mut props = some_props(3);
    props[1].kind = 12;
    assert!(send(&mut w.svm, &w.player, &[], vec![island_layout_ix(&player, vec![], props)]).is_err());
    // A zero-size object.
    let mut props = some_props(3);
    props[2].h = 0;
    assert!(send(&mut w.svm, &w.player, &[], vec![island_layout_ix(&player, vec![], props)]).is_err());
    // The same Rebyter twice, or an empty slot.
    let dup = PlacedSlot { mint: Pubkey::new_unique(), i: 1, j: 1 };
    assert!(send(&mut w.svm, &w.player, &[], vec![island_layout_ix(&player, vec![dup, dup], some_props(1))]).is_err());
    assert!(send(&mut w.svm, &w.player, &[], vec![island_layout_ix(&player, vec![PlacedSlot::default()], vec![])]).is_err());
    // Nothing was written.
    assert_eq!(island_layout_bytes(&w.svm, &player), vec![0u8]);
}

#[test]
fn only_the_owner_changes_the_island() {
    let mut w = started();
    let other = w.other.pubkey();
    // The other wallet has no profile of its own, and cannot write into someone else's.
    assert!(send(&mut w.svm, &w.other, &[], vec![island_layout_ix(&other, vec![], some_props(1))]).is_err());
    assert!(send(&mut w.svm, &w.other, &[], vec![expand_island_ix(&other, &w.gem_mint, PAID_HABITAT)]).is_err());
}

#[test]
fn expanding_burns_gems_and_raises_the_limits() {
    let mut w = started();
    let player = w.player.pubkey();
    // Not enough Gems yet.
    assert!(send(&mut w.svm, &w.player, &[], vec![expand_island_ix(&player, &w.gem_mint, PAID_HABITAT)]).is_err());

    gems(&mut w, 2);
    send(&mut w.svm, &w.player, &[], vec![expand_island_ix(&player, &w.gem_mint, PAID_HABITAT)]).expect("expand to 7x7");
    assert_eq!(token_amount(&w.svm, &ata(&player, &w.gem_mint)), 2 * PACK_GEMS - PAID_HABITAT_PRICE);
    assert_eq!(read_daily(&w.svm, &player).island_level, 1);

    // The medium island (5 Rebyters, 24 objects) takes more than the starter does...
    send(&mut w.svm, &w.player, &[], vec![island_layout_ix(&player, slots(5), some_props(24))]).expect("the medium island holds 5 and 24");
    // ...but not more than its own limit.
    assert!(send(&mut w.svm, &w.player, &[], vec![island_layout_ix(&player, slots(6), vec![])]).is_err());
    assert!(send(&mut w.svm, &w.player, &[], vec![island_layout_ix(&player, vec![], some_props(25))]).is_err());

    // The same item cannot be used twice: the next level asks for the big island item.
    assert!(send(&mut w.svm, &w.player, &[], vec![expand_island_ix(&player, &w.gem_mint, PAID_HABITAT)]).is_err());
    send(&mut w.svm, &w.player, &[], vec![expand_island_ix(&player, &w.gem_mint, BIG_HABITAT)]).expect("expand to 9x9");
    assert_eq!(read_daily(&w.svm, &player).island_level, 2);
    send(&mut w.svm, &w.player, &[], vec![island_layout_ix(&player, slots(8), some_props(40))]).expect("the big island holds 8 and 40");

    // There is nothing beyond the largest island.
    gems(&mut w, 1);
    assert!(send(&mut w.svm, &w.player, &[], vec![expand_island_ix(&player, &w.gem_mint, BIG_HABITAT)]).is_err());
}

#[test]
fn a_level_cannot_be_skipped_or_bought_with_the_wrong_item() {
    let mut w = started();
    let player = w.player.pubkey();
    gems(&mut w, 2);
    // The big island item at level 0 would skip a level.
    assert!(send(&mut w.svm, &w.player, &[], vec![expand_island_ix(&player, &w.gem_mint, BIG_HABITAT)]).is_err());
    // A mint-backed item is not an island.
    assert!(send(&mut w.svm, &w.player, &[], vec![expand_island_ix(&player, &w.gem_mint, FOOD_ID)]).is_err());
    assert_eq!(read_daily(&w.svm, &player).island_level, 0);
}

#[test]
fn the_island_needs_a_profile() {
    let mut w = world();
    let player = w.player.pubkey();
    assert!(send(&mut w.svm, &w.player, &[], vec![claim_starter_ix(&player)]).is_err());
    assert!(send(&mut w.svm, &w.player, &[], vec![island_layout_ix(&player, vec![], vec![])]).is_err());
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
