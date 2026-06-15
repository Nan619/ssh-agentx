import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadTermPresetForTheme, setTermPreset } from "./lib/terminal/term-presets";
import { ActivityBar } from "./components/layout/ActivityBar";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { EditorArea } from "./components/layout/EditorArea";
import { AgentPanel } from "./components/agent/AgentPanel";
import { StatusBar } from "./components/layout/StatusBar";
import { HostConnectDialog } from "./components/host/HostConnectDialog";
import { HostEditor } from "./components/host/HostEditor";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { ResizeHandle } from "./components/layout/ResizeHandle";
import { ToastContainer } from "./components/ui/ToastContainer";
import { SshAuthDialog } from "./components/ssh/SshAuthDialog";
import { useTerminalStore } from "./stores/terminalStore";
import { useAgentStore } from "./stores/agentStore";
import { useHostStore, SshHost } from "./stores/hostStore";
import { useToastStore } from "./stores/toastStore";
import { useSshAuthStore } from "./stores/sshAuthStore";

type SidebarView = "hosts" | "search";

function App() {
  const [sidebarView, setSidebarView] = useState<SidebarView>("hosts");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [agentPanelVisible, setAgentPanelVisible] = useState(false);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);

  // Resizable panel widths
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [agentPanelWidth, setAgentPanelWidth] = useState(360);

  const [connectingHost, setConnectingHost] = useState<SshHost | null>(null);
  const [showHostEditor, setShowHostEditor] = useState(false);
  const [editingHost, setEditingHost] = useState<SshHost | null>(null);
  const [newHostDefaultGroup, setNewHostDefaultGroup] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const { addTerminal, setHostId, removeTerminal, setActiveTerminal } = useTerminalStore();
  const { addHost, updateHost, loadHosts } = useHostStore();
  const addToast = useToastStore((s) => s.addToast);
  const sshAuthPrompt = useSshAuthStore((s) => s.currentPrompt);
  const clearSshAuthPrompt = useSshAuthStore((s) => s.clearPrompt);

  useEffect(() => {
    loadHosts();
    invoke<any>("get_active_model").then((active) => {
      if (active) {
        console.log("[app] configuring active model:", active.provider, active.model_name);
        invoke("configure_provider", {
          request: { provider_type: active.provider, api_key: active.api_key ?? null,
            base_url: active.base_url ?? null, model: active.model_name },
        }).then(() => {
          console.log("[app] provider configured successfully");
        }).catch((e: any) => {
          console.error("[app] failed to configure provider:", e);
        });
      } else {
        console.warn("[app] no active model configured. Agent chat will not work.");
      }
    }).catch((e: any) => {
      console.error("[app] failed to load active model:", e);
    });
  }, [loadHosts]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt+1~9 — switch tabs, always active (works even when xterm textarea has focus)
      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 9) {
          e.preventDefault();
          const { terminals } = useTerminalStore.getState();
          const idx = num - 1;
          if (idx < terminals.length) {
            setActiveTerminal(terminals[idx].id);
            setActiveTerminalId(terminals[idx].id);
          }
          return;
        }
      }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Skip ALL Ctrl/Meta shortcuts when focus is in an input/textarea (xterm, form fields, etc.)
      // This prevents stealing keys like Ctrl+B (vim page-up) and Ctrl+J (newline) from the terminal.
      if (isInput) return;

      switch (e.key.toLowerCase()) {
        case "b":
          e.preventDefault();
          setSidebarVisible((v) => !v);
          return;
        case "j":
          e.preventDefault();
          setAgentPanelVisible((v) => !v);
          return;
        case ",":
          e.preventDefault();
          setShowSettings(true);
          return;
        case "t":
          e.preventDefault();
          {
            const t = addTerminal();
            setActiveTerminalId(t.id);
          }
          return;
        case "w":
          e.preventDefault();
          {
            const { activeTerminalId: activeId } = useTerminalStore.getState();
            if (activeId) {
              removeTerminal(activeId);
              useAgentStore.getState().removeSession(activeId);
            }
          }
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [addTerminal, removeTerminal, setActiveTerminal]);

  // Sync terminal preset when UI theme changes
  useEffect(() => {
    const handler = (e: Event) => {
      const resolved = (e as CustomEvent<"dark" | "light">).detail;
      const presetId = loadTermPresetForTheme(resolved);
      setTermPreset(presetId);
    };
    window.addEventListener("rssh:theme-change", handler);
    return () => window.removeEventListener("rssh:theme-change", handler);
  }, []);

  const connectRef = useRef<(host: SshHost, password?: string) => void>();
  const doConnect = useCallback((host: SshHost, password?: string) => {
    const terminal = addTerminal({
      hostname: host.hostname, port: host.port, username: host.username,
      authMethod: host.authMethod === "agent" ? "password" : host.authMethod,
      password: password ?? host.password, keyId: host.keyId,
      skillIds: host.skillIds ?? "",
    });
    setHostId(terminal.id, host.id);
    setActiveTerminalId(terminal.id);
  }, [addTerminal, setHostId]);
  connectRef.current = doConnect;

  const handleConnectSubmit = useCallback((host: SshHost, password?: string) => {
    setConnectingHost(null);
    doConnect(host, password);
  }, [doConnect]);

  const handleHostConnect = useCallback((host: SshHost) => {
    if (host.authMethod === "password" && !host.password) { setConnectingHost(host); }
    else { connectRef.current?.(host); }
  }, []);

  const handleAddHost = useCallback((defaultGroup?: string) => {
    setEditingHost(null);
    setNewHostDefaultGroup(defaultGroup ?? null);
    setShowHostEditor(true);
  }, []);
  const handleEditHost = useCallback((host: SshHost) => { setEditingHost(host); setShowHostEditor(true); }, []);
  const handleSaveHost = useCallback((host: SshHost) => {
    if (editingHost) { updateHost(host); } else { addHost(host); }
    addToast({ type: "success", message: editingHost ? "主机已更新" : "主机已添加" });
    setShowHostEditor(false); setEditingHost(null); setNewHostDefaultGroup(null);
  }, [editingHost, addHost, updateHost, addToast]);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <TitleBar
        agentPanelVisible={agentPanelVisible}
        onToggleAgentPanel={() => setAgentPanelVisible((v) => !v)}
      />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <ActivityBar
          activeView={sidebarView} onViewChange={setSidebarView}
          sidebarVisible={sidebarVisible}
          onToggleSidebar={() => setSidebarVisible((v) => !v)}
          onOpenSettings={() => setShowSettings(true)}
        />

        {sidebarVisible && (
          <Sidebar
            view={sidebarView}
            onClose={() => setSidebarVisible(false)}
            onHostConnect={handleHostConnect}
            onHostEdit={handleEditHost}
            onAddHost={handleAddHost}
            width={sidebarWidth}
          />
        )}
        <ResizeHandle
          position="left"
          onResize={(w) => setSidebarWidth(Math.min(500, w))}
          minWidth={200}
          currentWidth={sidebarVisible ? sidebarWidth : 0}
          collapseThreshold={100}
          onCollapse={() => setSidebarVisible(false)}
          onExpand={() => setSidebarVisible(true)}
        />

        <EditorArea
          activeTerminalId={activeTerminalId}
          onActiveTerminalChange={setActiveTerminalId}
        />

        <ResizeHandle
          position="right"
          onResize={(w) => setAgentPanelWidth(Math.min(600, w))}
          minWidth={280}
          currentWidth={agentPanelVisible ? agentPanelWidth : 0}
          collapseThreshold={140}
          onCollapse={() => setAgentPanelVisible(false)}
          onExpand={() => setAgentPanelVisible(true)}
        />
        {agentPanelVisible && (
          <AgentPanel
            activeTerminalId={activeTerminalId}
            onToggleVisibility={() => setAgentPanelVisible(false)}
            width={agentPanelWidth}
          />
        )}
      </div>

      <StatusBar activeTerminalId={activeTerminalId} />

      <ToastContainer />

      {connectingHost && <HostConnectDialog host={connectingHost}
        onConnect={handleConnectSubmit} onCancel={() => setConnectingHost(null)} />}
      {showHostEditor && <HostEditor host={editingHost}
        initialGroup={newHostDefaultGroup}
        onSave={handleSaveHost}
        onCancel={() => { setShowHostEditor(false); setEditingHost(null); setNewHostDefaultGroup(null); }} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {sshAuthPrompt && <SshAuthDialog {...sshAuthPrompt} onClose={clearSshAuthPrompt} />}
    </div>
  );
}

export default App;
