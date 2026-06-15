import React, { useEffect, useState } from "react";
import { Zap, Trash2, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { useSkillStore, SkillFull, SkillInput } from "../../stores/skillStore";

export function SkillManager() {
  const { skills, loadSkills, getSkill, createSkill, updateSkill, deleteSkill } = useSkillStore();
  const [editingSkill, setEditingSkill] = useState<SkillFull | null>(null);
  const [isNew, setIsNew] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => { loadSkills(); }, []);

  const startNew = () => {
    setName(""); setDescription(""); setTags(""); setContent("");
    setEditingSkill(null);
    setIsNew(true);
  };

  const startEdit = async (id: string) => {
    try {
      const skill = await getSkill(id);
      setName(skill.name);
      setDescription(skill.description);
      setTags(skill.tags);
      setContent(skill.content);
      setEditingSkill(skill);
      setIsNew(false);
    } catch (e) { console.error(e); }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    const input: SkillInput = {
      name: name.trim(),
      description: description.trim(),
      tags: tags.toLowerCase().trim(),
      content,
    };
    try {
      if (isNew) {
        await createSkill(input);
      } else if (editingSkill) {
        await updateSkill(editingSkill.id, input, editingSkill.enabled);
      }
      setIsNew(false);
      setEditingSkill(null);
    } catch (e) { console.error(e); }
  };

  const handleToggle = async (id: string, currentEnabled: number) => {
    try {
      const skill = await getSkill(id);
      const input: SkillInput = {
        name: skill.name, description: skill.description,
        tags: skill.tags, content: skill.content,
      };
      await updateSkill(id, input, currentEnabled === 1 ? 0 : 1);
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (id: string, skillName: string) => {
    if (!window.confirm(`删除技能 "${skillName}"？`)) return;
    try {
      await deleteSkill(id);
    } catch (e) { console.error(e); }
  };

  const showForm = isNew || editingSkill !== null;

  if (showForm) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={formHeaderStyle}>
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>
            {isNew ? "新建技能" : "编辑技能"}
          </h3>
          <button onClick={() => { setIsNew(false); setEditingSkill(null); }} style={cancelTextBtnStyle}>
            返回列表
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "16px 0 20px" }}>
          <FormField label="名称">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="技能名称"
              autoFocus
              style={inputStyle}
            />
          </FormField>
          <FormField label="描述">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简述此技能的用途（用于自动匹配）"
              style={inputStyle}
            />
          </FormField>
          <FormField label="标签">
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="nginx, ubuntu, docker（逗号分隔，用于主机自动匹配）"
              style={inputStyle}
            />
          </FormField>
          <FormField label="内容">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={"Markdown 格式：角色说明、排查步骤、命令示例..."}
              style={{ ...inputStyle, fontFamily: "monospace", minHeight: 200, resize: "vertical" }}
            />
          </FormField>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button onClick={() => { setIsNew(false); setEditingSkill(null); }} style={cancelBtnStyle}>取消</button>
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              style={{ ...saveBtnStyle, opacity: !name.trim() ? 0.4 : 1, cursor: !name.trim() ? "default" : "pointer" }}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 4px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          {skills.length === 0 ? "暂无技能" : `${skills.length} 个技能`}
        </span>
        <button onClick={startNew} style={addBtnStyle}>
          <Plus size={13} style={{ marginRight: 4 }} />
          新建技能
        </button>
      </div>

      {skills.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-secondary)" }}>
          <Zap size={28} style={{ marginBottom: 10, color: "var(--text-muted, var(--text-secondary))" }} />
          <p style={{ fontSize: "13px", marginBottom: 12 }}>暂无技能，点击新建</p>
          <button onClick={startNew} style={addBtnStyle}>
            <Plus size={13} style={{ marginRight: 4 }} />
            新建技能
          </button>
        </div>
      ) : (
        skills.map((k) => (
          <div key={k.id} style={cardStyle}>
            <Zap size={14} style={{ color: k.enabled ? "var(--accent)" : "var(--text-secondary)", flexShrink: 0 }} />
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{k.name}</div>
              {k.description && (
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {k.description}
                </div>
              )}
            </div>
            <button
              onClick={() => handleToggle(k.id, k.enabled)}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: k.enabled ? "var(--accent)" : "var(--text-secondary)", display: "flex", alignItems: "center", padding: "3px 6px" }}
              title={k.enabled ? "已启用（点击禁用）" : "已禁用（点击启用）"}
            >
              {k.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
            </button>
            <button onClick={() => startEdit(k.id)} style={actionBtnStyle}>编辑</button>
            <button
              onClick={() => handleDelete(k.id, k.name)}
              style={{ ...actionBtnStyle, color: "var(--color-error, #e74c3c)" }}
              title="删除"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

const formHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 0 12px 0",
  borderBottom: "1px solid var(--border-color)",
  marginBottom: 16,
};
const cardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  background: "var(--bg-primary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  marginBottom: 6,
};
const addBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 12px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 500,
};
const actionBtnStyle: React.CSSProperties = {
  padding: "3px 8px",
  background: "transparent",
  border: "1px solid var(--border-color)",
  borderRadius: 3,
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: "12px",
  display: "flex",
  alignItems: "center",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  background: "var(--bg-primary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  color: "var(--text-primary)",
  fontSize: "13px",
  outline: "none",
  boxSizing: "border-box",
};
const cancelBtnStyle: React.CSSProperties = {
  padding: "6px 16px",
  background: "var(--bg-tertiary)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "13px",
};
const saveBtnStyle: React.CSSProperties = {
  padding: "6px 20px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontSize: "13px",
  fontWeight: 500,
};
const cancelTextBtnStyle: React.CSSProperties = {
  padding: "4px 8px",
  background: "transparent",
  border: "none",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: "12px",
};
