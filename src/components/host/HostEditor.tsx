import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { SshHost } from "../../stores/hostStore";
import { useKeyStore } from "../../stores/keyStore";
import { useSkillStore } from "../../stores/skillStore";

interface HostEditorProps {
  host?: SshHost | null;
  initialGroup?: string | null;
  onSave: (host: SshHost) => void;
  onCancel: () => void;
}

export function HostEditor({ host, initialGroup, onSave, onCancel }: HostEditorProps) {
  const isEdit = !!host;

  const [name, setName] = useState(host?.name ?? "");
  const [groupName, setGroupName] = useState(host?.group_name ?? initialGroup ?? "");
  const [hostname, setHostname] = useState(host?.hostname ?? "");
  const [port, setPort] = useState(host?.port ?? 22);
  const [username, setUsername] = useState(host?.username ?? "root");
  const [password, setPassword] = useState("");
  const [authMethod, setAuthMethod] = useState<"password" | "key">(
    (host?.authMethod === "agent" ? "password" : host?.authMethod) ?? "password",
  );
  const { keys, loadKeys, addKey } = useKeyStore();
  useEffect(() => { loadKeys(); }, []);
  const [keyId, setKeyId] = useState(host?.keyId ?? "");
  const [pendingKey, setPendingKey] = useState<{ pem: string; name: string } | null>(null);

  const { skills, loadSkills } = useSkillStore();
  useEffect(() => { loadSkills(); }, []);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    host?.skillIds ? host.skillIds.split(",").filter(Boolean) : []
  );

  const handleImportKey = async () => {
    try {
      const selected = await open({
        title: "选择 SSH 密钥文件",
        filters: [
          { name: "SSH Keys", extensions: ["pem", "key", "ppk", ""] },
          { name: "All Files", extensions: ["*"] },
        ],
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) return;
      const pem = await readTextFile(selected as string);
      const fileName = (selected as string).split(/[\\/]/).pop() ?? "imported_key";
      const baseName = fileName.replace(/\.(pem|key)$/, "");
      setPendingKey({ pem, name: baseName });
    } catch (e) {
      console.error("import key error:", e);
    }
  };

  const handleSave = () => {
    if (!name.trim() || !hostname.trim()) return;

    const newHost: SshHost = {
      id: host?.id ?? crypto.randomUUID(),
      name: name.trim(),
      group_name: groupName.trim() || null,
      hostname: hostname.trim(),
      port: port || 22,
      username: username.trim() || "root",
      authMethod,
      password: authMethod === "password" ? password : undefined,
      keyId: authMethod === "key" ? keyId : undefined,
      skillIds: selectedSkillIds.join(","),
      keepaliveInterval: host?.keepaliveInterval ?? 30,
      connectionTimeout: host?.connectionTimeout ?? 10,
    };

    onSave(newHost);
  };

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <h3 style={titleStyle}>{isEdit ? "编辑主机" : "新建主机"}</h3>

        <div style={formStyle}>
          <Field label="名称" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：生产服务器"
              autoFocus
              style={inputStyle}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </Field>

          <Field label="分组">
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="例如：生产环境、开发环境"
              style={inputStyle}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </Field>

          <Field label="主机地址" required>
            <input
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="IP 或域名，例如：192.168.1.100"
              style={inputStyle}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </Field>

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Field label="端口">
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value) || 0)}
                  style={inputStyle}
                />
              </Field>
            </div>
            <div style={{ flex: 2 }}>
              <Field label="用户名">
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="root"
                  style={inputStyle}
                />
              </Field>
            </div>
          </div>

          <Field label="认证方式">
            <div style={{ display: "flex", gap: 12 }}>
              <label style={radioLabelStyle}>
                <input
                  type="radio"
                  checked={authMethod === "password"}
                  onChange={() => setAuthMethod("password")}
                  style={{ marginRight: 4 }}
                />
                密码
              </label>
              <label style={radioLabelStyle}>
                <input
                  type="radio"
                  checked={authMethod === "key"}
                  onChange={() => setAuthMethod("key")}
                  style={{ marginRight: 4 }}
                />
                密钥
              </label>
            </div>
          </Field>

          {authMethod === "password" && (
            <Field label="密码">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入 SSH 密码"
                style={inputStyle}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </Field>
          )}

          {authMethod === "key" && (
            <Field label="SSH 密钥" required>
              <div style={{ display: "flex", gap: 6 }}>
                <select
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  <option value="">— 选择密钥 —</option>
                  {keys.map((k) => (
                    <option key={k.id} value={k.id}>{k.name}</option>
                  ))}
                </select>
                <button onClick={handleImportKey} style={browseBtnStyle}>
                  导入新密钥
                </button>
              </div>
              {pendingKey && (
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <input
                    type="text"
                    value={pendingKey.name}
                    onChange={(e) => setPendingKey({ ...pendingKey, name: e.target.value })}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter" && pendingKey.name.trim()) {
                        const newKey = await addKey(pendingKey.name.trim(), pendingKey.pem);
                        setKeyId(newKey.id);
                        setPendingKey(null);
                      } else if (e.key === "Escape") {
                        setPendingKey(null);
                      }
                    }}
                    placeholder="密钥名称"
                    autoFocus
                    style={pendingKeyInputStyle}
                  />
                  <button
                    onClick={async () => {
                      if (pendingKey.name.trim()) {
                        const newKey = await addKey(pendingKey.name.trim(), pendingKey.pem);
                        setKeyId(newKey.id);
                        setPendingKey(null);
                      }
                    }}
                    disabled={!pendingKey.name.trim()}
                    style={pendingKeyConfirmBtnStyle}
                  >
                    确认
                  </button>
                  <button onClick={() => setPendingKey(null)} style={pendingKeyCancelBtnStyle}>
                    取消
                  </button>
                </div>
              )}
            </Field>
          )}

          {skills.length > 0 && (
            <Field label="绑定技能">
              <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 140, overflowY: "auto" }}>
                {skills.map((sk) => (
                  <label
                    key={sk.id}
                    style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "13px", color: "var(--text-primary)" }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSkillIds.includes(sk.id)}
                      onChange={(e) => {
                        setSelectedSkillIds((prev) =>
                          e.target.checked
                            ? [...prev, sk.id]
                            : prev.filter((id) => id !== sk.id)
                        );
                      }}
                    />
                    <span style={{ fontWeight: 500 }}>{sk.name}</span>
                    {sk.description && (
                      <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                        {sk.description}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </Field>
          )}
        </div>

        <div style={footerStyle}>
          <button onClick={onCancel} style={cancelBtnStyle}>
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !hostname.trim() || (authMethod === "key" && !keyId)}
            style={{
              ...saveBtnStyle,
              opacity: (!name.trim() || !hostname.trim() || (authMethod === "key" && !keyId)) ? 0.4 : 1,
            }}
          >
            {isEdit ? "保存" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={labelStyle}>
        {label}
        {required && <span style={{ color: "var(--color-error)" }}> *</span>}
      </div>
      {children}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border-color)",
  borderRadius: 8,
  padding: "20px 24px",
  width: 440,
  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
};

const titleStyle: React.CSSProperties = {
  margin: "0 0 20px",
  fontSize: "15px",
  fontWeight: 600,
  color: "var(--text-primary)",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
};

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--text-secondary)",
  marginBottom: 4,
  fontWeight: 500,
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
};

const radioLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  color: "var(--text-primary)",
  fontSize: "13px",
  cursor: "pointer",
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 20,
  paddingTop: 16,
  borderTop: "1px solid var(--border-color)",
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

const browseBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  background: "var(--bg-tertiary)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "12px",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const saveBtnStyle: React.CSSProperties = {
  padding: "6px 20px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 500,
};

const pendingKeyInputStyle: React.CSSProperties = {
  padding: "4px 8px",
  background: "var(--bg-primary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  color: "var(--text-primary)",
  fontSize: "12px",
  flex: 1,
};

const pendingKeyConfirmBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "12px",
};

const pendingKeyCancelBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "var(--bg-tertiary)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "12px",
};
