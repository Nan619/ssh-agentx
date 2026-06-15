use rusqlite::{Connection, params};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshKey {
    pub id: String,
    pub name: String,
    pub pem: String,
    pub passphrase: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct SshKeySummary {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshGroup {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SkillSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub tags: String,
    pub enabled: i32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub tags: String,
    pub content: String,
    pub enabled: i32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshHost {
    pub id: String,
    pub name: String,
    pub group_name: Option<String>,
    pub hostname: String,
    pub port: i32,
    pub username: String,
    pub auth_method: String,
    pub password: Option<String>,
    pub key_id: Option<String>,
    pub skill_ids: String,
    pub keepalive_interval: i32,
    pub connection_timeout: i32,
}

pub struct Database {
    conn: Mutex<Connection>,
}

fn remove_from_csv(csv: &str, id: &str) -> String {
    csv.split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && *s != id)
        .collect::<Vec<_>>()
        .join(",")
}

impl Database {
    pub fn new(app_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
        let db_path = app_dir.join("ssh-agent.db");
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS ssh_keys (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                pem         TEXT NOT NULL,
                passphrase  TEXT
            );

            CREATE TABLE IF NOT EXISTS hosts (
                id                  TEXT PRIMARY KEY,
                name                TEXT NOT NULL,
                group_name          TEXT,
                hostname            TEXT NOT NULL,
                port                INTEGER NOT NULL DEFAULT 22,
                username            TEXT NOT NULL DEFAULT 'root',
                auth_method         TEXT NOT NULL DEFAULT 'password',
                password            TEXT,
                key_id              TEXT REFERENCES ssh_keys(id) ON DELETE SET NULL,
                keepalive_interval  INTEGER NOT NULL DEFAULT 30,
                connection_timeout  INTEGER NOT NULL DEFAULT 10
            );

            CREATE TABLE IF NOT EXISTS groups (
                id   TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS model_configs (
                id         TEXT PRIMARY KEY,
                provider   TEXT NOT NULL,
                model_name TEXT NOT NULL,
                api_key    TEXT,
                base_url   TEXT,
                is_active  INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS skills (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                tags        TEXT NOT NULL DEFAULT '',
                content     TEXT NOT NULL DEFAULT '',
                enabled     INTEGER NOT NULL DEFAULT 1
            );"
        ).map_err(|e| e.to_string())?;
        // 迁移旧库：添加新列，删除旧列（SQLite 忽略已存在/不存在的情况）
        let _ = conn.execute_batch(
            "ALTER TABLE hosts ADD COLUMN key_id TEXT REFERENCES ssh_keys(id) ON DELETE SET NULL;"
        );
        let _ = conn.execute_batch("ALTER TABLE hosts DROP COLUMN key_path;");
        let _ = conn.execute_batch("ALTER TABLE hosts DROP COLUMN key_passphrase;");
        let _ = conn.execute_batch(
            "ALTER TABLE hosts ADD COLUMN skill_ids TEXT NOT NULL DEFAULT '';"
        );

        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn list_hosts(&self) -> Result<Vec<SshHost>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, name, group_name, hostname, port, username, auth_method,
                    password, key_id, skill_ids, keepalive_interval, connection_timeout
             FROM hosts ORDER BY name"
        ).map_err(|e| e.to_string())?;

        let hosts = stmt.query_map([], |row| {
            Ok(SshHost {
                id: row.get(0)?,
                name: row.get(1)?,
                group_name: row.get(2)?,
                hostname: row.get(3)?,
                port: row.get(4)?,
                username: row.get(5)?,
                auth_method: row.get(6)?,
                password: row.get(7)?,
                key_id: row.get(8)?,
                skill_ids: row.get(9)?,
                keepalive_interval: row.get(10)?,
                connection_timeout: row.get(11)?,
            })
        }).map_err(|e| e.to_string())?;

        hosts.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn insert_host(&self, host: &SshHost) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO hosts (id, name, group_name, hostname, port, username, auth_method,
                                password, key_id, skill_ids, keepalive_interval, connection_timeout)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                host.id, host.name, host.group_name, host.hostname, host.port,
                host.username, host.auth_method, host.password, host.key_id,
                host.skill_ids, host.keepalive_interval, host.connection_timeout,
            ],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_host(&self, host: &SshHost) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE hosts SET name=?1, group_name=?2, hostname=?3, port=?4, username=?5,
                              auth_method=?6, password=?7, key_id=?8, skill_ids=?9,
                              keepalive_interval=?10, connection_timeout=?11
             WHERE id=?12",
            params![
                host.name, host.group_name, host.hostname, host.port, host.username,
                host.auth_method, host.password, host.key_id, host.skill_ids,
                host.keepalive_interval, host.connection_timeout, host.id,
            ],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_host(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM hosts WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // --- Groups ---

    pub fn list_groups(&self) -> Result<Vec<SshGroup>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, name FROM groups ORDER BY name"
        ).map_err(|e| e.to_string())?;
        let groups = stmt.query_map([], |row| {
            Ok(SshGroup { id: row.get(0)?, name: row.get(1)? })
        }).map_err(|e| e.to_string())?;
        groups.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn insert_group(&self, group: &SshGroup) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO groups (id, name) VALUES (?1, ?2)",
            params![group.id, group.name],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_group(&self, group: &SshGroup) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let old_name: Option<String> = conn
            .query_row(
                "SELECT name FROM groups WHERE id=?1",
                params![group.id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if let Some(old) = old_name {
            conn.execute(
                "UPDATE hosts SET group_name=?1 WHERE group_name=?2",
                params![group.name, old],
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute(
            "UPDATE groups SET name=?1 WHERE id=?2",
            params![group.name, group.id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_group(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let name: Option<String> = conn.query_row(
            "SELECT name FROM groups WHERE id=?1", params![id], |row| row.get(0)
        ).map_err(|e| e.to_string())?;
        if let Some(name) = name {
            conn.execute(
                "UPDATE hosts SET group_name=NULL WHERE group_name=?1",
                params![name],
            ).map_err(|e| e.to_string())?;
        }
        conn.execute("DELETE FROM groups WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // --- Model configs ---

    pub fn list_models(&self) -> Result<Vec<ModelConfig>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, provider, model_name, api_key, base_url, is_active
             FROM model_configs ORDER BY created_at"
        ).map_err(|e| e.to_string())?;

        let models = stmt.query_map([], |row| {
            Ok(ModelConfig {
                id: row.get(0)?,
                provider: row.get(1)?,
                model_name: row.get(2)?,
                api_key: row.get(3)?,
                base_url: row.get(4)?,
                is_active: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;

        models.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn save_model(&self, model: &ModelConfig) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // Upsert
        conn.execute(
            "INSERT OR REPLACE INTO model_configs (id, provider, model_name, api_key, base_url, is_active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                model.id, model.provider, model.model_name,
                model.api_key, model.base_url, model.is_active,
            ],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_model(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM model_configs WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn set_active_model(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("UPDATE model_configs SET is_active=0", [])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE model_configs SET is_active=1 WHERE id=?1",
            params![id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_active_model(&self) -> Result<Option<ModelConfig>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, provider, model_name, api_key, base_url, is_active
             FROM model_configs WHERE is_active=1 LIMIT 1"
        ).map_err(|e| e.to_string())?;

        let mut rows = stmt.query_map([], |row| {
            Ok(ModelConfig {
                id: row.get(0)?,
                provider: row.get(1)?,
                model_name: row.get(2)?,
                api_key: row.get(3)?,
                base_url: row.get(4)?,
                is_active: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;

        rows.next().transpose().map_err(|e| e.to_string())
    }

    // --- SSH Keys ---

    pub fn list_keys(&self) -> Result<Vec<SshKeySummary>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, name FROM ssh_keys ORDER BY name ASC"
        ).map_err(|e| e.to_string())?;
        let keys = stmt.query_map([], |row| {
            Ok(SshKeySummary { id: row.get(0)?, name: row.get(1)? })
        }).map_err(|e| e.to_string())?;
        keys.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn insert_key(&self, id: &str, name: &str, pem: &str, passphrase: Option<&str>) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO ssh_keys (id, name, pem, passphrase) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, pem, passphrase],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_key(&self, id: &str, name: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let n = conn.execute(
            "UPDATE ssh_keys SET name=?1 WHERE id=?2",
            params![name, id],
        ).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err(format!("key not found: {}", id));
        }
        Ok(())
    }

    pub fn delete_key(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ssh_keys WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_key(&self, id: &str) -> Result<Option<SshKey>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, name, pem, passphrase FROM ssh_keys WHERE id=?1"
        ).map_err(|e| e.to_string())?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(SshKey {
                id: row.get(0)?,
                name: row.get(1)?,
                pem: row.get(2)?,
                passphrase: row.get(3)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.next().transpose().map_err(|e| e.to_string())
    }

    // --- Skills ---

    pub fn list_skills(&self) -> Result<Vec<SkillSummary>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, tags, enabled FROM skills ORDER BY name ASC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok(SkillSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                tags: row.get(3)?,
                enabled: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn list_skills_full(&self) -> Result<Vec<Skill>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, tags, content, enabled FROM skills WHERE enabled=1 ORDER BY name ASC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok(Skill {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                tags: row.get(3)?,
                content: row.get(4)?,
                enabled: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_skill(&self, id: &str) -> Result<Option<Skill>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, tags, content, enabled FROM skills WHERE id=?1"
        ).map_err(|e| e.to_string())?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(Skill {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                tags: row.get(3)?,
                content: row.get(4)?,
                enabled: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.next().transpose().map_err(|e| e.to_string())
    }

    pub fn insert_skill(&self, skill: &Skill) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO skills (id, name, description, tags, content, enabled)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![skill.id, skill.name, skill.description, skill.tags, skill.content, skill.enabled],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_skill(&self, skill: &Skill) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let n = conn.execute(
            "UPDATE skills SET name=?1, description=?2, tags=?3, content=?4, enabled=?5
             WHERE id=?6",
            params![skill.name, skill.description, skill.tags, skill.content, skill.enabled, skill.id],
        ).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err(format!("skill not found: {}", skill.id));
        }
        Ok(())
    }

    pub fn delete_skill(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // Cascade: remove this skill id from all hosts' skill_ids
        let affected: Vec<(String, String)> = {
            let mut stmt = conn.prepare(
                "SELECT id, skill_ids FROM hosts WHERE skill_ids LIKE '%' || ?1 || '%'"
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        for (host_id, skill_ids) in affected {
            let new_ids = remove_from_csv(&skill_ids, id);
            conn.execute(
                "UPDATE hosts SET skill_ids=?1 WHERE id=?2",
                params![new_ids, host_id],
            ).map_err(|e| e.to_string())?;
        }
        conn.execute("DELETE FROM skills WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModelConfig {
    pub id: String,
    pub provider: String,
    pub model_name: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub is_active: i32,
}
