//! Class names from the AI pack, and turning them into names the user will recognise.
//!
//! The model's classes look like `black_backed_gull`. Olly's name map (shipped with the pack) gives each a common,
//! scientific and te reo Māori name. When the user already has a species with the same meaning in their own list
//! (for example "Kererū / NZ Pigeon"), the AI result uses that exact name so counts, hotkeys and exports line up.

use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub struct Names {
    pub common: String,
    pub scientific: String,
    pub te_reo: String,
}

#[derive(Debug, Clone, Default)]
pub struct NameMap {
    entries: HashMap<String, Names>,
}

impl NameMap {
    /// Parses `name_map.csv`: a header, then `class name,common,scientific,te reo Māori` rows (no quoting needed).
    pub fn parse_csv(csv: &str) -> Result<Self, String> {
        let mut lines = csv.trim_start_matches('\u{feff}').lines();
        let header = lines.next().ok_or("The name map is empty")?;
        if !header.to_lowercase().starts_with("class name") {
            return Err("The name map should start with a 'Class Name' column".to_string());
        }
        let mut entries = HashMap::new();
        for (i, line) in lines.enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let cols: Vec<&str> = line.split(',').map(str::trim).collect();
            if cols.len() < 2 || cols[0].is_empty() {
                return Err(format!("Name map line {} is not understood: {line}", i + 2));
            }
            entries.insert(
                cols[0].to_string(),
                Names {
                    common: cols[1].to_string(),
                    scientific: cols.get(2).unwrap_or(&"").to_string(),
                    te_reo: cols.get(3).unwrap_or(&"").to_string(),
                },
            );
        }
        Ok(Self { entries })
    }

    pub fn get(&self, class: &str) -> Option<&Names> {
        self.entries.get(class)
    }

    /// The common name, or a tidied class name when the map has no entry.
    pub fn common(&self, class: &str) -> String {
        match self.entries.get(class) {
            Some(n) if !n.common.is_empty() => n.common.clone(),
            _ => title_case(class),
        }
    }
}

/// `black_backed_gull` -> `Black Backed Gull`.
pub fn title_case(class: &str) -> String {
    class
        .split(['_', '-', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut chars = w.chars();
            chars.next().map_or(String::new(), |c| c.to_uppercase().collect::<String>() + chars.as_str())
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Lower case, no accents or macrons, letters and digits only: "Kererū" and "kereru" compare equal.
pub fn normalize(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'ā' | 'á' | 'à' | 'â' | 'ä' | 'ã' | 'Ā' | 'Á' | 'À' | 'Â' | 'Ä' | 'Ã' => 'a',
            'ē' | 'é' | 'è' | 'ê' | 'ë' | 'Ē' | 'É' | 'È' | 'Ê' | 'Ë' => 'e',
            'ī' | 'í' | 'ì' | 'î' | 'ï' | 'Ī' | 'Í' | 'Ì' | 'Î' | 'Ï' => 'i',
            'ō' | 'ó' | 'ò' | 'ô' | 'ö' | 'õ' | 'Ō' | 'Ó' | 'Ò' | 'Ô' | 'Ö' | 'Õ' => 'o',
            'ū' | 'ú' | 'ù' | 'û' | 'ü' | 'Ū' | 'Ú' | 'Ù' | 'Û' | 'Ü' => 'u',
            other => other,
        })
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// The user's own species name for this class, if their list has one. A species entry can hold several names
/// ("Kererū / NZ Pigeon", "Bellbird - korimako"); it matches when any one equals the class or common name. Failing
/// that, an entry matches when it contains the name as whole words ("Feral Cat" for cat, "Ship Rat" for rat), so
/// "Bird" never matches bellbird. An exact match always wins over a whole-word one.
pub fn match_known_species<'a>(class: &str, common: &str, known: &'a [String]) -> Option<&'a str> {
    let parts_of = |entry: &'a String| std::iter::once(entry.as_str()).chain(entry.split(['/', '|'])).chain(entry.split(" - "));

    let wanted = [normalize(class), normalize(common)];
    let exact = known.iter().find(|entry| parts_of(entry).map(normalize).any(|p| !p.is_empty() && wanted.contains(&p)));
    if exact.is_some() {
        return exact.map(String::as_str);
    }

    let wanted_words = [words(&class.replace('_', " ")), words(common)];
    known
        .iter()
        .find(|entry| {
            let entry_words = words(entry);
            wanted_words.iter().any(|w| !w.is_empty() && entry_words.windows(w.len()).any(|window| window == w.as_slice()))
        })
        .map(String::as_str)
}

/// The normalized words of a name: "Feral Cat (black)" -> ["feral", "cat", "black"].
fn words(name: &str) -> Vec<String> {
    name.split(|c: char| !c.is_alphanumeric()).map(normalize).filter(|w| !w.is_empty()).collect()
}

