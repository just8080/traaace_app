//! Checking that the add-on's download list really is ours. The list is signed with a private key that never leaves
//! the maintainer's computer (minisign format, Ed25519); the app holds the public half. A list that is not signed with
//! one of these keys is refused before anything in it is read, so a changed server or download cannot swap the files.

use minisign_verify::{PublicKey, Signature};

/// Public keys whose signature the app accepts. Room for two, so a key can be replaced without breaking older copies of
/// the app (sign with both for a while, then drop the old one).
pub const TRUSTED_KEYS: &[&str] = &[
    // TRAAACE AI add-on signing key, key ID EA1A5E626D0137AD (made 27 Oct 2026).
    "RWStNwFtYl4a6nGIv6bzeIVxYJ7NH1u9JG42LUaAvzKHkau+DpuR8hWA",
];

/// Where the signature sits: next to the list, with `.minisig` added.
pub fn signature_url(manifest_url: &str) -> String {
    format!("{manifest_url}.minisig")
}

/// Accepts `text` only when `signature` is a valid signature for it by one of `keys` (base64 minisign public keys).
pub fn verify_manifest(text: &str, signature: &str, keys: &[String]) -> Result<(), String> {
    if keys.is_empty() {
        return Err("This copy of TRAAACE has no key to check the AI add-on with, so it can't install it.".to_string());
    }
    let signature = Signature::decode(signature).map_err(|_| "The AI add-on's signature can't be read.".to_string())?;
    let trusted = keys.iter().filter_map(|k| PublicKey::from_base64(k.trim()).ok());
    if trusted.into_iter().any(|key| key.verify(text.as_bytes(), &signature, false).is_ok()) {
        Ok(())
    } else {
        Err("The AI add-on's details failed their signature check, so they may have been changed. Nothing was installed.".to_string())
    }
}

/// A throwaway key pair for tests only (never the real one), and a signature for `text`.
#[cfg(test)]
pub fn test_key_and_signature(text: &str) -> (String, String) {
    let pair = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
    let signature = minisign::sign(Some(&pair.pk), &pair.sk, text.as_bytes(), None, None).unwrap();
    (pair.pk.to_base64(), signature.into_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_list_signed_with_a_trusted_key() {
        let (key, signature) = test_key_and_signature("{\"schema\":1}");
        assert_eq!(verify_manifest("{\"schema\":1}", &signature, &[key]), Ok(()));
    }

    #[test]
    fn refuses_a_changed_list() {
        let (key, signature) = test_key_and_signature("{\"schema\":1}");
        let err = verify_manifest("{\"schema\":2}", &signature, &[key]).unwrap_err();
        assert!(err.contains("failed their signature check"), "{err}");
    }

    #[test]
    fn refuses_a_list_signed_with_another_key() {
        let (_, signature) = test_key_and_signature("{}");
        let (other_key, _) = test_key_and_signature("{}");
        assert!(verify_manifest("{}", &signature, &[other_key]).is_err());
    }

    #[test]
    fn accepts_any_of_two_keys_during_a_key_change() {
        let (old_key, _) = test_key_and_signature("{}");
        let (new_key, signature) = test_key_and_signature("{}");
        assert_eq!(verify_manifest("{}", &signature, &[old_key, new_key]), Ok(()));
    }

    #[test]
    fn refuses_everything_without_a_key_or_with_a_broken_signature() {
        let (key, _) = test_key_and_signature("{}");
        assert!(verify_manifest("{}", "not a signature", &[key]).unwrap_err().contains("can't be read"));
        assert!(verify_manifest("{}", "anything", &[]).unwrap_err().contains("no key"));
    }

    #[test]
    fn the_built_in_keys_are_valid() {
        assert!(!TRUSTED_KEYS.is_empty());
        for key in TRUSTED_KEYS {
            assert!(PublicKey::from_base64(key).is_ok(), "{key}");
        }
    }

    #[test]
    fn the_signature_sits_next_to_the_list() {
        assert_eq!(signature_url("https://traaace.ing/ai/manifest.json"), "https://traaace.ing/ai/manifest.json.minisig");
    }
}
