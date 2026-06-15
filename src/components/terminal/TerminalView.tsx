import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useTerminalStore } from "../../stores/terminalStore";
import { useAgentStore } from "../../stores/agentStore";
import { useToastStore } from "../../stores/toastStore";
import { useSshAuthStore } from "../../stores/sshAuthStore";
import { TerminalContextMenu } from "./TerminalContextMenu";
import { TransferProgress } from "./TransferProgress";
import { resolveTermTheme, TERM_PRESET_KEY } from "../../lib/terminal/term-presets";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  terminalId: string;
  isActive?: boolean;
}

export function TerminalView({ terminalId, isActive }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const searchAddonRef = useRef<any>(null);
  const sessionIdRef = useRef<string | null>(null);
  const connectedRef = useRef(false);
  const initialized = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const pendingEventsRef = useRef<Array<{ session_id: string; data: number[] }>>([]);
  const lastSelectionRef = useRef<string>("");

  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; hasSelection: boolean; pathHint: string | null;
  } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const storeState = useTerminalStore();
  const terminal = storeState.terminals.find((t) => t.id === terminalId);
  const params = terminal?.connectionParams ?? null;

  const doConnect = useCallback(
    async (t: any, p: NonNullable<typeof params>) => {
      const cols = t.cols;
      const rows = t.rows;
      const setStatus = useTerminalStore.getState().setStatus;

      setStatus(terminalId, "connecting");
      try {
        const response = await invoke<any>("ssh_connect", {
          request: {
            hostname: p.hostname,
            port: p.port,
            username: p.username,
            auth_method: p.authMethod,
            password: p.password ?? null,
            key_id: p.keyId ?? null,
            skill_ids: p.skillIds ?? "",
            cols,
            rows,
            tab_id: terminalId,
          },
        });

        if (response.success) {
          sessionIdRef.current = response.session_id;
          connectedRef.current = true;
          storeState.setSshSessionId(terminalId, response.session_id);
          useTerminalStore.getState().setHostSkillIds(terminalId, response.host_skill_ids ?? []);
          setStatus(terminalId, "connected");
          invoke("terminal_resize", {
            resize: { session_id: response.session_id, cols: t.cols, rows: t.rows },
          }).catch(() => {});

          t.write("\x1b[2J\x1b[H");
          const sid = response.session_id;
          const pending = pendingEventsRef.current.filter((e) => e.session_id === sid);
          pendingEventsRef.current = [];
          pending.forEach((e) => t.write(new Uint8Array(e.data)));
          t.scrollToBottom();
        } else {
          setStatus(terminalId, "disconnected");
          t.writeln(`\r\n\x1b[1;31mConnection failed: ${response.error}\x1b[0m\r\n`);
          useToastStore.getState().addToast({ type: "error", message: `连接失败: ${response.error}` });
        }
      } catch (e: any) {
        setStatus(terminalId, "disconnected");
        t.writeln(`\r\n\x1b[1;31mConnection error: ${e}\x1b[0m\r\n`);
        useToastStore.getState().addToast({ type: "error", message: `连接错误: ${e}` });
      }
    },
    [],
  );

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    let termInstance: any = null;
    let unlistenOutput: (() => void) | undefined;
    let unlistenDisconnect: (() => void) | undefined;
    let unlistenHostKey: (() => void) | undefined;
    let unlistenPassphrase: (() => void) | undefined;
    let unlistenAuth: (() => void) | undefined;

    listen<{ session_id: string; data: number[] }>(
      "terminal:output",
      (event) => {
        if (sessionIdRef.current) {
          if (event.payload.session_id === sessionIdRef.current) {
            termInstance?.write(new Uint8Array(event.payload.data));
            // Only scroll to bottom in normal buffer; skip in vim/less/top (alternate buffer)
            // to avoid potential interference with full-screen TUI apps.
            if (termInstance?.buffer.active.type !== "alternate") {
              termInstance?.scrollToBottom();
            }
          }
        } else {
          pendingEventsRef.current.push(event.payload);
        }
      },
    ).then((fn) => { unlistenOutput = fn; });

    listen<{ session_id: string }>(
      "terminal:disconnected",
      (event) => {
        if (sessionIdRef.current && event.payload.session_id === sessionIdRef.current) {
          useTerminalStore.getState().setStatus(terminalId, "disconnected");
          connectedRef.current = false;
          sessionIdRef.current = null;
          termInstance?.write("\r\n\x1b[1;33m[Connection lost]\x1b[0m\r\n");
          useToastStore.getState().addToast({ type: "warning", message: "SSH 连接已断开" });
        }
      },
    ).then((fn) => { unlistenDisconnect = fn; });

    listen<{ banner: string; is_mismatch: boolean }>(
      `ssh:host_key_prompt:${terminalId}`,
      (event) => {
        useSshAuthStore.getState().setPrompt({
          type: "host_key",
          tabId: terminalId,
          banner: event.payload.banner,
          isMismatch: event.payload.is_mismatch,
        });
      },
    ).then((fn) => { unlistenHostKey = fn; });

    listen<{ prompt: string }>(
      `ssh:passphrase_prompt:${terminalId}`,
      (event) => {
        useSshAuthStore.getState().setPrompt({
          type: "passphrase",
          tabId: terminalId,
          prompt: event.payload.prompt,
        });
      },
    ).then((fn) => { unlistenPassphrase = fn; });

    listen<{ name: string; instructions: string; prompts: Array<{ prompt: string; echo: boolean }> }>(
      `ssh:auth_prompt:${terminalId}`,
      (event) => {
        useSshAuthStore.getState().setPrompt({
          type: "auth",
          tabId: terminalId,
          name: event.payload.name,
          instructions: event.payload.instructions,
          prompts: event.payload.prompts,
        });
      },
    ).then((fn) => { unlistenAuth = fn; });

    import("@xterm/xterm").then(({ Terminal }) => {
      import("@xterm/addon-fit").then(({ FitAddon }) => {
        if (!containerRef.current) return;

        const fitAddon = new FitAddon();
        termInstance = new Terminal({
          cursorBlink: true,
          fontSize: 14,
          fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace',
          letterSpacing: 0,
          theme: resolveTermTheme(),
          scrollback: 5000,
        });

        termInstance.loadAddon(fitAddon);
        termInstance.open(containerRef.current);

        import("@xterm/addon-search").then(({ SearchAddon }) => {
          const searchAddon = new SearchAddon();
          termInstance.loadAddon(searchAddon);
          searchAddonRef.current = searchAddon;
        });

        let initialFit = true;
        const observer = new ResizeObserver(() => {
          fitAddon.fit();
          if (initialFit) {
            initialFit = false;
            termInstance?.scrollToBottom();
          }
        });
        observer.observe(containerRef.current!);

        termRef.current = termInstance;

        // Focus if this tab was already active at mount time — the focus effect
        // runs before xterm is ready (async import) so it's a no-op without this.
        if (isActive) {
          setTimeout(() => termInstance?.focus(), 0);
        }

        const onThemeChange = (_e: Event) => {
          const theme = resolveTermTheme();
          termInstance.options.theme = theme;
          if (containerRef.current) {
            const bg = theme.background ?? "#181818";
            containerRef.current.style.background = bg;
            if (containerRef.current.parentElement) {
              containerRef.current.parentElement.style.background = bg;
            }
          }
        };
        const onStorageTheme = (e: StorageEvent) => {
          if (e.key === TERM_PRESET_KEY) onThemeChange(e);
        };
        window.addEventListener("rssh:termpreset-change", onThemeChange);
        window.addEventListener("storage", onStorageTheme);

        const writeToSsh = (data: string) => {
          if (!sessionIdRef.current) return;
          const encoder = new TextEncoder();
          invoke("terminal_input", {
            input: {
              session_id: sessionIdRef.current,
              data: Array.from(encoder.encode(data)),
            },
          }).catch(() => {});
        };

        termInstance.attachCustomKeyEventHandler((e: KeyboardEvent) => {
          // Ctrl+Shift+C: copy selection to clipboard
          if (e.ctrlKey && e.shiftKey && e.code === "KeyC") {
            const selection = termInstance.getSelection();
            if (selection) {
              navigator.clipboard.writeText(selection).catch(() => {});
            }
            return false;
          }
          // Ctrl+Shift+V: paste clipboard to terminal
          if (e.ctrlKey && e.shiftKey && e.code === "KeyV") {
            navigator.clipboard.readText().then(writeToSsh).catch(() => {});
            return false;
          }
          // Ctrl+V: block xterm's built-in paste to prevent double-paste with native WebView paste event
          if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === "KeyV") {
            return false;
          }
          // Ctrl+Shift+F: search in terminal
          if (e.ctrlKey && e.shiftKey && e.code === "KeyF") {
            e.preventDefault();
            const query = prompt("搜索:");
            if (query && searchAddonRef.current) {
              searchAddonRef.current.findNext(query);
            }
            return false;
          }
          // Tab shortcuts — only in normal buffer, skip in vim/less/top (alternate buffer)
          const mod = e.ctrlKey || e.metaKey;
          if (mod && !e.shiftKey && !e.altKey && termInstance.buffer.active.type !== "alternate") {
            const store = useTerminalStore.getState();
            switch (e.code) {
              case "KeyT": {
                const t = store.addTerminal();
                store.setActiveTerminal(t.id);
                return false;
              }
              case "KeyW": {
                if (store.activeTerminalId) {
                  const tid = store.activeTerminalId;
                  store.removeTerminal(tid);
                  useAgentStore.getState().removeSession(tid);
                }
                return false;
              }
            }
          }
          // Alt+C: copy selection to both OS clipboard and internal store (normal buffer only)
          if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === "KeyC" &&
              termInstance.buffer.active.type !== "alternate") {
            const selection = termInstance.getSelection();
            if (selection) {
              useTerminalStore.getState().setTerminalSelection(selection);
              navigator.clipboard.writeText(selection).catch(() => {});
              return false;
            }
          }
          // Alt+V: paste terminal selection into PTY (normal buffer only)
          if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === "KeyV" &&
              termInstance.buffer.active.type !== "alternate") {
            const text = useTerminalStore.getState().terminalSelection;
            if (text) {
              writeToSsh(text);
              return false;
            }
          }
          // Alt+1-9: tab switching — only in normal buffer, skip in vim/less/top (alternate buffer)
          if (e.altKey && !e.ctrlKey && !e.shiftKey && termInstance.buffer.active.type !== "alternate") {
            switch (e.code) {
              case "Digit1": case "Digit2": case "Digit3": case "Digit4":
              case "Digit5": case "Digit6": case "Digit7": case "Digit8":
              case "Digit9":
                return false;
            }
          }
          return true;
        });

        termInstance.element?.addEventListener("contextmenu", (e: Event) => {
          e.preventDefault();
          const me = e as MouseEvent;
          const selection = termInstance.getSelection();
          const pathHint = extractPathNearCursor(termInstance);
          setContextMenu({
            x: me.clientX,
            y: me.clientY,
            hasSelection: !!selection,
            pathHint,
          });
        });

        termInstance.onSelectionChange(() => {
          const sel = termInstance.getSelection();
          if (sel) lastSelectionRef.current = sel;
        });
        termInstance.element?.addEventListener("auxclick", (e: MouseEvent) => {
          if (e.button !== 1) return;
          e.preventDefault();
          const selection = lastSelectionRef.current;
          if (selection && sessionIdRef.current) {
            const encoder = new TextEncoder();
            invoke("terminal_input", {
              input: { session_id: sessionIdRef.current, data: Array.from(encoder.encode(selection)) },
            }).catch(() => {});
          }
        });

        termInstance.onData((data: string) => {
          if (sessionIdRef.current) {
            writeToSsh(data);
          } else {
            if (data === "\r" && !connectedRef.current) {
              const currentParams = useTerminalStore.getState()
                .terminals.find((t) => t.id === terminalId)?.connectionParams;
              if (currentParams) {
                termInstance.writeln("\r\n\x1b[1;36mReconnecting...\x1b[0m");
                doConnect(termInstance, currentParams);
                return;
              }
            }
            termInstance.write(data);
          }
        });

        termInstance.onResize(({ cols, rows }: { cols: number; rows: number }) => {
          if (sessionIdRef.current) {
            invoke("terminal_resize", {
              resize: { session_id: sessionIdRef.current, cols, rows },
            }).catch(() => {});
          }
        });

        cleanupRef.current = () => {
          observer.disconnect();
          window.removeEventListener("rssh:termpreset-change", onThemeChange);
          window.removeEventListener("storage", onStorageTheme);
          if (sessionIdRef.current) {
            invoke("ssh_disconnect", {
              sessionId: sessionIdRef.current,
              tabId: terminalId,
            }).catch(() => {});
          }
          termInstance?.dispose();
          unlistenOutput?.();
          unlistenDisconnect?.();
          unlistenHostKey?.();
          unlistenPassphrase?.();
          unlistenAuth?.();
        };

        const p = params;
        if (p) {
          termInstance.writeln(
            `\x1b[1;36mConnecting to ${p.username}@${p.hostname}:${p.port}...\x1b[0m\r\n`,
          );
          doConnect(termInstance, p);
        } else {
          termInstance.writeln("\x1b[1;36m╔════════════════════════════════════════════╗\x1b[0m");
          termInstance.writeln("\x1b[1;36m║     SSH Agent Terminal Ready                ║\x1b[0m");
          termInstance.writeln("\x1b[1;36m║     Select a host from the sidebar           ║\x1b[0m");
          termInstance.writeln("\x1b[1;36m╚════════════════════════════════════════════╝\x1b[0m");
          termInstance.writeln("");
        }
      });
    });

    return () => {
      cleanupRef.current?.();
    };
  }, [terminalId]);

  useEffect(() => {
    if (params && !connectedRef.current && termRef.current) {
      doConnect(termRef.current, params);
    }
  }, [params, doConnect]);

  useEffect(() => {
    if (isActive && termRef.current) {
      setTimeout(() => termRef.current?.focus(), 0);
    }
  }, [isActive]);

  const handleCopy = useCallback(() => {
    const sel = termRef.current?.getSelection();
    if (sel) navigator.clipboard.writeText(sel).catch(() => {});
  }, []);

  const handlePaste = useCallback(() => {
    navigator.clipboard.readText().then((text) => {
      if (sessionIdRef.current && text) {
        const encoder = new TextEncoder();
        invoke("terminal_input", {
          input: { session_id: sessionIdRef.current, data: Array.from(encoder.encode(text)) },
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const handleSelectAll = useCallback(() => {
    termRef.current?.selectAll();
  }, []);

  const handleSearch = useCallback(() => {
    const query = prompt("搜索:");
    if (query && searchAddonRef.current) {
      searchAddonRef.current.findNext(query);
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!sessionIdRef.current) return;
    const files = await open({ multiple: true, directory: false });
    if (!files || files.length === 0) return;
    try {
      await invoke("scp_upload", {
        request: {
          session_id: sessionIdRef.current,
          local_paths: Array.isArray(files) ? files : [files],
          remote_dir: "~",
        },
      });
      useToastStore.getState().addToast({ type: "success", message: "文件上传完成" });
    } catch (e: any) {
      useToastStore.getState().addToast({ type: "error", message: `上传失败: ${e}` });
    }
  }, []);

  const handleDownload = useCallback(async (pathHint: string | null) => {
    if (!sessionIdRef.current) return;
    let remotePath = pathHint || prompt("输入远程文件路径:") || "";
    remotePath = remotePath.trim();
    if (!remotePath) return;

    const savePath = await save({ defaultPath: remotePath.split("/").pop() || "download" });
    if (!savePath) return;

    try {
      await invoke("scp_download", {
        request: {
          session_id: sessionIdRef.current,
          remote_paths: [remotePath],
          local_dir: savePath.substring(0, savePath.lastIndexOf("/")) || savePath.substring(0, savePath.lastIndexOf("\\")),
        },
      });
      useToastStore.getState().addToast({ type: "success", message: "文件下载完成" });
    } catch (e: any) {
      useToastStore.getState().addToast({ type: "error", message: `下载失败: ${e}` });
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!sessionIdRef.current) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const localPaths = files.map((f) => (f as any).path || f.name).filter(Boolean);
    if (localPaths.length === 0) return;

    try {
      await invoke("scp_upload", {
        request: {
          session_id: sessionIdRef.current,
          local_paths: localPaths,
          remote_dir: "~",
        },
      });
      useToastStore.getState().addToast({ type: "success", message: `${localPaths.length} 个文件上传完成` });
    } catch (e: any) {
      useToastStore.getState().addToast({ type: "error", message: `上传失败: ${e}` });
    }
  }, []);

  return (
    <div
      style={{
        flex: 1,
        height: "100%",
        background: resolveTermTheme().background ?? "#181818",
        overflow: "hidden",
        outline: isDragOver ? "2px dashed var(--accent)" : "none",
        outlineOffset: -2,
      }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <TransferProgress sessionId={sessionIdRef.current} />
        {contextMenu && (
          <TerminalContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            hasSelection={contextMenu.hasSelection}
            pathHint={contextMenu.pathHint}
            onCopy={handleCopy}
            onPaste={handlePaste}
            onSelectAll={handleSelectAll}
            onSearch={handleSearch}
            onUpload={handleUpload}
            onDownload={handleDownload}
            onClose={() => {
              setContextMenu(null);
              termRef.current?.focus();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Extract an absolute path from the terminal line near the cursor. */
function extractPathNearCursor(term: any): string | null {
  try {
    const buf = term.buffer.active;
    const row = buf.cursorY + buf.viewportY;
    const line = buf.getLine(row);
    if (!line) return null;
    const text = line.translateToString(true);
    const match = text.match(/\/(?:[\w.\-]+\/)*[\w.\-]+(?:\.[\w]+)?/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}
