import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { Key, Trash2, Plus } from "lucide-react";
import { useKeyStore } from "../../stores/keyStore";

export function SshKeyManager() {
  const { keys, loadKeys, addKey, removeKey } = useKeyStore();
  const [pendingImport, setPendingImport] = useState<{ pem: string; name: string; passphrase: string } | null>(null);

  useEffect(() => { loadKeys(); }, []);

  const handleImport = async () => {
    try {
      const selected = await open({
        title: "导入 SSH 密钥",
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
      setPendingImport({ pem, name: baseName, passphrase: "" });
    } catch (e) {
      console.error("import key error:", e);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`删除密钥 "${name}"？\n引用此密钥的主机将需要重新配置。`)) return;
    await removeKey(id);
  };

  return (
    <div style={{ padding: "0 4px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          {keys.length === 0 ? "暂无密钥" : `${keys.length} 个密钥`}
        </span>
        <button onClick={handleImport} style={importBtnStyle}>
          <Plus size={13} style={{ marginRight: 4 }} />
          导入密钥
        </button>
      </div>

      {pendingImport && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={pendingImport.name}
              onChange={(e) => setPendingImport({ ...pendingImport, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape") setPendingImport(null);
              }}
              placeholder="密钥名称"
              autoFocus
              style={nameInputStyle}
            />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="password"
              value={pendingImport.passphrase}
              onChange={(e) => setPendingImport({ ...pendingImport, passphrase: e.target.value })}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && pendingImport.name.trim()) {
                  await addKey(pendingImport.name.trim(), pendingImport.pem, pendingImport.passphrase || undefined);
                  setPendingImport(null);
                } else if (e.key === "Escape") {
                  setPendingImport(null);
                }
              }}
              placeholder="密钥密码（可选）"
              style={nameInputStyle}
            />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={async () => {
                if (pendingImport.name.trim()) {
                  await addKey(pendingImport.name.trim(), pendingImport.pem, pendingImport.passphrase || undefined);
                  setPendingImport(null);
                }
              }}
              style={confirmBtnStyle}
              disabled={!pendingImport.name.trim()}
            >
              确认
            </button>
            <button onClick={() => setPendingImport(null)} style={cancelBtnStyle}>
              取消
            </button>
          </div>
        </div>
      )}

      {keys.map((k) => (
        <div key={k.id} style={keyRowStyle}>
          <Key size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: "13px", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {k.name}
          </span>
          <button
            onClick={() => handleDelete(k.id, k.name)}
            style={deleteBtnStyle}
            title="删除"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

const importBtnStyle: React.CSSProperties = {
  display: "flex",
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

const keyRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 10px",
  background: "var(--bg-primary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  marginBottom: 6,
};

const deleteBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "3px 6px",
  background: "transparent",
  border: "none",
  color: "var(--text-secondary)",
  cursor: "pointer",
  borderRadius: 3,
};

const nameInputStyle: React.CSSProperties = {
  padding: "4px 8px",
  background: "var(--bg-primary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  color: "var(--text-primary)",
  fontSize: "13px",
  flex: 1,
};

const confirmBtnStyle: React.CSSProperties = {
  padding: "4px 12px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "13px",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "4px 12px",
  background: "var(--bg-tertiary)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "13px",
};
