/// Host context injected into the Agent's system prompt
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HostContext {
    pub hostname: Option<String>,
    pub os: Option<String>,
    pub current_dir: Option<String>,
}

impl HostContext {
    /// Build a system prompt string from host context
    pub fn to_system_prompt(&self) -> String {
        let mut prompt = String::from(
            "你是一个专业的运维助手。请根据用户输入的自然语言运维需求，返回相应的 Shell 命令。\n\n",
        );

        prompt.push_str("## 规则\n");
        prompt.push_str("- 优先返回可直接执行的命令\n");
        prompt.push_str("- 在命令前附上简要说明\n");
        prompt.push_str("- 命令用 ```bash 代码块包裹\n");
        prompt.push_str("- 如果是危险命令（如 rm -rf、dd、mkfs），请明确警告\n");
        prompt.push_str("- 如果需求不明确，请先询问澄清\n\n");

        if let Some(ref hostname) = self.hostname {
            prompt.push_str(&format!("## 当前连接主机\n- 主机名: {}\n", hostname));
        }
        if let Some(ref os) = self.os {
            prompt.push_str(&format!("- 操作系统: {}\n", os));
        }
        if let Some(ref dir) = self.current_dir {
            prompt.push_str(&format!("- 当前目录: {}\n", dir));
        }

        prompt
    }
}

/// Default system prompt template for an ops agent
pub const OPS_AGENT_PROMPT: &str = "\
你是一个专业的 Linux 运维助手。你的职责包括：

1. **命令生成**：将用户的自然语言运维需求转换为准确的 Shell 命令
2. **问题诊断**：分析用户提供的日志、错误信息，给出诊断和排查步骤
3. **脚本编写**：根据需求编写 Shell 或 Python 运维脚本
4. **命令解释**：解释 Linux 命令的含义和用法

注意事项：
- 始终假设目标系统为 Linux
- 命令优先使用 Bash 语法，用 ```bash 代码块包裹
- 危险操作（删除、格式化、清空文件等）需明确标注 ⚠️
- 如不确定，先给出安全的检查命令
- 回复简洁，直击要点";

pub fn build_skill_context(skills: &[crate::db::Skill]) -> String {
    if skills.is_empty() {
        return String::new();
    }
    let mut out = String::from("\n## 激活的技能\n\n");
    for skill in skills {
        out.push_str(&format!("### {}\n", skill.name));
        out.push_str(&skill.content);
        out.push_str("\n\n---\n\n");
    }
    out
}
