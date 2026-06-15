import { useState, useEffect } from "react";
import { X, Cpu, Plus, Trash2, Check, Palette, Key, Zap } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  listTermPresets,
  loadTermPresetId,
  setTermPreset,
} from "../../lib/terminal/term-presets";
import { ThemeSelector } from "./ThemeSelector";
import { SshKeyManager } from "./SshKeyManager";
import { SkillManager } from "./SkillManager";

interface ModelConfig {
  id: string;
  provider: string;
  model_name: string;
  api_key: string | null;
  base_url: string | null;
  is_active: number;
}

const PRESET_PROVIDERS = [
  { id: "openai", name: "OpenAI", defaultBase: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o3-mini"] },
  { id: "anthropic", name: "Anthropic", defaultBase: "",
    models: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"] },
  { id: "deepseek", name: "DeepSeek", defaultBase: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "ollama", name: "Ollama", defaultBase: "http://localhost:11434",
    models: ["llama3", "qwen3", "deepseek-r1", "mistral"] },
  { id: "custom", name: "自定义", defaultBase: "", models: [] },
];

type SettingsPage = "models" | "appearance" | "ssh_keys" | "skills";

interface SettingsDialogProps { onClose: () => void; }

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [page, setPage] = useState<SettingsPage>("models");
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Terminal color preset
  const [termPresetId, setTermPresetId] = useState(loadTermPresetId);

  const handleTermPresetChange = (id: string) => {
    setTermPresetId(id);
    setTermPreset(id);
  };

  // Form
  const [provider, setProvider] = useState("openai");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  // Load from DB
  useEffect(() => {
    invoke<ModelConfig[]>("list_model_configs").then((list) => {
      setModels(list);
      setLoaded(true);
    }).catch(console.error);
  }, []);

  // Sync displayed preset when terminal preset changes externally (e.g., theme switch)
  useEffect(() => {
    const handler = () => setTermPresetId(loadTermPresetId());
    window.addEventListener("rssh:termpreset-change", handler);
    return () => window.removeEventListener("rssh:termpreset-change", handler);
  }, []);

  const selectedPreset = PRESET_PROVIDERS.find((p) => p.id === provider);

  const startAdd = () => {
    setProvider("openai");
    setModelName("gpt-4o");
    setApiKey("");
    setBaseUrl("https://api.openai.com/v1");
    setEditingId(null);
    setShowAdd(true);
  };

  const startEdit = (m: ModelConfig) => {
    setProvider(m.provider);
    setModelName(m.model_name);
    setApiKey(m.api_key ?? "");
    setBaseUrl(m.base_url ?? "");
    setEditingId(m.id);
    setShowAdd(true);
  };

  const handleProviderChange = (p: string) => {
    setProvider(p);
    const preset = PRESET_PROVIDERS.find((pr) => pr.id === p);
    if (preset) {
      setBaseUrl(preset.defaultBase);
      setModelName(preset.models[0] ?? "");
    }
  };

  const refreshList = async () => {
    const list = await invoke<ModelConfig[]>("list_model_configs");
    setModels(list);
  };

  const handleSave = async () => {
    if (!modelName.trim()) return;
    try {
      await invoke("save_model_config", {
        model: {
          id: editingId ?? "",
          provider,
          model_name: modelName.trim(),
          api_key: apiKey || null,
          base_url: baseUrl || null,
          is_active: 0,
        },
      });
      await refreshList();
      setShowAdd(false);
      setEditingId(null);
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (id: string) => {
    await invoke("delete_model_config", { id });
    await refreshList();
  };

  const handleActivate = async (m: ModelConfig) => {
    try {
      await invoke("set_active_model", { id: m.id });
      // Also configure the agent provider
      await invoke("configure_provider", {
        request: {
          provider_type: m.provider,
          api_key: m.api_key ?? null,
          base_url: m.base_url ?? null,
          model: m.model_name,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await refreshList();
    } catch (e) { console.error(e); }
  };

  if (!loaded) return null;

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={dialogStyle}>
        {/* Left nav */}
        <div style={navStyle}>
          <div style={navHeaderStyle}>
            <span style={{ fontSize:"12px", fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:1 }}>设置</span>
            <button onClick={onClose} style={iconBtnStyle}><X size={16} /></button>
          </div>
          <button
            onClick={() => { setPage("models"); setShowAdd(false); }}
            style={{ ...navItemStyle, background: page === "models" ? "var(--bg-active)" : "transparent", color: page === "models" ? "var(--text-primary)" : "var(--text-secondary)" }}
          >
            <Cpu size={16} /> 模型配置
          </button>
          <button
            onClick={() => { setPage("appearance"); setShowAdd(false); }}
            style={{ ...navItemStyle, background: page === "appearance" ? "var(--bg-active)" : "transparent", color: page === "appearance" ? "var(--text-primary)" : "var(--text-secondary)" }}
          >
            <Palette size={16} /> 外观
          </button>
          <button
            onClick={() => { setPage("ssh_keys"); setShowAdd(false); }}
            style={{ ...navItemStyle, background: page === "ssh_keys" ? "var(--bg-active)" : "transparent", color: page === "ssh_keys" ? "var(--text-primary)" : "var(--text-secondary)" }}
          >
            <Key size={16} /> SSH 密钥
          </button>
          <button
            onClick={() => { setPage("skills"); setShowAdd(false); }}
            style={{ ...navItemStyle, background: page === "skills" ? "var(--bg-active)" : "transparent", color: page === "skills" ? "var(--text-primary)" : "var(--text-secondary)" }}
          >
            <Zap size={16} /> 技能库
          </button>
        </div>

        {/* Right content */}
        <div style={contentStyle}>
          {page === "skills" ? (
            /* ── Skills page ── */
            <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
              <div style={contentHeaderStyle}>
                <h3 style={{ margin:0, fontSize:"15px", fontWeight:600 }}>技能库</h3>
              </div>
              <div style={{ flex:1, overflow:"auto", padding:"0 20px 20px", paddingTop:16 }}>
                <SkillManager />
              </div>
            </div>
          ) : page === "ssh_keys" ? (
            /* ── SSH Keys page ── */
            <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
              <div style={contentHeaderStyle}>
                <h3 style={{ margin:0, fontSize:"15px", fontWeight:600 }}>SSH 密钥</h3>
              </div>
              <div style={{ flex:1, overflow:"auto", padding:"0 20px 20px", paddingTop:16 }}>
                <SshKeyManager />
              </div>
            </div>
          ) : page === "appearance" ? (
            /* ── Appearance page ── */
            <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
              <div style={contentHeaderStyle}>
                <h3 style={{ margin:0, fontSize:"15px", fontWeight:600 }}>外观</h3>
              </div>
              <div style={{ flex:1, overflow:"auto", padding:"0 20px 20px" }}>
                <div style={{ fontSize:"12px", fontWeight:600, color:"var(--text-secondary)", marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>
                  终端配色方案
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
                    {listTermPresets().map((preset) => {
                      const isActive = termPresetId === preset.id;
                      const colors = [
                        preset.theme.red,
                        preset.theme.green,
                        preset.theme.yellow,
                        preset.theme.blue,
                        preset.theme.magenta,
                        preset.theme.cyan,
                      ];
                      return (
                        <button
                          key={preset.id}
                          onClick={() => handleTermPresetChange(preset.id)}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            padding: "10px 12px",
                            background: isActive ? "color-mix(in srgb, var(--accent) 15%, var(--bg-primary))" : "var(--bg-primary)",
                            border: isActive ? "1px solid var(--accent)" : "1px solid var(--border-color)",
                            borderRadius: 6,
                            cursor: "pointer",
                            gap: 6,
                            transition: "border-color 0.15s, background 0.15s",
                          }}
                        >
                          <div style={{ fontSize:"12px", fontWeight: isActive ? 600 : 400, color: isActive ? "var(--accent)" : "var(--text-primary)" }}>
                            {preset.name}
                          </div>
                          <div style={{ display:"flex", gap:2, width:"100%" }}>
                            {colors.map((c, i) => (
                              <div
                                key={i}
                                style={{
                                  flex: 1,
                                  height: 8,
                                  borderRadius: 2,
                                  background: c,
                                }}
                              />
                            ))}
                          </div>
                          <div style={{
                            width: "100%",
                            height: 14,
                            borderRadius: 2,
                            background: preset.theme.background,
                            border: "1px solid rgba(255,255,255,0.1)",
                          }} />
                        </button>
                      );
                    })}
                </div>
                <div style={{ marginTop: 24 }}>
                  <ThemeSelector />
                </div>
              </div>
            </div>
          ) : !showAdd ? (
            <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
              <div style={contentHeaderStyle}>
                <h3 style={{ margin:0, fontSize:"15px", fontWeight:600 }}>模型配置</h3>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  {saved && <span style={savedBadgeStyle}><Check size={14} /> 已保存</span>}
                  <button onClick={startAdd} style={addBtnStyle}><Plus size={16} /> 添加模型</button>
                </div>
              </div>
              <div style={{ flex:1, overflow:"auto", padding:"0 20px 20px" }}>
                {models.length === 0 ? (
                  <div style={emptyStyle}>
                    <Cpu size={32} style={{ color:"var(--text-muted)", marginBottom:12 }} />
                    <p style={{ color:"var(--text-muted)", fontSize:"13px", marginBottom:12 }}>暂无配置的模型</p>
                    <button onClick={startAdd} style={addBtnStyle}><Plus size={16} /> 添加第一个模型</button>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {models.map((m) => (
                      <div key={m.id} style={modelCardStyle}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                            <span style={{ fontWeight:600, fontSize:"13px" }}>
                              {PRESET_PROVIDERS.find(p=>p.id===m.provider)?.name ?? m.provider}
                            </span>
                            <span style={tagStyle}>{m.model_name}</span>
                            {m.is_active === 1 && <span style={activeBadgeStyle}>使用中</span>}
                          </div>
                          <div style={{ fontSize:"12px", color:"var(--text-muted)" }}>
                            {m.base_url || "官方 API"}
                          </div>
                        </div>
                        <div style={{ display:"flex", gap:4 }}>
                          {m.is_active !== 1 && (
                            <button onClick={() => handleActivate(m)} style={actionBtnStyle}>激活</button>
                          )}
                          <button onClick={() => startEdit(m)} style={actionBtnStyle}>编辑</button>
                          <button onClick={() => handleDelete(m.id)} style={{ ...actionBtnStyle, color:"var(--color-error)" }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
              <div style={contentHeaderStyle}>
                <h3 style={{ margin:0, fontSize:"15px", fontWeight:600 }}>{editingId ? "编辑模型" : "添加模型"}</h3>
                <button onClick={() => setShowAdd(false)} style={cancelTextBtnStyle}>返回列表</button>
              </div>
              <div style={{ flex:1, overflow:"auto", padding:"0 20px 20px" }}>
                <FormField label="提供商">
                  <select value={provider} onChange={(e) => handleProviderChange(e.target.value)} style={selectStyle}>
                    {PRESET_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </FormField>

                <FormField label="模型名称">
                  <div style={{ display:"flex", gap:6 }}>
                    {selectedPreset && selectedPreset.models.length > 0 && (
                      <select value={modelName} onChange={(e) => setModelName(e.target.value)} style={{ ...selectStyle, flex:1 }}>
                        {selectedPreset.models.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    )}
                    <input value={modelName} onChange={(e) => setModelName(e.target.value)}
                      placeholder="deepseek-chat" style={{ ...inputStyle, flex:1 }} />
                  </div>
                </FormField>

                {provider !== "ollama" && (
                  <FormField label="API Key">
                    <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                      placeholder="输入 API Key" style={inputStyle} />
                  </FormField>
                )}

                {(provider === "ollama" || provider === "deepseek" || provider === "custom") && (
                  <FormField label="Base URL">
                    <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://api.deepseek.com/v1" style={inputStyle} />
                  </FormField>
                )}

                <div style={{ marginTop:20, display:"flex", justifyContent:"flex-end", gap:8 }}>
                  <button onClick={() => setShowAdd(false)} style={cancelBtnStyle}>取消</button>
                  <button onClick={handleSave} disabled={!modelName.trim()}
                    style={{ ...saveBtnStyle, opacity: !modelName.trim() ? 0.4 : 1 }}>保存</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize:"12px", fontWeight:500, color:"var(--text-secondary)", marginBottom:5 }}>{label}</div>
      {children}
    </div>
  );
}

// --- Styles ---
const overlayStyle: React.CSSProperties = { position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 };
const dialogStyle: React.CSSProperties = { display:"flex", width:720, height:500, background:"var(--bg-secondary)", border:"1px solid var(--border-color)", borderRadius:8, overflow:"hidden", boxShadow:"0 8px 40px rgba(0,0,0,0.4)" };
const navStyle: React.CSSProperties = { width:200, minWidth:200, background:"var(--bg-tertiary)", borderRight:"1px solid var(--border-color)", display:"flex", flexDirection:"column" };
const navHeaderStyle: React.CSSProperties = { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px" };
const iconBtnStyle: React.CSSProperties = { width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", background:"transparent", border:"none", color:"var(--text-muted)", cursor:"pointer", borderRadius:4 };
const navItemStyle: React.CSSProperties = { display:"flex", alignItems:"center", gap:10, padding:"10px 16px", border:"none", cursor:"pointer", fontSize:"13px", width:"100%", textAlign:"left" };
const contentStyle: React.CSSProperties = { flex:1, display:"flex", flexDirection:"column", overflow:"hidden" };
const contentHeaderStyle: React.CSSProperties = { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 20px", borderBottom:"1px solid var(--border-color)" };
const savedBadgeStyle: React.CSSProperties = { fontSize:"12px", color:"var(--color-success)", display:"flex", alignItems:"center", gap:4 };
const emptyStyle: React.CSSProperties = { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"60px 20px", textAlign:"center" };
const modelCardStyle: React.CSSProperties = { display:"flex", alignItems:"center", padding:"12px 16px", background:"var(--bg-primary)", border:"1px solid var(--border-color)", borderRadius:6, gap:12 };
const tagStyle: React.CSSProperties = { fontSize:"11px", padding:"2px 8px", background:"var(--bg-tertiary)", borderRadius:3, color:"var(--text-secondary)", fontFamily:"var(--font-mono)" };
const activeBadgeStyle: React.CSSProperties = { fontSize:"10px", padding:"1px 6px", background:"color-mix(in srgb, var(--color-success) 15%, transparent)", color:"var(--color-success)", borderRadius:3, fontWeight:500 };
const actionBtnStyle: React.CSSProperties = { padding:"4px 10px", background:"transparent", border:"1px solid var(--border-color)", borderRadius:4, color:"var(--text-secondary)", cursor:"pointer", fontSize:"12px" };
const addBtnStyle: React.CSSProperties = { display:"inline-flex", alignItems:"center", gap:6, padding:"6px 14px", background:"var(--accent)", color:"#fff", border:"none", borderRadius:4, cursor:"pointer", fontSize:"13px" };
const cancelTextBtnStyle: React.CSSProperties = { padding:"4px 8px", background:"transparent", border:"none", color:"var(--text-muted)", cursor:"pointer", fontSize:"12px" };
const inputStyle: React.CSSProperties = { width:"100%", padding:"6px 10px", background:"var(--bg-primary)", border:"1px solid var(--border-color)", borderRadius:4, color:"var(--text-primary)", fontSize:"13px", outline:"none" };
const selectStyle: React.CSSProperties = { width:"100%", padding:"6px 10px", background:"var(--bg-primary)", border:"1px solid var(--border-color)", borderRadius:4, color:"var(--text-primary)", fontSize:"13px", outline:"none", cursor:"pointer" };
const cancelBtnStyle: React.CSSProperties = { padding:"6px 16px", background:"var(--bg-tertiary)", color:"var(--text-primary)", border:"1px solid var(--border-color)", borderRadius:4, cursor:"pointer", fontSize:"13px" };
const saveBtnStyle: React.CSSProperties = { padding:"6px 20px", background:"var(--accent)", color:"#fff", border:"none", borderRadius:4, cursor:"pointer", fontSize:"13px", fontWeight:500 };
