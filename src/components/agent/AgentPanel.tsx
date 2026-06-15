import { useState, useRef, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { X, Send, ChevronRight, Copy, Terminal, ScanLine, Zap } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useAgentStore, ChatMessage } from "../../stores/agentStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useToastStore } from "../../stores/toastStore";
import { useSkillStore } from "../../stores/skillStore";

interface AgentPanelProps {
  activeTerminalId: string | null;
  onToggleVisibility: () => void;
  width?: number;
}

function useSyntaxTheme() {
  const [resolved, setResolved] = useState<"dark" | "light">(() =>
    document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"
  );

  useEffect(() => {
    const handler = (e: Event) => {
      setResolved((e as CustomEvent<"dark" | "light">).detail);
    };
    window.addEventListener("rssh:theme-change", handler);
    return () => window.removeEventListener("rssh:theme-change", handler);
  }, []);

  return resolved === "light" ? oneLight : oneDark;
}

export function AgentPanel({ activeTerminalId, onToggleVisibility, width = 360 }: AgentPanelProps) {
  const { messages, isStreaming, streamingContent } = useAgentStore(
    (s) => s.getSession(activeTerminalId ?? ""),
  );
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingResult, setPendingResult] = useState<{
    command: string;
    stdout: string;
    exitCode: number;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingConvSkillIdsRef = useRef<string[]>([]);
  const streamingTerminalIdRef = useRef<string>("");

  // Get the active terminal's SSH session ID for sending commands
  const terminalStore = useTerminalStore();
  const activeTerminal = activeTerminalId
    ? terminalStore.terminals.find((t) => t.id === activeTerminalId)
    : null;
  const activeSshSessionId = activeTerminal?.sshSessionId ?? null;
  const addToast = useToastStore((s) => s.addToast);
  const syntaxTheme = useSyntaxTheme();

  // Skill pills: load skills and derive active skill names from the current session
  const { skills, loadSkills } = useSkillStore();
  useEffect(() => { loadSkills(); }, []);
  const activeSkillNames = (activeTerminal?.hostSkillIds ?? [])
    .map((id) => skills.find((sk) => sk.id === id)?.name)
    .filter((name): name is string => name !== undefined);

  const handleSendToTerminal = useCallback(
    async (command: string) => {
      if (!activeSshSessionId) {
        setError("没有活跃的 SSH 连接，请先连接主机");
        return;
      }
      setPendingResult(null);
      setError(null);
      try {
        console.log("[agent_exec] invoking with command:", command);
        const result = await invoke<any>("agent_exec", {
          request: {
            session_id: activeSshSessionId,
            command,
          },
        });
        console.log("[agent_exec] result:", result);

        const exitCode: number = result.exit_code;
        const stdout: string = result.stdout;

        // Show execution result as a system message
        useAgentStore.getState().addMessage(activeTerminalId ?? "", {
          id: crypto.randomUUID(),
          role: "system",
          content: `命令执行完成 | 退出码: ${exitCode}\n\`\`\`\n${stdout || "(无输出)"}\n\`\`\``,
          timestamp: Date.now(),
        });

        // Let the user decide whether to analyze
        setPendingResult({ command, stdout, exitCode });
        addToast({ type: exitCode === 0 ? "success" : "warning", message: `命令执行完成 (退出码: ${exitCode})` });
      } catch (e: any) {
        console.error("[agent_exec] error:", e);
        setError(`执行失败：${e}`);
        addToast({ type: "error", message: `命令执行失败: ${e}` });
      }
    },
    [activeSshSessionId, activeTerminalId, addToast],
  );

  const handleCopy = useCallback(async (text: string) => {    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers / insecure context
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-dismiss error after 8 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(timer);
  }, [error]);

  // Listen for streaming agent responses
  useEffect(() => {
    const unlistenChunk = listen<{ content: string; finish_reason: string | null }>(
      "agent:chunk",
      (event) => {
        if (!streamingTerminalIdRef.current) return;
        const { content, finish_reason } = event.payload;
        useAgentStore.getState().appendStreamingContent(streamingTerminalIdRef.current, content);

        if (finish_reason === "stop") {
          const tid = streamingTerminalIdRef.current;
          const finalContent = useAgentStore.getState().getSession(tid).streamingContent;
          useAgentStore.getState().addMessage(tid, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: finalContent,
            timestamp: Date.now(),
            convSkillIds: pendingConvSkillIdsRef.current,
          });
          pendingConvSkillIdsRef.current = [];
          useAgentStore.getState().setStreaming(tid, false);
        }
      },
    );

    const unlistenError = listen<{ error: string }>(
      "agent:error",
      (event) => {
        const tid = streamingTerminalIdRef.current;
        pendingConvSkillIdsRef.current = [];
        setError(event.payload.error);
        useAgentStore.getState().setStreaming(tid, false);
        useAgentStore.getState().addMessage(tid, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `❌ 错误：${event.payload.error}`,
          timestamp: Date.now(),
        });
      },
    );

    return () => {
      unlistenChunk.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, []);

  // Listen for conversation skill matches (emitted before each streaming response)
  useEffect(() => {
    const unlisten = listen<{ session_id: string; ids: string[] }>(
      "agent:conv_skills",
      (event) => {
        if (event.payload.session_id === (activeSshSessionId ?? "")) {
          pendingConvSkillIdsRef.current = event.payload.ids;
        }
      },
    );
    return () => {
      pendingConvSkillIdsRef.current = [];
      unlisten.then((fn) => fn());
    };
  }, [activeSshSessionId]);

  const handleAnalyzePendingResult = useCallback(async () => {
    if (!pendingResult || isStreaming || !activeSshSessionId) return;
    const { command, stdout, exitCode } = pendingResult;
    setPendingResult(null);
    setError(null);

    const hint =
      exitCode !== 0
        ? "命令执行失败，请分析原因并提供解决方案"
        : "命令执行成功，请分析输出结果";
    const analysisContent = `我刚通过终端执行了以下命令：\n\n\`\`\`bash\n${command}\n\`\`\`\n\n退出码: ${exitCode}\n\n输出：\n\`\`\`\n${stdout || "(无输出)"}\n\`\`\`\n\n${hint}`;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: analysisContent,
      timestamp: Date.now(),
    };
    const termId = activeTerminalId ?? "";
    streamingTerminalIdRef.current = termId;
    useAgentStore.getState().addMessage(termId, userMsg);
    useAgentStore.getState().setStreaming(termId, true);
    useAgentStore.getState().resetStreamingContent(termId);

    const prevMessages = useAgentStore.getState().getSession(termId).messages;
    const msgList = prevMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

    try {
      await invoke("agent_chat", {
        request: {
          messages: msgList,
          host_context: null,
          terminal_context: null,
          session_id: activeSshSessionId,
        },
      });
    } catch (e: any) {
      useAgentStore.getState().setStreaming(streamingTerminalIdRef.current, false);
      setError(e.toString());
    }
  }, [pendingResult, isStreaming, activeSshSessionId, activeTerminalId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setError(null);
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    const termId = activeTerminalId ?? "";
    streamingTerminalIdRef.current = termId;
    useAgentStore.getState().addMessage(termId, userMsg);
    setInput("");
    useAgentStore.getState().setStreaming(termId, true);
    useAgentStore.getState().resetStreamingContent(termId);

    try {
      const msgList = useAgentStore.getState().getSession(termId).messages
        .concat(userMsg)
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }));

      // Fetch recent terminal output for context (best-effort)
      let terminalContext: string | null = null;
      if (activeSshSessionId) {
        try {
          terminalContext = await invoke<string>("get_terminal_output", {
            sessionId: activeSshSessionId,
          });
        } catch {
          // non-fatal
        }
      }

      await invoke("agent_chat", {
        request: {
          messages: msgList,
          host_context: null,
          terminal_context: terminalContext,
          session_id: activeSshSessionId,
        },
      });
    } catch (e: any) {
      useAgentStore.getState().setStreaming(streamingTerminalIdRef.current, false);
      setError(e.toString());
      useAgentStore.getState().addMessage(streamingTerminalIdRef.current, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `❌ 请求失败：${e}`,
        timestamp: Date.now(),
      });
    }
  }, [input, isStreaming, activeSshSessionId, activeTerminalId]);

  const handleAnalyzeTerminal = useCallback(async () => {
    if (!activeSshSessionId) {
      setError("没有活跃的 SSH 连接，请先连接主机");
      return;
    }
    if (isStreaming) return;

    setError(null);

    let terminalOutput = "";
    try {
      terminalOutput = await invoke<string>("get_terminal_output", {
        sessionId: activeSshSessionId,
      });
    } catch (e: any) {
      setError(`获取终端输出失败：${e}`);
      return;
    }

    if (!terminalOutput.trim()) {
      setError("终端暂无输出内容");
      return;
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: "请分析以上终端输出，如有错误请给出解决方案。",
      timestamp: Date.now(),
    };
    const termId = activeTerminalId ?? "";
    streamingTerminalIdRef.current = termId;
    useAgentStore.getState().addMessage(termId, userMsg);
    useAgentStore.getState().setStreaming(termId, true);
    useAgentStore.getState().resetStreamingContent(termId);

    try {
      const msgList = useAgentStore.getState().getSession(termId).messages
        .concat(userMsg)
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }));

      await invoke("agent_chat", {
        request: {
          messages: msgList,
          host_context: null,
          terminal_context: terminalOutput,
          session_id: activeSshSessionId,
        },
      });
    } catch (e: any) {
      useAgentStore.getState().setStreaming(streamingTerminalIdRef.current, false);
      setError(e.toString());
      useAgentStore.getState().addMessage(streamingTerminalIdRef.current, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `❌ 请求失败：${e}`,
        timestamp: Date.now(),
      });
    }
  }, [activeSshSessionId, isStreaming, activeTerminalId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.altKey) {
      e.preventDefault();
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart ?? input.length;
      const end = el.selectionEnd ?? input.length;
      const next = input.slice(0, start) + "\n" + input.slice(end);
      flushSync(() => setInput(next));
      el.selectionStart = start + 1;
      el.selectionEnd = start + 1;
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    // Alt+V: paste terminal selection into Agent input at cursor position
    if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === "KeyV") {
      e.preventDefault();
      const text = useTerminalStore.getState().terminalSelection;
      if (!text) return;
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart ?? input.length;
      const end = el.selectionEnd ?? input.length;
      const next = input.slice(0, start) + text + input.slice(end);
      flushSync(() => setInput(next));
      el.selectionStart = start + text.length;
      el.selectionEnd = start + text.length;
    }
  };

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  return (
    <div style={{ ...panelStyle, width, minWidth: width }} role="complementary" aria-label="运维 Agent">
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: "var(--font-size)", fontWeight: 600 }}>运维 Agent</span>
          {activeTerminal && (
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              <ChevronRight size={12} style={{ verticalAlign: "middle" }} />
              {activeTerminal.title}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {messages.length > 0 && (
            <button onClick={() => useAgentStore.getState().clearMessages(activeTerminalId ?? "")} title="清空对话" style={iconBtnStyle}>
              <span style={{ fontSize: "11px" }}>清空</span>
            </button>
          )}
          <button onClick={onToggleVisibility} title="关闭" style={iconBtnStyle}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Skill pills */}
      {activeSkillNames.length > 0 && (
        <div style={skillPillsRowStyle}>
          {activeSkillNames.map((name) => (
            <span key={name} style={skillPillStyle}>
              ⚡ {name}
            </span>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 0" }} role="log" aria-live="polite" aria-label="对话消息">
        {messages.length === 0 && (
          <div style={welcomeStyle}>
            <div style={welcomeIconStyle}>
              <Terminal size={24} style={{ color: "var(--accent)" }} />
            </div>
            <div style={{ fontSize: "var(--font-size)", fontWeight: 600, marginBottom: 4 }}>
              运维 Agent
            </div>
            <div style={{ fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>
              输入运维口令，我来帮你生成命令
            </div>
          </div>
        )}
        {(() => {
          let lastAssistantConvKey: string | null = null;
          return messages.flatMap((msg) => {
            const nodes: React.ReactNode[] = [];

            if (msg.role === "assistant") {
              const currentKey = msg.convSkillIds?.length
                ? [...msg.convSkillIds].sort().join(",")
                : null;

              if (currentKey && currentKey !== lastAssistantConvKey) {
                const skillNames = msg.convSkillIds!
                  .map((id) => skills.find((sk) => sk.id === id)?.name)
                  .filter((n): n is string => n !== undefined);
                if (skillNames.length > 0) {
                  nodes.push(
                    <div key={`conv-skills-${msg.id}`} style={convSkillNoticeStyle}>
                      {skillNames.map((n) => `⚡ ${n}`).join(" · ")}
                    </div>
                  );
                }
              }
              lastAssistantConvKey = currentKey;
            }

            nodes.push(
              <ChatMessageBubble
                key={msg.id}
                message={msg}
                onSendToTerminal={handleSendToTerminal}
                onCopy={handleCopy}
                syntaxTheme={syntaxTheme}
              />
            );
            return nodes;
          });
        })()}
        {isStreaming && (
          <div style={{ padding: "8px 16px" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, marginBottom: 4, color: "var(--text-secondary)" }}>
              Agent
            </div>
            <span style={{ fontSize: "var(--font-size)" }}>
              {streamingContent || "思考中..."}
              <span className="cursor-blink" style={{ animation: "blink 1s step-end infinite" }}>▌</span>
            </span>
          </div>
        )}
        {pendingResult && !isStreaming && (
          <div style={pendingResultCardStyle}>
            <div style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", marginBottom: 6 }}>
              命令已执行，退出码：{pendingResult.exitCode === 0 ? "✓ 0 (成功)" : `✗ ${pendingResult.exitCode} (失败)`}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={handleAnalyzePendingResult} style={analyzeResultBtnStyle}>
                <Zap size={13} style={{ marginRight: 4 }} />
                分析结果
              </button>
              <button onClick={() => setPendingResult(null)} style={dismissBtnStyle}>
                忽略
              </button>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={inputAreaStyle}>
        <div style={{ ...inputBoxStyle, borderColor: inputFocused ? "var(--accent)" : "var(--border-color)" }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="输入运维口令..."
            disabled={isStreaming}
            rows={1}
            style={inputStyle}
            aria-label="输入消息"
          />
          <div style={inputActionsStyle}>
            {activeSshSessionId && (
              <button
                onClick={handleAnalyzeTerminal}
                disabled={isStreaming}
                title="分析终端输出"
                style={{
                  ...analyzeTerminalBtnStyle,
                  opacity: isStreaming ? 0.4 : 1,
                }}
              >
                <ScanLine size={16} />
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              style={{
                ...sendBtnStyle,
                opacity: isStreaming || !input.trim() ? 0.4 : 1,
              }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div style={errorBarStyle}>
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError(null)} style={errorCloseBtnStyle} aria-label="关闭错误">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function ChatMessageBubble({
  message,
  onSendToTerminal,
  onCopy,
  syntaxTheme,
}: {
  message: ChatMessage;
  onSendToTerminal: (cmd: string) => void;
  onCopy: (text: string) => void;
  syntaxTheme: any;
}) {
  const isUser = message.role === "user";

  return (
    <div style={{ padding: "8px 16px", background: isUser ? "var(--agent-user-bg)" : "var(--agent-bot-bg)" }}>
      <div style={{ fontSize: "11px", fontWeight: 600, marginBottom: 4, color: "var(--text-secondary)" }}>
        {isUser ? "你" : "Agent"}
      </div>
      <div style={{ fontSize: "var(--font-size)", lineHeight: 1.6 }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || "");
              const codeStr = String(children).replace(/\n$/, "");
              const isInline = !match && !className;

              if (!isInline && match) {
                return (
                  <div style={codeBlockStyle}>
                    <div style={codeBlockHeaderStyle}>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{match[1]}</span>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => onCopy(codeStr)} title="复制" style={codeActionBtnStyle}>
                          <Copy size={14} />
                        </button>
                        {!isUser && (
                          <button
                            onClick={() => onSendToTerminal(codeStr)}
                            title="发送到终端"
                            style={{ ...codeActionBtnStyle, color: "var(--accent)" }}
                          >
                            <Terminal size={14} />
                            发送到终端
                          </button>
                        )}
                      </div>
                    </div>
                    <SyntaxHighlighter
                      language={match[1]}
                      style={syntaxTheme}
                      PreTag="div"
                      customStyle={{ margin: 0, borderRadius: 0, fontSize: "var(--font-size-sm)" }}
                    >
                      {codeStr}
                    </SyntaxHighlighter>
                  </div>
                );
              }

              return (
                <code className={className} style={inlineCodeStyle} {...props}>
                  {children}
                </code>
              );
            },
            pre({ children }) {
              return <>{children}</>;
            },
            a({ href, children }) {
              return (
                <a
                  href={href}
                  onClick={(e) => { e.preventDefault(); if (href) import("@tauri-apps/plugin-shell").then((s) => s.open(href)); }}
                  style={{ color: "var(--accent)", textDecoration: "none" }}
                >
                  {children}
                </a>
              );
            },
            table({ children }) {
              return (
                <div style={{ overflowX: "auto", margin: "8px 0" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "var(--font-size-sm)" }}>
                    {children}
                  </table>
                </div>
              );
            },
            th({ children }) {
              return <th style={{ border: "1px solid var(--border-color)", padding: "4px 8px", background: "var(--bg-tertiary)", textAlign: "left" }}>{children}</th>;
            },
            td({ children }) {
              return <td style={{ border: "1px solid var(--border-color)", padding: "4px 8px" }}>{children}</td>;
            },
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

// Styles
const panelStyle: React.CSSProperties = {
  width: "var(--agent-panel-default-width)",
  minWidth: "var(--agent-panel-min-width)",
  background: "var(--bg-secondary)",
  borderLeft: "1px solid var(--border-color)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  height: "var(--tab-height)",
  padding: "0 16px",
  borderBottom: "1px solid var(--border-color)",
};

const iconBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  borderRadius: 4,
};

const welcomeStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "32px 16px",
  textAlign: "center",
  minHeight: "100%",
};

const welcomeIconStyle: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: "50%",
  background: "var(--bg-tertiary)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: 12,
};

const inputAreaStyle: React.CSSProperties = {
  padding: "8px 12px 12px",
  borderTop: "1px solid var(--border-color)",
};

const inputBoxStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 0,
  padding: "4px 8px",
  background: "var(--bg-primary)",
  border: "1px solid var(--border-color)",
  borderRadius: 6,
};

const inputActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 6,
  paddingTop: 4,
  paddingBottom: 2,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "transparent",
  border: "none",
  outline: "none",
  color: "var(--text-primary)",
  fontSize: "var(--font-size)",
  padding: "4px 0",
  resize: "none",
  lineHeight: 1.5,
  fontFamily: "inherit",
  overflow: "hidden",
  minHeight: 24,
  display: "block",
};

const sendBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  flexShrink: 0,
};

const analyzeTerminalBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  color: "var(--text-muted)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  cursor: "pointer",
  flexShrink: 0,
};

const errorBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  background: "color-mix(in srgb, var(--color-error) 15%, transparent)",
  color: "var(--color-error)",
  fontSize: "var(--font-size-sm)",
};

const errorCloseBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--color-error)",
  cursor: "pointer",
  padding: 2,
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
};

const codeBlockStyle: React.CSSProperties = {
  margin: "8px 0",
  background: "var(--agent-code-bg)",
  border: "1px solid var(--agent-code-border)",
  borderRadius: 4,
  overflow: "hidden",
};

const codeBlockHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "4px 8px",
  background: "var(--bg-tertiary)",
  borderBottom: "1px solid var(--agent-code-border)",
};

const codeActionBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 8px",
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: "11px",
  borderRadius: 3,
};

const inlineCodeStyle: React.CSSProperties = {
  background: "var(--agent-code-bg)",
  border: "1px solid var(--agent-code-border)",
  borderRadius: 3,
  padding: "1px 5px",
  fontFamily: "var(--font-mono)",
  fontSize: "0.9em",
};

const pendingResultCardStyle: React.CSSProperties = {
  margin: "8px 16px",
  padding: "10px 12px",
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border-color)",
  borderRadius: 6,
};

const analyzeResultBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 12px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "var(--font-size-sm)",
  fontWeight: 600,
};

const dismissBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  background: "transparent",
  color: "var(--text-muted)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "var(--font-size-sm)",
};

const skillPillsRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
  padding: "4px 12px 6px",
  borderBottom: "1px solid var(--border-color)",
};

const skillPillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border-color)",
  borderRadius: 10,
  fontSize: "11px",
  color: "var(--accent)",
  fontWeight: 500,
};

const convSkillNoticeStyle: React.CSSProperties = {
  padding: "6px 16px 2px",
  fontSize: "11px",
  color: "var(--text-muted)",
};
