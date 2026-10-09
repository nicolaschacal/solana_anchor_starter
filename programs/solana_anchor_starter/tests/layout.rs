//! Habitats are 1/1 NFTs that keep their own layout. The starter habitat is free once per wallet.

mod common;
use common::*;
use solana_anchor_starter::{PlacedSlot, PropSlot, MAX_PLACED_SLOTS, MAX_PROP_SLOTS, STARTER_MEALS};

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
    let ixs = vec![habitat_layout_ix(&player, &mint, placed.clone(), some_props(5))];
    send(&mut w.svm, &w.player, &[], ixs).expect("save layout");

    let bytes = habitat_layout_bytes(&w.svm, &mint);
    assert_eq!(bytes.len(), 1 + 1 + 2 * 34 + 1 + 5 * 9);
    assert_eq!(bytes[0], 1, "layout flagged as set");
    assert_eq!(bytes[1], 2, "placed count");
    assert_eq!(&bytes[2..34], placed[0].mint.as_ref());
    assert_eq!((bytes[34], bytes[35]), (placed[0].i, placed[0].j));
    assert_eq!(bytes[2 + 68], 5, "prop count");

    // Saving again replaces it (and can shrink it).
    let ixs = vec![habitat_layout_ix(&player, &mint, vec![], vec![])];
    send(&mut w.svm, &w.player, &[], ixs).expect("save an empty layout");
    assert_eq!(habitat_layout_bytes(&w.svm, &mint), vec![1, 0, 0]);
}

#[test]
fn the_biggest_layout_fits_and_the_owner_pays_for_the_growth() {
    let (mut w, mint) = started();
    let player = w.player.pubkey();
    let rent_before = w.svm.get_account(&mint).unwrap().lamports;
    let ixs = vec![habitat_layout_ix(&player, &mint, slots(MAX_PLACED_SLOTS), some_props(MAX_PROP_SLOTS))];
    send(&mut w.svm, &w.player, &[], ixs).expect("save the largest layout");
    assert_eq!(habitat_layout_bytes(&w.svm, &mint).len(), 1 + 1 + MAX_PLACED_SLOTS * 34 + 1 + MAX_PROP_SLOTS * 9);
    assert!(w.svm.get_account(&mint).unwrap().lamports > rent_before, "the mint was topped up with rent");
    // Saving the same size again costs no more rent.
    let rent_full = w.svm.get_account(&mint).unwrap().lamports;
    let ixs = vec![habitat_layout_ix(&player, &mint, slots(MAX_PLACED_SLOTS), some_props(MAX_PROP_SLOTS))];
    send(&mut w.svm, &w.player, &[], ixs).expect("save again");
    assert_eq!(w.svm.get_account(&mint).unwrap().lamports, rent_full);
}

#[test]
fn malformed_layouts_are_rejected() {
    let (mut w, mint) = started();
    let player = w.player.pubkey();
    // More objects or Rebyters than any habitat can hold.
    let ixs = vec![habitat_layout_ix(&player, &mint, vec![], some_props(MAX_PROP_SLOTS + 1))];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    let ixs = vec![habitat_layout_ix(&player, &mint, slots(MAX_PLACED_SLOTS + 1), vec![])];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // An object kind the client does not know.
    let mut props = some_props(3);
    props[1].kind = 11;
    let ixs = vec![habitat_layout_ix(&player, &mint, vec![], props)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // A zero-size object.
    let mut props = some_props(3);
    props[2].h = 0;
    let ixs = vec![habitat_layout_ix(&player, &mint, vec![], props)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // The same Rebyter twice, or an empty slot.
    let dup = PlacedSlot { mint: Pubkey::new_unique(), i: 1, j: 1 };
    let ixs = vec![habitat_layout_ix(&player, &mint, vec![dup, dup], some_props(1))];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    let ixs = vec![habitat_layout_ix(&player, &mint, vec![PlacedSlot::default()], vec![])];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // Nothing was written.
    assert_eq!(habitat_layout_bytes(&w.svm, &mint), vec![0u8]);
}

#[test]
fn only_the_holder_can_change_a_habitat() {
    let (mut w, mint) = started();
    let other = w.other.pubkey();
    // The other wallet holds no token of this habitat.
    let ixs = vec![habitat_layout_ix(&other, &mint, vec![], some_props(1))];
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
