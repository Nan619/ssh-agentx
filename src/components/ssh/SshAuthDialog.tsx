import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Shield, Key, Lock } from "lucide-react";
import { SshAuthPrompt } from "../../stores/sshAuthStore";

interface SshAuthDialogProps extends SshAuthPrompt {
  onClose: () => void;
}

export function SshAuthDialog(props: SshAuthDialogProps) {
  const { type, tabId, onClose } = props;

  if (type === "host_key") {
    return <HostKeyDialog tabId={tabId} banner={props.banner || ""} isMismatch={props.isMismatch ?? false} onClose={onClose} />;
  }
  if (type === "passphrase") {
    return <PassphraseDialog tabId={tabId} prompt={props.prompt || ""} onClose={onClose} />;
  }
  if (type === "auth") {
    return (
      <AuthDialog
        tabId={tabId}
        name={props.name}
        instructions={props.instructions}
        prompts={props.prompts || []}
        onClose={onClose}
      />
    );
  }
  return null;
}

function HostKeyDialog({ tabId, banner, isMismatch, onClose }: { tabId: string; banner: string; isMismatch: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);

  const handleTrust = async () => {
    setLoading(true);
    const answer = isMismatch ? "replace" : "yes";
    await invoke("ssh_host_key_respond", { tabId, answer }).catch(() => {});
    onClose();
  };

  const handleReject = async () => {
    setLoading(true);
    await invoke("ssh_host_key_cancel", { tabId }).catch(() => {});
    onClose();
  };

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <div style={headerRowStyle}>
          <Shield size={20} style={{ color: isMismatch ? "var(--color-error, #e05252)" : "var(--color-warning)" }} />
          <span style={titleStyle}>主机密钥验证</span>
        </div>
        <div style={bannerStyle}>{banner}</div>
        <div style={footerStyle}>
          <button onClick={handleReject} disabled={loading} style={cancelBtnStyle}>
            拒绝
          </button>
          <button onClick={handleTrust} disabled={loading} style={isMismatch ? warnBtnStyle : trustBtnStyle}>
            {isMismatch ? "替换密钥并连接" : "信任并连接"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PassphraseDialog({ tabId, prompt, onClose }: { tabId: string; prompt: string; onClose: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async () => {
    setLoading(true);
    await invoke("ssh_passphrase_respond", { tabId, passphrase }).catch(() => {});
    onClose();
  };

  const handleCancel = async () => {
    setLoading(true);
    await invoke("ssh_passphrase_cancel", { tabId }).catch(() => {});
    onClose();
  };

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <div style={headerRowStyle}>
          <Key size={20} style={{ color: "var(--accent)" }} />
          <span style={titleStyle}>密钥密码</span>
        </div>
        <div style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", marginBottom: 12 }}>
          {prompt}
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <input
            ref={inputRef}
            type={showPass ? "text" : "password"}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="输入密钥密码..."
            style={{ ...inputStyle, flex: 1 }}
            disabled={loading}
          />
          <button onClick={() => setShowPass(!showPass)} style={toggleBtnStyle}>
            {showPass ? "隐藏" : "显示"}
          </button>
        </div>
        <div style={footerStyle}>
          <button onClick={handleCancel} disabled={loading} style={cancelBtnStyle}>
            取消
          </button>
          <button onClick={handleSubmit} disabled={loading || !passphrase} style={{ ...submitBtnStyle, opacity: !passphrase ? 0.4 : 1 }}>
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthDialog({
  tabId,
  name,
  instructions,
  prompts,
  onClose,
}: {
  tabId: string;
  name?: string;
  instructions?: string;
  prompts: Array<{ prompt: string; echo: boolean }>;
  onClose: () => void;
}) {
  const [responses, setResponses] = useState<string[]>(prompts.map(() => ""));
  const [loading, setLoading] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstInputRef.current?.focus(); }, []);

  const updateResponse = (idx: number, val: string) => {
    setResponses((prev) => prev.map((r, i) => (i === idx ? val : r)));
  };

  const handleSubmit = async () => {
    setLoading(true);
    await invoke("ssh_auth_respond", { tabId, responses }).catch(() => {});
    onClose();
  };

  const handleCancel = async () => {
    setLoading(true);
    await invoke("ssh_auth_cancel", { tabId }).catch(() => {});
    onClose();
  };

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <div style={headerRowStyle}>
          <Lock size={20} style={{ color: "var(--accent)" }} />
          <span style={titleStyle}>{name || "身份验证"}</span>
        </div>
        {instructions && (
          <div style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", marginBottom: 12 }}>
            {instructions}
          </div>
        )}
        {prompts.map((p, idx) => (
          <div key={idx} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", marginBottom: 4 }}>
              {p.prompt.replace(/:\s*$/, "")}
            </div>
            <input
              ref={idx === 0 ? firstInputRef : undefined}
              type={p.echo ? "text" : "password"}
              value={responses[idx]}
              onChange={(e) => updateResponse(idx, e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && idx === prompts.length - 1 && handleSubmit()}
              style={inputStyle}
              disabled={loading}
            />
          </div>
        ))}
        <div style={footerStyle}>
          <button onClick={handleCancel} disabled={loading} style={cancelBtnStyle}>
            取消
          </button>
          <button onClick={handleSubmit} disabled={loading} style={submitBtnStyle}>
            提交
          </button>
        </div>
      </div>
    </div>
  );
}

// Styles
const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1100,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border-color)",
  borderRadius: 8,
  padding: "20px 24px",
  width: 440,
  maxWidth: "90vw",
  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
};

const headerRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 16,
};

const titleStyle: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: 600,
  color: "var(--text-primary)",
};

const bannerStyle: React.CSSProperties = {
  background: "var(--bg-primary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  padding: "10px 12px",
  fontSize: "var(--font-size-sm)",
  fontFamily: "var(--font-mono)",
  color: "var(--text-secondary)",
  whiteSpace: "pre-wrap",
  marginBottom: 16,
  maxHeight: 200,
  overflow: "auto",
  lineHeight: 1.5,
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

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 16,
  paddingTop: 12,
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

const submitBtnStyle: React.CSSProperties = {
  padding: "6px 20px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 500,
};

const trustBtnStyle: React.CSSProperties = {
  ...submitBtnStyle,
  background: "var(--color-success)",
};

const warnBtnStyle: React.CSSProperties = {
  ...submitBtnStyle,
  background: "var(--color-error, #e05252)",
};

const toggleBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "var(--bg-tertiary)",
  color: "var(--text-secondary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "12px",
  flexShrink: 0,
};