/// What to call a class in the app: the user's own name when there is one, else the common name.
pub fn display_species(class: &str, names: &NameMap, known: &[String]) -> String {
    let common = names.common(class);
    match_known_species(class, &common, known).map_or(common, str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CSV: &str = "Class Name,Common,Scientific,Te Reo Māori\nkereru,Kererū,Hemiphaga novaeseelandiae,Kererū\nblack_backed_gull,Black Backed Gull,Larus dominicanus,Karoro\npossum,Possum,Trichosurus vulpecula,Pōssum\n";

    #[test]
    fn parses_the_name_map() {
        let map = NameMap::parse_csv(CSV).unwrap();
        assert_eq!(map.get("black_backed_gull").unwrap().scientific, "Larus dominicanus");
        assert_eq!(map.get("kereru").unwrap().te_reo, "Kererū");
        assert_eq!(map.common("possum"), "Possum");
    }

    #[test]
    fn tolerates_a_byte_order_mark_and_blank_lines() {
        let map = NameMap::parse_csv(&format!("\u{feff}{CSV}\n\n")).unwrap();
        assert!(map.get("possum").is_some());
    }

    #[test]
    fn rejects_files_that_are_not_a_name_map() {
        assert!(NameMap::parse_csv("").is_err());
        assert!(NameMap::parse_csv("species,thing\nkea,Kea").is_err());
        assert!(NameMap::parse_csv("Class Name,Common\n,Kea").is_err());
    }

    #[test]
    fn falls_back_to_a_tidied_class_name() {
        let map = NameMap::parse_csv(CSV).unwrap();
        assert_eq!(map.common("fiordland_crested_penguin"), "Fiordland Crested Penguin");
        assert_eq!(title_case("kea"), "Kea");
        assert_eq!(title_case("white-faced_heron"), "White Faced Heron");
        assert_eq!(title_case(""), "");
    }

    #[test]
    fn normalises_macrons_case_and_punctuation() {
        assert_eq!(normalize("Kererū"), "kereru");
        assert_eq!(normalize("Pūkeko"), "pukeko");
        assert_eq!(normalize("Grey-faced Petrel"), "greyfacedpetrel");
        assert_eq!(normalize("black_backed_gull"), "blackbackedgull");
        assert_eq!(normalize("  "), "");
    }

    #[test]
    fn matches_the_users_own_species_names() {
        let known: Vec<String> = ["Possum", "Kererū / NZ Pigeon", "Bellbird - korimako", "Pūkeko", "Tūī"].map(String::from).to_vec();
        assert_eq!(match_known_species("kereru", "Kererū", &known), Some("Kererū / NZ Pigeon"));
        assert_eq!(match_known_species("bellbird", "Bellbird", &known), Some("Bellbird - korimako"));
        assert_eq!(match_known_species("pukeko", "Pukeko", &known), Some("Pūkeko"));
        assert_eq!(match_known_species("tui", "Tui", &known), Some("Tūī"));
        assert_eq!(match_known_species("stoat", "Stoat", &known), None);
        assert_eq!(match_known_species("possum", "Possum", &[]), None);
    }

    #[test]
    fn matches_whole_words_in_longer_names() {
        let known: Vec<String> = ["Feral Cat", "Ship Rat", "Bird", "Dog / Human", "Black-backed gull (adult)"].map(String::from).to_vec();
        assert_eq!(match_known_species("cat", "Cat", &known), Some("Feral Cat"));
        assert_eq!(match_known_species("rat", "Rat", &known), Some("Ship Rat"));
        assert_eq!(match_known_species("black_backed_gull", "Black Backed Gull", &known), Some("Black-backed gull (adult)"));
        assert_eq!(match_known_species("human", "Human", &known), Some("Dog / Human"));
        // "Bird" is not a word inside "bellbird", and a word must match whole.
        assert_eq!(match_known_species("bellbird", "Bellbird", &known), None);
        assert_eq!(match_known_species("pig", "Pig", &["Pigeon".to_string()]), None);
    }

    #[test]
    fn an_exact_match_beats_a_whole_word_one() {
        let known: Vec<String> = ["Ship Rat", "Rat"].map(String::from).to_vec();
        assert_eq!(match_known_species("rat", "Rat", &known), Some("Rat"));
    }

    #[test]
    fn display_name_uses_the_users_name_else_the_common_name() {
        let map = NameMap::parse_csv(CSV).unwrap();
        let known = vec!["Kererū / NZ Pigeon".to_string()];
        assert_eq!(display_species("kereru", &map, &known), "Kererū / NZ Pigeon");
        assert_eq!(display_species("black_backed_gull", &map, &known), "Black Backed Gull");
        assert_eq!(display_species("mystery_bird", &map, &known), "Mystery Bird");
    }

    #[test]
    fn the_real_name_map_covers_every_class() {
        // Only runs when TRAAACE_ALITA_RELEASE points at a downloaded Alita release.
        let Ok(dir) = std::env::var("TRAAACE_ALITA_RELEASE") else { return };
        let dir = std::path::Path::new(&dir);
        let (map_path, names_path) = (dir.join("resources/name_map_edited.csv"), dir.join("models/Exp_60/Exp_60_run_01_class_names.json"));
        let (Ok(csv), Ok(json)) = (std::fs::read_to_string(map_path), std::fs::read_to_string(names_path)) else { return };
        let map = NameMap::parse_csv(&csv).unwrap();
        for class in crate::ai::parse_class_names(&json).unwrap() {
            assert!(map.get(&class).is_some(), "no entry for {class}");
        }
    }
}
