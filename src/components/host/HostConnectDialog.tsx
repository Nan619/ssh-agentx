import { useState } from "react";
import { SshHost } from "../../stores/hostStore";

interface HostConnectDialogProps {
  host: SshHost;
  onConnect: (host: SshHost, password?: string) => void;
  onCancel: () => void;
}

export function HostConnectDialog({ host, onConnect, onCancel }: HostConnectDialogProps) {
  const [password, setPassword] = useState(host.password ?? "");
  const [showPassword, setShowPassword] = useState(false);

  const handleConnect = () => {
    if (host.authMethod === "password" && !password.trim()) return;
    onConnect(host, password || undefined);
  };

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <h3 style={{ margin: "0 0 16px", fontSize: "14px", fontWeight: 600 }}>
          连接到 {host.name}
        </h3>

        <div style={rowStyle}>
          <span style={labelStyle}>主机地址</span>
          <span style={valueStyle}>
            {host.username}@{host.hostname}:{host.port}
          </span>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>认证方式</span>
          <span style={valueStyle}>
            {({ password: "密码", key: "密钥", agent: "SSH Agent", interactive: "键盘交互", none: "无认证" } as Record<string, string>)[host.authMethod] ?? host.authMethod}
          </span>
        </div>

        {host.authMethod === "password" && (
          <div style={rowStyle}>
            <span style={labelStyle}>密码</span>
            <div style={{ display: "flex", gap: 4, flex: 1 }}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                placeholder="输入密码..."
                autoFocus
                style={inputStyle}
              />
              <button
                onClick={() => setShowPassword(!showPassword)}
                style={toggleBtnStyle}
              >
                {showPassword ? "隐藏" : "显示"}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button onClick={onCancel} style={cancelBtnStyle}>
            取消
          </button>
          <button onClick={handleConnect} style={connectBtnStyle}>
            连接
          </button>
        </div>
      </div>
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
  minWidth: 400,
  maxWidth: 480,
  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginBottom: 12,
  fontSize: "13px",
};

const labelStyle: React.CSSProperties = {
  width: 70,
  color: "var(--text-secondary)",
  flexShrink: 0,
};

const valueStyle: React.CSSProperties = {
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "4px 8px",
  background: "var(--bg-primary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  color: "var(--text-primary)",
  fontSize: "13px",
  outline: "none",
};

const toggleBtnStyle: React.CSSProperties = {
  padding: "4px 8px",
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: "12px",
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

const connectBtnStyle: React.CSSProperties = {
  padding: "6px 16px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "13px",
};
