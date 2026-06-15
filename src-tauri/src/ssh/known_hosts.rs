// src-tauri/src/ssh/known_hosts.rs
//! known_hosts 路径策略：复用系统标准位置 ~/.ssh/known_hosts。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// 解析 known_hosts 文件路径（fallback_dir 仅在 home_dir 不可用时使用）。
pub fn path_for(fallback_dir: &Path) -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        home.join(".ssh").join("known_hosts")
    } else {
        fallback_dir.join("known_hosts")
    }
}

/// 删除 host:port 在 known_hosts 中的所有匹配条目，返回删除条数。
/// 用于 host key 变更后用户确认 'replace' 的场景。
pub fn remove_host(host: &str, port: u16, path: &Path) -> std::io::Result<usize> {
    if !path.exists() {
        return Ok(0);
    }
    let matches = russh::keys::known_hosts::known_host_keys_path(host, port, path)
        .map_err(|e| std::io::Error::other(format!("known_host_keys_path: {e}")))?;
    if matches.is_empty() {
        return Ok(0);
    }
    let drop_lines: HashSet<usize> = matches.iter().map(|(n, _)| *n).collect();
    let content = std::fs::read_to_string(path)?;
    let mut out = String::new();
    let mut removed = 0;
    // russh 的行号跳过注释行；我们用并行计数器 mirror 这套规则。
    let mut russh_line: usize = 1;
    for line in content.lines() {
        let is_comment = line.as_bytes().first() == Some(&b'#');
        if is_comment {
            out.push_str(line);
            out.push('\n');
            continue;
        }
        if drop_lines.contains(&russh_line) {
            removed += 1;
        } else {
            out.push_str(line);
            out.push('\n');
        }
        russh_line += 1;
    }
    std::fs::write(path, out)?;
    Ok(removed)
}
