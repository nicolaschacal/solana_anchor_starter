//! The habitat layout lives in the player's own profile.

mod common;
use common::*;
use solana_anchor_starter::{PlacedSlot, PropSlot};

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

#[test]
fn the_layout_is_saved_in_the_profile_and_read_back() {
    let mut w = world();
    let player = w.player.pubkey();
    send(&mut w.svm, &w.player, &[], vec![init_daily_ix(&player)]).unwrap();
    assert!(!read_daily(&w.svm, &player).layout_set);

    let mut placed = [PlacedSlot::default(); 3];
    placed[0] = PlacedSlot { mint: Pubkey::new_unique(), i: 18, j: 30 };
    placed[1] = PlacedSlot { mint: Pubkey::new_unique(), i: 19, j: 31 };
    let ixs = vec![set_layout_ix(&player, placed, some_props(5), 5)];
    send(&mut w.svm, &w.player, &[], ixs).expect("save layout");

    let saved = read_daily(&w.svm, &player);
    assert!(saved.layout_set);
    assert_eq!(saved.prop_count, 5);
    assert_eq!(saved.props[4].kind, 4);
    assert_eq!(saved.placed[1].mint, placed[1].mint);
    assert_eq!((saved.placed[0].i, saved.placed[0].j), (18, 30));

    // Saving again replaces it (and can shrink it).
    let ixs = vec![set_layout_ix(&player, [PlacedSlot::default(); 3], some_props(0), 0)];
    send(&mut w.svm, &w.player, &[], ixs).expect("save an empty layout");
    assert_eq!(read_daily(&w.svm, &player).prop_count, 0);
}

#[test]
fn malformed_layouts_are_rejected() {
    let mut w = world();
    let player = w.player.pubkey();
    send(&mut w.svm, &w.player, &[], vec![init_daily_ix(&player)]).unwrap();

    // More objects than slots.
    let ixs = vec![set_layout_ix(&player, [PlacedSlot::default(); 3], some_props(14), 15)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // An object kind the client does not know.
    let mut props = some_props(3);
    props[1].kind = 11;
    let ixs = vec![set_layout_ix(&player, [PlacedSlot::default(); 3], props, 3)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // A zero-size object.
    let mut props = some_props(3);
    props[2].h = 0;
    let ixs = vec![set_layout_ix(&player, [PlacedSlot::default(); 3], props, 3)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    // The same Rebyter twice.
    let mint = Pubkey::new_unique();
    let mut placed = [PlacedSlot::default(); 3];
    placed[0] = PlacedSlot { mint, i: 1, j: 1 };
    placed[1] = PlacedSlot { mint, i: 2, j: 2 };
    let ixs = vec![set_layout_ix(&player, placed, some_props(0), 0)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    assert!(!read_daily(&w.svm, &player).layout_set);
}

#[test]
fn nobody_can_write_someone_elses_layout() {
    let mut w = world();
    let (player, other) = (w.player.pubkey(), w.other.pubkey());
    send(&mut w.svm, &w.player, &[], vec![init_daily_ix(&player)]).unwrap();
    // `other` signs but points at the player's profile.
    let mut ix = set_layout_ix(&other, [PlacedSlot::default(); 3], some_props(1), 1);
    ix.accounts[1].pubkey = daily_pda(&player);
    assert!(send(&mut w.svm, &w.other, &[], vec![ix]).is_err());
    assert!(!read_daily(&w.svm, &player).layout_set);
}
