//! Free daily ration and daily quests (Sparks). Run `anchor build` first.

mod common;
use common::*;
use solana_anchor_starter::{game_day, quest_for, QUESTS_PER_DAY, QUEST_TEMPLATES};

fn ration_balances(w: &World, owner: &Pubkey) -> [u64; 4] {
    [0, 1, 2, 3].map(|i| token_amount(&w.svm, &ata(owner, &w.ration_mints[i])))
}

#[test]
fn the_daily_ration_can_be_claimed_once_per_utc_day() {
    let mut w = world();
    let player = w.player.pubkey();
    set_time(&mut w.svm, 100 * DAY + 5);
    send(&mut w.svm, &w.player, &[], vec![init_daily_ix(&player)]).unwrap();

    let ixs = vec![claim_ration_ix(&player, &w.ration_mints)];
    send(&mut w.svm, &w.player, &[], ixs).expect("first claim of the day");
    let units = u64::from(RATION_UNITS);
    assert_eq!(ration_balances(&w, &player), [units; 4]);

    // Same day: rejected, nothing changes.
    set_time(&mut w.svm, 100 * DAY + DAY - 1);
    let ixs = vec![claim_ration_ix(&player, &w.ration_mints)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    assert_eq!(ration_balances(&w, &player), [units; 4]);

    // The next UTC day: allowed again.
    set_time(&mut w.svm, 101 * DAY);
    let ixs = vec![claim_ration_ix(&player, &w.ration_mints)];
    send(&mut w.svm, &w.player, &[], ixs).expect("claim on the next day");
    assert_eq!(ration_balances(&w, &player), [2 * units; 4]);
}

#[test]
fn the_ration_needs_an_initialized_daily_account() {
    let mut w = world();
    let player = w.player.pubkey();
    set_time(&mut w.svm, 100 * DAY);
    let ixs = vec![claim_ration_ix(&player, &w.ration_mints)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
}

#[test]
fn the_ration_is_off_until_configured() {
    let mut w = world();
    let admin = w.admin.pubkey();
    let player = w.player.pubkey();
    set_time(&mut w.svm, 100 * DAY);
    send(&mut w.svm, &w.player, &[], vec![init_daily_ix(&player)]).unwrap();
    send(&mut w.svm, &w.admin, &[], vec![set_ration_ix(&admin, 0, w.ration_mints)]).unwrap();
    let ixs = vec![claim_ration_ix(&player, &w.ration_mints)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
}

#[test]
fn quests_pay_sparks_once_and_only_when_complete() {
    let mut w = world();
    let player = w.player.pubkey();
    let now = 200 * DAY + 100;
    set_time(&mut w.svm, now);
    let day = game_day(now);
    send(&mut w.svm, &w.player, &[], vec![init_daily_ix(&player)]).unwrap();
    let sparks = |w: &World| token_amount(&w.svm, &ata(&player, &w.spark_mint));

    // Nothing counted yet.
    let ixs = vec![claim_quest_ix(&player, &w.spark_mint, 0)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());

    // Pretend the program counted plenty of actions today.
    edit_daily(&mut w.svm, &player, |d| {
        d.quest_day = day;
        d.counts = [200; 5];
    });
    let mut expected = 0;
    for slot in 0..QUESTS_PER_DAY as u8 {
        let ixs = vec![claim_quest_ix(&player, &w.spark_mint, slot)];
        send(&mut w.svm, &w.player, &[], ixs).unwrap_or_else(|e| panic!("slot {slot}: {e}"));
        expected += quest_for(day, usize::from(slot)).2;
        assert_eq!(sparks(&w), expected);
    }
    assert_eq!(read_daily(&w.svm, &player).claimed, 0b111);

    // A claimed quest cannot be claimed again, and slot 3 does not exist.
    for slot in [0u8, 1, 2, 3] {
        let ixs = vec![claim_quest_ix(&player, &w.spark_mint, slot)];
        assert!(send(&mut w.svm, &w.player, &[], ixs).is_err(), "slot {slot}");
    }
    assert_eq!(sparks(&w), expected);

    // Tomorrow's quests need tomorrow's actions: yesterday's counters do not carry over.
    set_time(&mut w.svm, now + DAY);
    let ixs = vec![claim_quest_ix(&player, &w.spark_mint, 0)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    assert_eq!(sparks(&w), expected);
}

#[test]
fn a_quest_needs_enough_of_its_own_action() {
    let mut w = world();
    let player = w.player.pubkey();
    let now = 300 * DAY;
    set_time(&mut w.svm, now);
    let day = game_day(now);
    send(&mut w.svm, &w.player, &[], vec![init_daily_ix(&player)]).unwrap();
    let (kind, target, _) = quest_for(day, 0);
    edit_daily(&mut w.svm, &player, |d| {
        d.quest_day = day;
        d.counts[usize::from(kind)] = target - 1;
    });
    let ixs = vec![claim_quest_ix(&player, &w.spark_mint, 0)];
    assert!(send(&mut w.svm, &w.player, &[], ixs).is_err());
    edit_daily(&mut w.svm, &player, |d| d.counts[usize::from(kind)] = target);
    let ixs = vec![claim_quest_ix(&player, &w.spark_mint, 0)];
    send(&mut w.svm, &w.player, &[], ixs).expect("claim once the target is reached");
}

#[test]
fn sparks_cannot_be_transferred_between_wallets() {
    let mut w = world();
    let (player, other) = (w.player.pubkey(), w.other.pubkey());
    let now = 400 * DAY;
    set_time(&mut w.svm, now);
    let day = game_day(now);
    for wallet in [&w.player, &w.other] {
        send(&mut w.svm, wallet, &[], vec![init_daily_ix(&wallet.pubkey())]).unwrap();
        edit_daily(&mut w.svm, &wallet.pubkey(), |d| {
            d.quest_day = day;
            d.counts = [200; 5];
        });
        let ixs = vec![claim_quest_ix(&wallet.pubkey(), &w.spark_mint, 0)];
        send(&mut w.svm, wallet, &[], ixs).unwrap();
    }
    let before = token_amount(&w.svm, &ata(&player, &w.spark_mint));
    let transfer = spl_token_2022::instruction::transfer_checked(
        &token_2022::ID,
        &ata(&player, &w.spark_mint),
        &w.spark_mint,
        &ata(&other, &w.spark_mint),
        &player,
        &[],
        1,
        0,
    )
    .unwrap();
    assert!(send(&mut w.svm, &w.player, &[], vec![transfer]).is_err());
    assert_eq!(token_amount(&w.svm, &ata(&player, &w.spark_mint)), before);
}

#[test]
fn only_the_authority_configures_sparks_and_the_ration_and_sparks_must_be_bound() {
    let mut w = world();
    let (admin, other) = (w.admin.pubkey(), w.other.pubkey());
    let ixs = vec![set_ration_ix(&other, 9, w.ration_mints)];
    assert!(send(&mut w.svm, &w.other, &[], ixs).is_err());

    // A transferable mint is not acceptable as Sparks.
    let loose = Keypair::new();
    create_mint(&mut w.svm, &w.admin, &loose, &economy(), false, None).unwrap();
    let ixs = vec![set_sparks_ix(&admin, &loose.pubkey())];
    assert!(send(&mut w.svm, &w.admin, &[], ixs).is_err());

    // The ration needs four distinct, non-empty mints.
    let dup = [w.ration_mints[0], w.ration_mints[0], w.ration_mints[2], w.ration_mints[3]];
    let ixs = vec![set_ration_ix(&admin, 5, dup)];
    assert!(send(&mut w.svm, &w.admin, &[], ixs).is_err());
}

#[test]
fn quests_are_the_same_for_everyone_and_three_distinct_ones_each_day() {
    for day in 1..=2_000u32 {
        let picks: Vec<_> = (0..QUESTS_PER_DAY).map(|slot| quest_for(day, slot)).collect();
        assert_eq!(picks, (0..QUESTS_PER_DAY).map(|slot| quest_for(day, slot)).collect::<Vec<_>>());
        assert!(picks[0] != picks[1] && picks[1] != picks[2] && picks[0] != picks[2], "day {day}");
        for (kind, target, reward) in picks {
            assert!(usize::from(kind) < 5 && target > 0 && reward > 0);
        }
    }
    // Every template shows up eventually.
    let seen: std::collections::HashSet<_> = (1..=16u32).map(|d| quest_for(d, 0)).collect();
    assert_eq!(seen.len(), QUEST_TEMPLATES.len());
}

#[test]
fn counters_reset_when_a_new_day_starts() {
    let mut daily = PlayerDaily {
        owner: Pubkey::new_unique(),
        ration_day: 0,
        quest_day: 0,
        counts: [0; 5],
        claimed: 0,
        bump: 0,
    };
    daily.record(0, 7);
    daily.record(0, 7);
    daily.record(4, 7);
    daily.claimed = 0b001;
    assert_eq!((daily.counts, daily.claimed, daily.quest_day), ([2, 0, 0, 0, 1], 0b001, 7));
    daily.record(1, 8);
    assert_eq!((daily.counts, daily.claimed, daily.quest_day), ([0, 1, 0, 0, 0], 0, 8));
    for _ in 0..300 {
        daily.record(2, 8);
    }
    assert_eq!(daily.counts[2], 255);
}
