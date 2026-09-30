use solana_sha256_hasher::hashv;

/// Domain-separated, lexicographically sorted pairs; duplicate odd nodes.
pub fn verify_evolution_proof(
    canonical_leaf: &[u8],
    siblings: &[[u8; 32]],
    root: &[u8; 32],
) -> bool {
    if siblings.len() > 16 {
        return false;
    }
    let mut current = hashv(&[&[0], canonical_leaf]).to_bytes();
    for sibling in siblings {
        current = if current <= *sibling {
            hashv(&[&[1], &current, sibling]).to_bytes()
        } else {
            hashv(&[&[1], sibling, &current]).to_bytes()
        };
    }
    current == *root
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hex(s: &str) -> [u8; 32] {
        let mut bytes = [0; 32];
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
        }
        bytes
    }
    #[test]
    fn verifies_typescript_fixture_and_rejects_tampering() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../artifacts/sample/merkle-fixture.json"
        ))
        .unwrap();
        let leaf = fixture["canonicalLeaf"].as_str().unwrap().as_bytes();
        let siblings: Vec<_> = fixture["siblings"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| hex(s.as_str().unwrap()))
            .collect();
        let root = hex(fixture["root"].as_str().unwrap());
        assert!(verify_evolution_proof(leaf, &siblings, &root));
        let mut bad = leaf.to_vec();
        bad[0] ^= 1;
        assert!(!verify_evolution_proof(&bad, &siblings, &root));
        let mut wrong = siblings.clone();
        wrong[0][0] ^= 1;
        assert!(!verify_evolution_proof(leaf, &wrong, &root));
        assert!(!verify_evolution_proof(leaf, &[[0; 32]; 17], &root));
    }
}
