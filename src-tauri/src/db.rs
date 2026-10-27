use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveDateTime, TimeZone, Timelike};
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

fn naive_to_local(naive: NaiveDateTime) -> DateTime<Local> {
    if let Some(local) = Local.from_local_datetime(&naive).single() {
        return local;
    }
    if let Some(local) = Local.from_local_datetime(&naive).earliest() {
        return local;
    }
    if let Some(local) = Local.from_local_datetime(&naive).latest() {
        return local;
    }
    // Fallback: If OS timezone mapping fails (e.g. on Linux without tzdata or Windows DST gap),
    // apply system's current local offset directly without discarding the parsed date & time!
    let offset = *Local::now().offset();
    DateTime::<Local>::from_naive_utc_and_offset(naive - offset, offset)
}

pub fn parse_to_local_datetime(s: &str) -> Option<DateTime<Local>> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return Some(dt.with_timezone(&Local));
    }
    for tz_fmt in &[
        "%Y-%m-%d %H:%M:%S %z",
        "%Y-%m-%d %H:%M:%S%:z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S%:z",
    ] {
        if let Ok(dt) = DateTime::parse_from_str(trimmed, tz_fmt) {
            return Some(dt.with_timezone(&Local));
        }
    }
    for fmt in &[
        // Standard ISO / RFC-like
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S%.f",
        // 12-hour AM/PM formats (Windows Excel & US)
        "%Y-%m-%d %I:%M:%S %p",
        "%Y-%m-%d %I:%M %p",
        "%Y-%m-%dT%I:%M:%S %p",
        "%Y-%m-%dT%I:%M %p",
        "%Y-%m-%d %I:%M:%S%p",
        "%Y-%m-%dT%I:%M:%S%p",
        // Day-first slash formats (NZ / UK / Aus / EU)
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%YT%H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%YT%H:%M",
        "%d/%m/%Y %I:%M:%S %p",
        "%d/%m/%Y %I:%M %p",
        "%d/%m/%YT%I:%M:%S %p",
        "%d/%m/%YT%I:%M %p",
        // Month-first slash formats (US)
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%YT%H:%M:%S",
        "%m/%d/%Y %H:%M",
        "%m/%d/%YT%H:%M",
        "%m/%d/%Y %I:%M:%S %p",
        "%m/%d/%Y %I:%M %p",
        "%m/%d/%YT%I:%M:%S %p",
        "%m/%d/%YT%I:%M %p",
        // Year-first slash formats
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%dT%H:%M:%S",
        "%Y/%m/%d %H:%M",
        "%Y/%m/%dT%H:%M",
        "%Y/%m/%d %I:%M:%S %p",
        "%Y/%m/%d %I:%M %p",
        // EXIF colon formats
        "%Y:%m:%d %H:%M:%S",
        "%Y:%m:%dT%H:%M:%S",
        "%Y:%m:%d %H:%M",
        "%Y:%m:%dT%H:%M",
        // Day-first dash formats
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%YT%H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%d-%m-%YT%H:%M",
        "%d-%m-%Y %I:%M:%S %p",
        "%d-%m-%Y %I:%M %p",
        // Compact
        "%Y%m%d_%H%M%S",
        "%Y%m%d %H%M%S",
    ] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(trimmed, fmt) {
            return Some(naive_to_local(naive));
        }
    }
    for date_fmt in &[
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%m/%d/%Y",
        "%Y/%m/%d",
        "%Y:%m:%d",
        "%d-%m-%Y",
        "%Y%m%d",
    ] {
        if let Ok(naive_date) = NaiveDate::parse_from_str(trimmed, date_fmt) {
            if let Some(naive) = naive_date.and_hms_opt(12, 0, 0) {
                return Some(naive_to_local(naive));
            }
        }
    }
    None
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KeymapItem {
    pub keystrokes: String,
    pub species: String,
    pub builtin: bool,
    pub sort_order: i64,
    pub hidden: bool,
    pub locked: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DbBatch {
    pub name: String,
    pub path: String,
    pub site: String,
    pub created_at: String,
    #[serde(default)]
    pub total_images: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CsvObservationInput {
    pub site: String,
    pub timestamp: String,
    pub species: String,
    pub count: i64,
    pub sequence: usize,
    pub comment: String,
    pub species_in_frame: usize,
    pub filename: String,
    pub batch: String,
    pub sha256: String,
    #[serde(default)]
    pub raw_filename: Option<String>,
    #[serde(default)]
    pub batch_path: Option<String>,
}

pub struct Database {
    conn: Connection,
}

const KEYMAP_COLUMNS: &str = "keystrokes, species, builtin, sort_order, hidden, locked";

fn map_keymap_row(row: &rusqlite::Row<'_>) -> Result<KeymapItem> {
    Ok(KeymapItem {
        keystrokes: row.get(0)?,
        species: row.get(1)?,
        builtin: row.get(2)?,
        sort_order: row.get(3)?,
        hidden: row.get(4)?,
        locked: row.get(5)?,
    })
}

impl Database {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let p = path.as_ref();
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(p)?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    pub fn get_stats(&self) -> Result<(usize, usize, usize)> {
        let batches: usize = self.conn.query_row("SELECT count(*) FROM batches", [], |r| r.get(0)).unwrap_or(0);
        let classifications: usize = self.conn.query_row("SELECT count(*) FROM classifications", [], |r| r.get(0)).unwrap_or(0);
        let species: usize = self.conn.query_row("SELECT count(*) FROM keymap", [], |r| r.get(0)).unwrap_or(0);
        Ok((batches, classifications, species))
    }

    pub fn export_backup_db<P: AsRef<Path>>(&self, dest_path: P) -> Result<()> {
        let p = dest_path.as_ref();
        if p.exists() {
            let _ = std::fs::remove_file(p);
        }
        let dest_str = p.to_string_lossy().to_string();
        self.conn.execute("VACUUM INTO ?1", params![dest_str])?;
        Ok(())
    }

    pub fn prepare_for_replace(&mut self) -> Result<()> {
        self.conn = Connection::open_in_memory()?;
        Ok(())
    }

    pub fn reload<P: AsRef<Path>>(&mut self, path: P) -> Result<()> {
        let p = path.as_ref();
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(p)?;
        self.conn = conn;
        self.init_schema()?;
        Ok(())
    }

    fn init_schema(&self) -> Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS keymap (
                keystrokes TEXT PRIMARY KEY NOT NULL,
                species TEXT NOT NULL,
                builtin INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 1,
                hidden INTEGER NOT NULL DEFAULT 0,
                locked INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_keystrokes ON keymap (keystrokes ASC);
            CREATE TABLE IF NOT EXISTS comments (
                comment TEXT NOT NULL PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS db_version (
                version INTEGER
            );
            CREATE TABLE IF NOT EXISTS batches (
                name TEXT PRIMARY KEY NOT NULL,
                path TEXT NOT NULL,
                site TEXT NOT NULL,
                created_at TEXT NOT NULL,
                total_images INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS classifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_name TEXT NOT NULL,
                file_name TEXT NOT NULL,
                species TEXT NOT NULL,
                animal_count INTEGER NOT NULL DEFAULT 1,
                comment TEXT NOT NULL DEFAULT '',
                sequence INTEGER NOT NULL DEFAULT 0,
                species_in_frame INTEGER NOT NULL DEFAULT 1,
                sha256 TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE(batch_name, file_name, species, sequence)
            );
            CREATE INDEX IF NOT EXISTS idx_classifications_batch ON classifications(batch_name);
            CREATE INDEX IF NOT EXISTS idx_classifications_batch_file ON classifications(batch_name, file_name);
            CREATE TABLE IF NOT EXISTS media_status (
                batch_name TEXT NOT NULL,
                file_name TEXT NOT NULL,
                is_exported INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (batch_name, file_name)
            );
            CREATE TABLE IF NOT EXISTS ai_suggestions (
                batch_name TEXT NOT NULL,
                file_name TEXT NOT NULL,
                data TEXT NOT NULL,
                scanned_at TEXT NOT NULL,
                PRIMARY KEY (batch_name, file_name)
            );",
        )?;

        // Ensure total_images column exists on existing databases
        let _ = self.conn.execute(
            "ALTER TABLE batches ADD COLUMN total_images INTEGER NOT NULL DEFAULT 0",
            [],
        );

        let keymap_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM keymap", [], |r| r.get(0))
            .unwrap_or(0);

        if keymap_count == 0 {
            self.reset_default_keymaps()?;
        }

        let comments_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM comments", [], |r| r.get(0))
            .unwrap_or(0);

        if comments_count == 0 {
            self.reset_default_comments()?;
        }

        Ok(())
    }

    fn query_keymap(&self, where_clause: &str) -> Result<Vec<KeymapItem>> {
        let sql = format!(
            "SELECT {KEYMAP_COLUMNS} FROM keymap {where_clause} ORDER BY sort_order, keystrokes"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], map_keymap_row)?;
        rows.collect()
    }

    pub fn get_active_keymap(&self) -> Result<Vec<KeymapItem>> {
        self.query_keymap("WHERE hidden = 0")
    }

    pub fn get_all_keymap(&self) -> Result<Vec<KeymapItem>> {
        self.query_keymap("")
    }

    pub fn save_keymap_item(&self, item: &KeymapItem) -> Result<Vec<KeymapItem>> {
        let normalized = item.keystrokes.trim().to_uppercase();
        let species = item.species.trim().to_string();

        let existing: Result<(bool, String), _> = self.conn.query_row(
            "SELECT builtin, species FROM keymap WHERE keystrokes = ?1",
            params![normalized],
            |r| Ok((r.get(0)?, r.get(1)?)),
        );

        match existing {
            Ok((builtin, old_species)) => {
                if builtin {
                    self.conn.execute(
                        "UPDATE keymap SET sort_order = ?1, hidden = ?2 WHERE keystrokes = ?3",
                        params![item.sort_order, item.hidden, normalized],
                    )?;
                } else {
                    let target_species = if species.is_empty() { old_species } else { species };
                    self.conn.execute(
                        "UPDATE keymap SET species = ?1, sort_order = ?2, hidden = ?3 WHERE keystrokes = ?4",
                        params![target_species, item.sort_order, item.hidden, normalized],
                    )?;
                }
            }
            Err(_) => {
                self.conn.execute(
                    "INSERT INTO keymap (keystrokes, species, builtin, sort_order, hidden, locked)
                     VALUES (?1, ?2, 0, ?3, ?4, 0)",
                    params![normalized, species, item.sort_order, item.hidden],
                )?;
            }
        }

        self.get_all_keymap()
    }

    pub fn delete_keymap_item(&self, keystrokes: &str) -> Result<Vec<KeymapItem>> {
        let normalized = keystrokes.trim().to_uppercase();
        self.conn.execute("DELETE FROM keymap WHERE keystrokes = ?1", params![normalized])?;
        self.get_all_keymap()
    }

    pub fn reorder_keymap(&mut self, ordered_keys: &[String]) -> Result<Vec<KeymapItem>> {
        let tx = self.conn.transaction()?;
        {
            let mut stmt = tx.prepare("UPDATE keymap SET sort_order = ?1 WHERE keystrokes = ?2")?;
            for (idx, key) in ordered_keys.iter().enumerate() {
                let normalized = key.trim().to_uppercase();
                if !normalized.is_empty() {
                    stmt.execute(params![(idx + 1) as i64, normalized])?;
                }
            }
        }
        tx.commit()?;
        self.get_all_keymap()
    }

    pub fn reset_default_keymaps(&self) -> Result<Vec<KeymapItem>> {
        // NZ species list, in display order. Keystrokes are unique, avoid digits and the system
        // keys (G = grid, C = comments as a lone key), and only P, M, R and W are also the first
        // letter of a longer code (so those four wait briefly for a possible second key).
        let default_species = [
            ("BR", "Band-rail"),
            ("BB", "Bellbird"),
            ("BS", "Black Swan"),
            ("BK", "Blackbird"),
            ("BQ", "Brown Quail"),
            ("CQ", "California Quail"),
            ("CT", "Cat"),
            ("DG", "Dog"),
            ("F", "Fantail"),
            ("SW", "Fluttering Shearwater"),
            ("PT", "Grey-faced Petrel"),
            ("HK", "Harrier Hawk"),
            ("HG", "Hedgehog"),
            ("KU", "Kererū / NZ Pigeon"),
            ("KI", "Kiwi"),
            ("BP", "Little Blue Penguin"),
            ("MO", "Morepork / Ruru"),
            ("M", "Mouse"),
            ("MY", "Myna"),
            ("OC", "Oystercatcher"),
            ("PD", "Paradise Duck"),
            ("PK", "Pāteke / Brown Teal"),
            ("PH", "Pheasant"),
            ("P", "Possum"),
            ("PO", "Pūkeko"),
            ("RB", "Rabbit"),
            ("R", "Rat"),
            ("RO", "Robin"),
            ("RS", "Rosella"),
            ("ST", "Stoat"),
            ("TK", "Takahē"),
            ("TH", "Thrush"),
            ("SB", "Tīeke / Saddleback"),
            ("TU", "Tūī"),
            ("W", "Weasel"),
            ("WF", "White-faced Heron"),
            ("WH", "Whitehead"),
            ("HU", "Human"),
            ("V", "Vehicle"),
            ("LS", "Farm animal"),
        ];

        // Run atomically so a mid-way failure can't leave the table empty.
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM keymap", [])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO keymap (keystrokes, species, builtin, sort_order, hidden, locked)
                 VALUES (?1, ?2, 1, ?3, 0, 0)",
            )?;
            for (idx, (ks, sp)) in default_species.iter().enumerate() {
                stmt.execute(params![*ks, *sp, (idx + 1) as i64])?;
            }
        }
        tx.commit()?;
        self.get_all_keymap()
    }

    pub fn get_comments(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT comment FROM comments ORDER BY comment")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect()
    }

    pub fn add_comment(&self, comment: &str) -> Result<Vec<String>> {
        let trimmed = comment.trim();
        if !trimmed.is_empty() {
            self.conn.execute("INSERT OR IGNORE INTO comments (comment) VALUES (?1)", params![trimmed])?;
        }
        self.get_comments()
    }

    pub fn delete_comment(&self, comment: &str) -> Result<Vec<String>> {
        let trimmed = comment.trim();
        if !trimmed.is_empty() {
            self.conn.execute("DELETE FROM comments WHERE comment = ?1", params![trimmed])?;
        }
        self.get_comments()
    }

    pub fn reset_default_comments(&self) -> Result<Vec<String>> {
        let defaults = [
            "False trigger",
            "Multiple animals",
            "Poor quality / blurry",
            "Juvenile / young in frame",
            "Injured animal",
            "Camera moved / obstruction",
        ];

        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM comments", [])?;
        {
            let mut stmt = tx.prepare("INSERT OR IGNORE INTO comments (comment) VALUES (?1)")?;
            for c in defaults {
                stmt.execute(params![c])?;
            }
        }
        tx.commit()?;
        self.get_comments()
    }

    // Batches
    pub fn add_batch(&self, batch: &DbBatch) -> Result<()> {
        self.conn.execute(
            "INSERT INTO batches (name, path, site, created_at, total_images)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(name) DO UPDATE SET
                path = excluded.path,
                site = CASE 
                    WHEN excluded.site != '' AND excluded.site != 'SITE' THEN excluded.site 
                    WHEN batches.site != '' THEN batches.site
                    ELSE excluded.site 
                END,
                total_images = CASE WHEN excluded.total_images > 0 THEN excluded.total_images ELSE batches.total_images END",
            params![batch.name, batch.path, batch.site, batch.created_at, batch.total_images as i64],
        )?;
        Ok(())
    }

    pub fn update_batch_site(&self, name: &str, site: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE batches SET site = ?1 WHERE name = ?2",
            params![site, name],
        )?;
        Ok(())
    }

    pub fn update_batch_total_images(&self, name: &str, total: usize) -> Result<()> {
        self.conn.execute(
            "UPDATE batches SET total_images = ?1 WHERE name = ?2",
            params![total as i64, name],
        )?;
        Ok(())
    }

    pub fn update_batch_path(&self, name: &str, path: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE batches SET path = ?1 WHERE name = ?2",
            params![path, name],
        )?;
        Ok(())
    }

    pub fn get_batch(&self, name: &str) -> Result<Option<DbBatch>> {
        let mut stmt = self.conn.prepare("SELECT name, path, site, created_at, total_images FROM batches WHERE name = ?1")?;
        let mut rows = stmt.query(params![name])?;
        if let Some(row) = rows.next()? {
            let total_images_i64: i64 = row.get(4).unwrap_or(0);
            Ok(Some(DbBatch {
                name: row.get(0)?,
                path: row.get(1)?,
                site: row.get(2)?,
                created_at: row.get(3)?,
                total_images: total_images_i64.max(0) as usize,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_all_batches(&self) -> Result<Vec<DbBatch>> {
        let mut stmt = self.conn.prepare("SELECT name, path, site, created_at, total_images FROM batches ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], |row| {
            let total_images_i64: i64 = row.get(4).unwrap_or(0);
            Ok(DbBatch {
                name: row.get(0)?,
                path: row.get(1)?,
                site: row.get(2)?,
                created_at: row.get(3)?,
                total_images: total_images_i64.max(0) as usize,
            })
        })?;
        rows.collect()
    }

    pub fn delete_batch(&self, name: &str) -> Result<()> {
        self.conn.execute("DELETE FROM batches WHERE name = ?1", params![name])?;
        self.conn.execute("DELETE FROM classifications WHERE batch_name = ?1", params![name])?;
        self.conn.execute("DELETE FROM media_status WHERE batch_name = ?1", params![name])?;
        self.conn.execute("DELETE FROM ai_suggestions WHERE batch_name = ?1", params![name])?;
        Ok(())
    }

    pub fn get_batch_counts(&self) -> Result<(HashMap<String, usize>, HashMap<String, usize>)> {
        let mut classified = HashMap::new();
        let mut exported = HashMap::new();

        let mut stmt1 = self.conn.prepare(
            "SELECT batch_name, COUNT(DISTINCT file_name) FROM classifications GROUP BY batch_name"
        )?;
        let rows1 = stmt1.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as usize)))?;
        for r in rows1 {
            let (b, c) = r?;
            classified.insert(b, c);
        }

        let mut stmt2 = self.conn.prepare(
            "SELECT batch_name, COUNT(*) FROM media_status WHERE is_exported = 1 GROUP BY batch_name"
        )?;
        let rows2 = stmt2.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as usize)))?;
        for r in rows2 {
            let (b, c) = r?;
            exported.insert(b, c);
        }

        Ok((classified, exported))
    }

    // Classifications
    pub fn save_classifications(
        &mut self,
        batch_name: &str,
        file_name: &str,
        items: &[crate::classifier::ClassificationItem],
    ) -> Result<usize> {
        self.save_classifications_bulk(batch_name, &[(file_name.to_string(), items.to_vec())])
    }

    /// Saves the classifications of many files in one transaction (accepting a whole scan of AI suggestions).
    /// Each file's earlier classifications are replaced. Returns how many files were written.
    pub fn save_classifications_bulk(
        &mut self,
        batch_name: &str,
        files: &[(String, Vec<crate::classifier::ClassificationItem>)],
    ) -> Result<usize> {
        let tx = self.conn.transaction()?;
        let now = Local::now().to_rfc3339();
        {
            let mut delete = tx.prepare("DELETE FROM classifications WHERE batch_name = ?1 AND file_name = ?2")?;
            let mut insert = tx.prepare(
                "INSERT INTO classifications (batch_name, file_name, species, animal_count, comment, sequence, species_in_frame, sha256, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )?;
            for (file_name, items) in files {
                delete.execute(params![batch_name, file_name])?;
                let total_in_frame = items.len();
                for (seq, it) in items.iter().enumerate() {
                    insert.execute(params![
                        batch_name,
                        file_name,
                        it.species.trim(),
                        it.count,
                        it.comment.trim(),
                        seq as i64,
                        total_in_frame as i64,
                        it.sha256.clone().unwrap_or_default(),
                        now
                    ])?;
                }
            }
        }
        tx.commit()?;
        Ok(files.len())
    }

    // AI suggestions (what the optional AI add-on thought of each photo; `data` is the front end's JSON)
    pub fn save_ai_suggestions(&mut self, batch_name: &str, rows: &[(String, String)]) -> Result<usize> {
        let tx = self.conn.transaction()?;
        let now = Local::now().to_rfc3339();
        {
            let mut stmt = tx.prepare(
                "INSERT INTO ai_suggestions (batch_name, file_name, data, scanned_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(batch_name, file_name) DO UPDATE SET data = excluded.data, scanned_at = excluded.scanned_at",
            )?;
            for (file_name, data) in rows {
                stmt.execute(params![batch_name, file_name, data, now])?;
            }
        }
        tx.commit()?;
        Ok(rows.len())
    }

    pub fn get_ai_suggestions(&self, batch_name: &str) -> Result<Vec<(String, String)>> {
        let mut stmt = self.conn.prepare("SELECT file_name, data FROM ai_suggestions WHERE batch_name = ?1 ORDER BY file_name")?;
        let rows = stmt.query_map(params![batch_name], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect()
    }

    pub fn clear_ai_suggestions(&self, batch_name: &str) -> Result<()> {
        self.conn.execute("DELETE FROM ai_suggestions WHERE batch_name = ?1", params![batch_name])?;
        Ok(())
    }

    pub fn get_classifications_map_for_batch(
        &self,
        batch_name: &str,
    ) -> Result<HashMap<String, Vec<crate::classifier::ClassificationItem>>> {
        let mut stmt = self.conn.prepare(
            "SELECT file_name, species, animal_count, comment, sha256, species_in_frame
             FROM classifications
             WHERE batch_name = ?1
             ORDER BY file_name ASC, sequence ASC",
        )?;
        let mut map: HashMap<String, Vec<crate::classifier::ClassificationItem>> = HashMap::new();
        let rows = stmt.query_map(params![batch_name], |row| {
            Ok((
                row.get::<_, String>(0)?,
                crate::classifier::ClassificationItem {
                    species: row.get(1)?,
                    count: row.get(2)?,
                    comment: row.get(3)?,
                    sha256: row.get(4)?,
                    species_in_frame: row.get::<_, Option<i64>>(5)?.map(|v| v as usize),
                },
            ))
        })?;
        for item in rows {
            let (file_name, classification) = item?;
            map.entry(file_name).or_default().push(classification);
        }
        Ok(map)
    }

    pub fn get_media_status_map_for_batch(
        &self,
        batch_name: &str,
    ) -> Result<HashMap<String, bool>> {
        let mut stmt = self.conn.prepare(
            "SELECT file_name, is_exported FROM media_status WHERE batch_name = ?1",
        )?;
        let mut map = HashMap::new();
        let rows = stmt.query_map(params![batch_name], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? == 1))
        })?;
        for item in rows {
            let (file_name, is_exp) = item?;
            map.insert(file_name, is_exp);
        }
        Ok(map)
    }

    pub fn mark_media_exported(&self, batch_name: &str, file_name: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO media_status (batch_name, file_name, is_exported)
             VALUES (?1, ?2, 1)
             ON CONFLICT(batch_name, file_name) DO UPDATE SET is_exported = 1",
            params![batch_name, file_name],
        )?;
        Ok(())
    }

    pub fn get_all_observations(&self) -> Result<Vec<crate::classifier::ObservationRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT c.id, c.batch_name, c.file_name, c.species, c.animal_count, c.comment, c.created_at, COALESCE(b.site, 'SITE')
             FROM classifications c
             LEFT JOIN batches b ON c.batch_name = b.name
             ORDER BY c.created_at DESC"
        )?;

        let rows = stmt.query_map([], |r| {
            let id_num: i64 = r.get(0)?;
            let batch: String = r.get(1)?;
            let filename: String = r.get(2)?;
            let species: String = r.get(3)?;
            let count: i64 = r.get(4)?;
            let comment: String = r.get(5)?;
            let created_at_str: String = r.get(6)?;
            let site: String = r.get(7)?;

            let (dt, date_str, year, month, day, day_of_week, hour) =
                if let Some(local) = parse_to_local_datetime(&created_at_str) {
                    (
                        local.to_rfc3339(),
                        local.format("%Y-%m-%d").to_string(),
                        local.year(),
                        local.month(),
                        local.day(),
                        local.weekday().num_days_from_sunday(),
                        local.hour(),
                    )
                } else {
                    let now = Local::now();
                    (
                        now.to_rfc3339(),
                        now.format("%Y-%m-%d").to_string(),
                        now.year(),
                        now.month(),
                        now.day(),
                        now.weekday().num_days_from_sunday(),
                        now.hour(),
                    )
                };

            let id = format!("{}_{}_{}_{}", batch, filename, species, id_num);

            Ok(crate::classifier::ObservationRecord {
                id,
                timestamp: dt,
                date_str,
                year,
                month,
                day,
                day_of_week,
                hour,
                site,
                batch,
                species,
                count,
                comment,
                filename,
                source: "database".to_string(),
            })
        })?;

        let mut list = Vec::new();
        for item in rows {
            list.push(item?);
        }
        Ok(list)
    }

    pub fn import_csv_observations(
        &mut self,
        records: &[CsvObservationInput],
    ) -> Result<(usize, usize)> {
        let tx = self.conn.transaction()?;
        let mut affected_batches = std::collections::HashSet::new();
        let mut imported_records = 0;
        {
            let mut batch_stmt = tx.prepare(
                "INSERT INTO batches (name, path, site, created_at, total_images)
                 VALUES (?1, ?2, ?3, ?4, 0)
                 ON CONFLICT(name) DO UPDATE SET
                    path = CASE WHEN batches.path = '' OR batches.path IS NULL THEN excluded.path ELSE batches.path END,
                    site = CASE WHEN batches.site = 'SITE' OR batches.site = '' THEN excluded.site ELSE batches.site END"
            )?;

            let mut class_stmt = tx.prepare(
                "INSERT INTO classifications (batch_name, file_name, species, animal_count, comment, sequence, species_in_frame, sha256, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(batch_name, file_name, species, sequence) DO UPDATE SET
                    animal_count = excluded.animal_count,
                    comment = excluded.comment,
                    species_in_frame = excluded.species_in_frame,
                    sha256 = CASE WHEN excluded.sha256 != '' THEN excluded.sha256 ELSE classifications.sha256 END,
                    created_at = excluded.created_at"
            )?;

            let mut del_unclassified_stmt = tx.prepare(
                "DELETE FROM classifications
                 WHERE batch_name = ?1
                   AND (file_name = ?2 OR file_name = ?3 OR file_name LIKE ?4)
                   AND species = 'Unclassified'"
            )?;

            for r in records {
                let batch_name = r.batch.trim();
                let file_name = r.filename.trim();
                let species = r.species.trim();
                if species.is_empty() && file_name.is_empty() {
                    continue;
                }

                affected_batches.insert(batch_name.to_string());

                let b_path = r.batch_path.as_deref().unwrap_or("").trim();

                // Ensure batch exists
                batch_stmt.execute(params![
                    batch_name,
                    b_path,
                    r.site.trim(),
                    r.timestamp.trim(),
                ])?;

                // Purge dummy Unclassified row if this is now a classified record
                if species != "Unclassified" && !species.is_empty() {
                    let raw_fn = r.raw_filename.as_deref().unwrap_or(file_name);
                    let _ = del_unclassified_stmt.execute(params![
                        batch_name,
                        file_name,
                        raw_fn,
                        format!("%__{}", raw_fn)
                    ]);
                }

                // Upsert classification
                class_stmt.execute(params![
                    batch_name,
                    file_name,
                    species,
                    r.count,
                    r.comment.trim(),
                    r.sequence as i64,
                    r.species_in_frame as i64,
                    r.sha256.trim(),
                    r.timestamp.trim(),
                ])?;

                imported_records += 1;
            }
        }

        // Update total_images for any affected batches whose total_images was 0
        for b_name in &affected_batches {
            let _ = tx.execute(
                "UPDATE batches SET total_images = (
                    SELECT COUNT(DISTINCT file_name) FROM classifications WHERE batch_name = ?1
                ) WHERE name = ?1 AND total_images = 0",
                params![b_name],
            );
        }

        tx.commit()?;
        Ok((imported_records, affected_batches.len()))
    }
}

