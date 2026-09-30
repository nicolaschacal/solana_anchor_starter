use anchor_lang::{
    prelude::Pubkey,
    solana_program::{instruction::Instruction, system_program},
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use litesvm::LiteSVM;
use solana_anchor_starter::{accounts, instruction, EvolutionTree, RegistryRoot, LOADER};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

fn root() -> Pubkey {
    Pubkey::find_program_address(&[b"registry"], &solana_anchor_starter::ID).0
}
fn tree(family: u8, version: u32) -> Pubkey {
    Pubkey::find_program_address(
        &[b"tree", &[family], &version.to_le_bytes()],
        &solana_anchor_starter::ID,
    )
    .0
}
fn ix(data: impl InstructionData, acc: impl ToAccountMetas) -> Instruction {
    Instruction::new_with_bytes(
        solana_anchor_starter::ID,
        &data.data(),
        acc.to_account_metas(None),
    )
}
fn send(svm: &mut LiteSVM, signer: &Keypair, instruction: Instruction) -> bool {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(
        &[instruction],
        Some(&signer.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    let result = svm.send_transaction(tx);
    if let Err(ref e) = result {
        eprintln!("Expected or unexpected rejection: {:?}", e.err);
    }
    result.is_ok()
}
fn setup() -> (LiteSVM, Keypair, Keypair) {
    let mut svm = LiteSVM::new();
    let admin = Keypair::new();
    let other = Keypair::new();
    svm.add_program(
        solana_anchor_starter::ID,
        include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/solana_anchor_starter.so"
        )),
    )
    .unwrap();
    let pd = Pubkey::find_program_address(&[solana_anchor_starter::ID.as_ref()], &LOADER).0;
    let mut account = svm.get_account(&pd).unwrap();
    account.data[12] = 1;
    account.data[13..45].copy_from_slice(admin.pubkey().as_ref());
    svm.set_account(pd, account).unwrap();
    for key in [&admin, &other] {
        svm.airdrop(&key.pubkey(), 2_000_000_000).unwrap();
    }
    (svm, admin, other)
}
fn initialize(svm: &mut LiteSVM, signer: &Keypair) -> bool {
    send(
        svm,
        signer,
        ix(
            instruction::InitializeRegistry {},
            accounts::InitializeRegistry {
                authority: signer.pubkey(),
                registry: root(),
                program_data: Pubkey::find_program_address(
                    &[solana_anchor_starter::ID.as_ref()],
                    &LOADER,
                )
                .0,
                system_program: system_program::ID,
            },
        ),
    )
}
fn create(svm: &mut LiteSVM, signer: &Keypair, family: u8, version: u32) -> bool {
    send(
        svm,
        signer,
        ix(
            instruction::CreateTree {
                family_id: family,
                version,
                merkle_root: [1; 32],
                content_hash: [2; 32],
                uri: "https://gateway.irys.xyz/test".into(),
            },
            accounts::CreateTree {
                authority: signer.pubkey(),
                registry: root(),
                tree: tree(family, version),
                system_program: system_program::ID,
            },
        ),
    )
}
fn activate(svm: &mut LiteSVM, signer: &Keypair, version: u32) -> bool {
    send(
        svm,
        signer,
        ix(
            instruction::ActivateTree {
                family_id: 0,
                version,
            },
            accounts::ManageTree {
                authority: signer.pubkey(),
                registry: root(),
                tree: tree(0, version),
            },
        ),
    )
}
fn close(svm: &mut LiteSVM, signer: &Keypair, version: u32) -> bool {
    send(
        svm,
        signer,
        ix(
            instruction::CloseTree {
                family_id: 0,
                version,
            },
            accounts::CloseTree {
                authority: signer.pubkey(),
                registry: root(),
                tree: tree(0, version),
            },
        ),
    )
}
fn read(svm: &LiteSVM) -> RegistryRoot {
    RegistryRoot::try_deserialize(&mut &svm.get_account(&root()).unwrap().data[..]).unwrap()
}
#[test]
fn full_registry_lifecycle() {
    let (mut svm, admin, other) = setup();
    assert!(!initialize(&mut svm, &other));
    assert!(initialize(&mut svm, &admin));
    assert_eq!(read(&svm).authority, admin.pubkey());
    assert!(!initialize(&mut svm, &admin));
    assert!(!create(&mut svm, &other, 0, 1));
    assert!(!create(&mut svm, &admin, 8, 1));
    assert!(!create(&mut svm, &admin, 0, 0));
    assert!(!create(&mut svm, &admin, 0, 2));
    assert!(create(&mut svm, &admin, 0, 1));
    let first = svm.get_account(&tree(0, 1)).unwrap().data;
    assert_eq!(
        EvolutionTree::try_deserialize(&mut &first[..])
            .unwrap()
            .version,
        1
    );
    assert!(activate(&mut svm, &admin, 1));
    assert_eq!(read(&svm).active_versions[0], 1);
    assert!(create(&mut svm, &admin, 0, 2));
    assert_eq!(read(&svm).active_versions[0], 1);
    assert_eq!(svm.get_account(&tree(0, 1)).unwrap().data, first);
    assert!(!activate(&mut svm, &other, 2));
    assert!(activate(&mut svm, &admin, 2));
    assert_eq!(read(&svm).active_versions[0], 2);
    assert!(activate(&mut svm, &admin, 1));
    assert_eq!(read(&svm).active_versions[0], 1);
    assert!(activate(&mut svm, &admin, 2));
    assert!(!close(&mut svm, &admin, 2));
    assert!(!close(&mut svm, &other, 1));
    assert!(close(&mut svm, &admin, 1));
    assert!(svm.get_account(&tree(0, 1)).is_none_or(|a| a.lamports == 0));
    assert!(!create(&mut svm, &admin, 0, 1));
    assert!(!activate(&mut svm, &admin, 1));
    assert!(!send(
        &mut svm,
        &admin,
        ix(
            instruction::ActivateTree {
                family_id: 0,
                version: 2
            },
            accounts::ManageTree {
                authority: admin.pubkey(),
                registry: root(),
                tree: root()
            }
        )
    ));
    assert!(send(
        &mut svm,
        &admin,
        ix(
            instruction::SetAuthority {
                new_authority: other.pubkey()
            },
            accounts::Admin {
                authority: admin.pubkey(),
                registry: root()
            }
        )
    ));
    assert_eq!(read(&svm).authority, other.pubkey());
    assert!(!create(&mut svm, &admin, 0, 3));
    assert!(create(&mut svm, &other, 0, 3));
}
#[test]
fn id_reservations_are_checked_and_never_reused() {
    let (mut svm, admin, other) = setup();
    assert!(initialize(&mut svm, &admin));
    let reserve = |signer: &Keypair, start, count| {
        ix(
            instruction::ReserveEvolutionIds {
                expected_next: start,
                count,
            },
            accounts::Admin {
                authority: signer.pubkey(),
                registry: root(),
            },
        )
    };
    assert!(!send(&mut svm, &other, reserve(&other, 1, 6)));
    assert!(send(&mut svm, &admin, reserve(&admin, 1, 6)));
    assert_eq!(read(&svm).next_evolution_id, 7);
    assert!(!send(&mut svm, &admin, reserve(&admin, 1, 6)));
    assert!(!send(&mut svm, &admin, reserve(&admin, 7, 0)));
    assert!(send(&mut svm, &admin, reserve(&admin, 7, 65529)));
    assert_eq!(read(&svm).next_evolution_id, 65536);
    assert!(!send(&mut svm, &admin, reserve(&admin, 65536, 1)));
}
