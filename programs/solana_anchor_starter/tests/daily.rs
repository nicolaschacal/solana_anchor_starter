//! Free daily ration and daily quests (food counters in the profile). Run `anchor build` first.

mod common;
use common::*;
use solana_anchor_starter::{game_day, quest_food, quest_for, QUESTS_PER_DAY, QUEST_TEMPLATES};

/// Meals of each food at the plain tier (what the ration and the quests give).
fn food(w: &World, owner: &Pubkey) -> [u16; 4] {
    let all = read_daily(&w.svm, owner).food;
    assert!(all.iter().enumerate().all(|(i, n)| i % 4 == 0 || *n == 0), "only plain meals are given for free");
    [all[0], all[4], all[8], all[12]]
}

#[test]
fn the_daily_ration_can_be_claimed_once_per_utc_day() {
    let mut w = world();
    let player = w.player.pubkey();
    set_time(&mut w.svm, 100 * DAY + 5);
    send(&mut w.svm, &w.player, &[], vec![init_daily_ix(&player)]).unwrap();

    send(&mut w.svm, &w.player, &[], vec![claim_ration_ix(&player)]).expect("first claim of the day");
    let units = u16::from(RATION_UNITS);
    assert_eq!(food(&w, &player), [units; 4]);

    // Same day: rejected, nothing changes.
    set_time(&mut w.svm, 100 * DAY + DAY - 1);
    assert!(send(&mut w.svm, &w.player, &[], vec![claim_ration_ix(&player)]).is_err());
    assert_eq!(food(&w, &player), [units; 4]);

    // The next UTC day: allowed again.
    set_time(&mut w.svm, 101 * DAY);
    send(&mut w.svm, &w.player, &[], vec![claim_ration_ix(&player)]).expect("claim on the next day");
    assert_eq!(food(&w, &player), [2 * units; 4]);
}

#[test]
fn the_ration_needs_an_initialized_profile() {
    let mut w = world();
    let player = w.player.pubkey();
    set_time(&mut w.svm, 100 * DAY);
    assert!(send(&mut w.svm, &w.player, &[], vec![claim_ration_ix(&player)]).is_err());
}

#[test]
fn the_ration_is_off_until_configured() {
    let mut w = world();
    let admin = w.admin.pubkey();
    let player = w.player.pubkey();
    set_time(&mut w.svm, 100 * DAY);
    send(&mut w.svm, &w.player, &[], vec![init_daily_ix(&player)]).unwrap();
    send(&mut w.svm, &w.admin, &[], vec![set_food_ix(&admin, 0, FOOD_PRICES)]).unwrap();
    assert!(send(&mut w.svm, &w.player, &[], vec![claim_ration_ix(&player)]).is_err());
}

#[test]
fn quests_pay_food_once_and_only_when_complete() {
    let mut w = world();
    let player = w.player.pubkey();
    let now = 200 * DAY + 100;
    set_time(&mut w.svm, now);
    let day = game_day(now);
    send(&mut w.svm, &w.player, &[], vec![init_daily_ix(&player)]).unwrap();

    // Nothing counted yet.
    assert!(send(&mut w.svm, &w.player, &[], vec![claim_quest_ix(&player, 0)]).is_err());

    // Pretend the program counted plenty of actions today.
    edit_daily(&mut w.svm, &player, |d| {
        d.quest_day = day;
        d.counts = [200; 5];
    });
    let mut expected = [0u16; 4];
    for slot in 0..QUESTS_PER_DAY as u8 {
        send(&mut w.svm, &w.player, &[], vec![claim_quest_ix(&player, slot)]).unwrap_or_else(|e| panic!("slot {slot}: {e}"));
        expected[quest_food(day, usize::from(slot))] += u16::from(quest_for(day, usize::from(slot)).2);
        assert_eq!(food(&w, &player), expected);
    }
    assert_eq!(read_daily(&w.svm, &player).claimed, 0b111);

    // A claimed quest cannot be claimed again, and slot 3 does not exist.
    for slot in [0u8, 1, 2, 3] {
        assert!(send(&mut w.svm, &w.player, &[], vec![claim_quest_ix(&player, slot)]).is_err(), "slot {slot}");
    }
    assert_eq!(food(&w, &player), expected);

    // Tomorrow's quests need tomorrow's actions: yesterday's counters do not carry over.
    set_time(&mut w.svm, now + DAY);
    assert!(send(&mut w.svm, &w.player, &[], vec![claim_quest_ix(&player, 0)]).is_err());
    assert_eq!(food(&w, &player), expected);
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
    assert!(send(&mut w.svm, &w.player, &[], vec![claim_quest_ix(&player, 0)]).is_err());
    edit_daily(&mut w.svm, &player, |d| d.counts[usize::from(kind)] = target);
    send(&mut w.svm, &w.player, &[], vec![claim_quest_ix(&player, 0)]).expect("claim once the target is reached");
}

#[test]
fn only_the_authority_configures_the_food_economy() {
    let mut w = world();
    let (admin, other) = (w.admin.pubkey(), w.other.pubkey());
    let ixs = vec![set_food_ix(&other, 9, FOOD_PRICES)];
    assert!(send(&mut w.svm, &w.other, &[], ixs).is_err());
    // Every price must be positive.
    let mut zero = FOOD_PRICES;
    zero[7] = 0;
    assert!(send(&mut w.svm, &w.admin, &[], vec![set_food_ix(&admin, 5, zero)]).is_err());
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
        // The three quests of a day pay three different foods.
        let foods: std::collections::HashSet<_> = (0..QUESTS_PER_DAY).map(|slot| quest_food(day, slot)).collect();
        assert_eq!(foods.len(), QUESTS_PER_DAY);
    }
    // Every template shows up eventually.
    let seen: std::collections::HashSet<_> = (1..=16u32).map(|d| quest_for(d, 0)).collect();
    assert_eq!(seen.len(), QUEST_TEMPLATES.len());
}

#[test]
fn counters_reset_when_a_new_day_starts() {
    let mut daily = PlayerProfile {
        owner: Pubkey::new_unique(),
        created_at: 0,
        discoveries: vec![],
        starter_claimed: false,
        island_level: 0,
        layout: [0; solana_anchor_starter::LAYOUT_BYTES],
        food: [0; 16],
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