#[cfg(test)]
mod ai_tests {
    use super::*;
    use crate::classifier::ClassificationItem;

    fn temp_db(name: &str) -> (Database, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("traaace_db_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (Database::new(dir.join("test.sqlite")).unwrap(), dir)
    }

    fn item(species: &str, count: i64) -> ClassificationItem {
        ClassificationItem { species: species.to_string(), count, comment: String::new(), sha256: None, species_in_frame: None }
    }

    #[test]
    fn saves_suggestions_and_replaces_them_on_rescan() {
        let (mut db, dir) = temp_db("save");
        db.save_ai_suggestions("b1", &[("a.jpg".into(), "{\"v\":1}".into()), ("b.jpg".into(), "{}".into())]).unwrap();
        db.save_ai_suggestions("b1", &[("a.jpg".into(), "{\"v\":2}".into())]).unwrap();
        db.save_ai_suggestions("b2", &[("a.jpg".into(), "{}".into())]).unwrap();
        let rows = db.get_ai_suggestions("b1").unwrap();
        assert_eq!(rows, [("a.jpg".to_string(), "{\"v\":2}".to_string()), ("b.jpg".to_string(), "{}".to_string())]);
        assert_eq!(db.get_ai_suggestions("b2").unwrap().len(), 1);
        db.clear_ai_suggestions("b1").unwrap();
        assert!(db.get_ai_suggestions("b1").unwrap().is_empty());
        assert_eq!(db.get_ai_suggestions("b2").unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn deleting_a_batch_removes_its_suggestions() {
        let (mut db, dir) = temp_db("delete");
        db.save_ai_suggestions("b1", &[("a.jpg".into(), "{}".into())]).unwrap();
        db.delete_batch("b1").unwrap();
        assert!(db.get_ai_suggestions("b1").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn bulk_classification_replaces_each_files_earlier_tags_in_one_go() {
        let (mut db, dir) = temp_db("bulk");
        db.save_classifications("b1", "a.jpg", &[item("Possum", 1)]).unwrap();
        let written = db
            .save_classifications_bulk("b1", &[("a.jpg".into(), vec![item("Kea", 2)]), ("b.jpg".into(), vec![item("Empty", 1)])])
            .unwrap();
        assert_eq!(written, 2);
        let map = db.get_classifications_map_for_batch("b1").unwrap();
        assert_eq!(map["a.jpg"].len(), 1);
        assert_eq!((map["a.jpg"][0].species.as_str(), map["a.jpg"][0].count), ("Kea", 2));
        assert_eq!(map["b.jpg"][0].species, "Empty");
        let _ = std::fs::remove_dir_all(dir);
    }
}
