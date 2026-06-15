import { create } from "zustand";

export interface SshConnectionParams {
  hostname: string;
  port: number;
  username: string;
  authMethod: "password" | "key" | "agent" | "interactive" | "none";
  password?: string;
  keyId?: string;
  keyPassphrase?: string;
  skillIds?: string;
}

export type TerminalStatus = "disconnected" | "connecting" | "connected";

export interface TerminalSession {
  id: string;
  title: string;
  hostId: string | null;
  connectionParams: SshConnectionParams | null;
  sshSessionId: string | null;
  status: TerminalStatus;
  hostSkillIds?: string[];
}

interface TerminalStore {
  terminals: TerminalSession[];
  activeTerminalId: string | null;
  addTerminal: (params?: SshConnectionParams) => TerminalSession;
  removeTerminal: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  updateTerminalTitle: (id: string, title: string) => void;
  setHostId: (id: string, hostId: string) => void;
  clearConnectionParams: (id: string) => void;
  setSshSessionId: (id: string, sshSessionId: string) => void;
  setStatus: (id: string, status: TerminalStatus) => void;
  setHostSkillIds: (id: string, hostSkillIds: string[]) => void;
  terminalSelection: string;
  setTerminalSelection: (text: string) => void;
}

let counter = 0;

export const useTerminalStore = create<TerminalStore>((set) => ({
  terminals: [],
  activeTerminalId: null,
  addTerminal: (params) => {
    counter++;
    const t: TerminalSession = {
      id: crypto.randomUUID(),
      title: params
        ? `${params.username}@${params.hostname}`
        : `终端 ${counter}`,
      hostId: null,
      connectionParams: params ?? null,
      sshSessionId: null,
      status: "disconnected",
    };
    set((s) => ({
      terminals: [...s.terminals, t],
      activeTerminalId: t.id,
    }));
    return t;
  },
  removeTerminal: (id) =>
    set((s) => {
      const filtered = s.terminals.filter((t) => t.id !== id);
      return {
        terminals: filtered,
        activeTerminalId:
          s.activeTerminalId === id
            ? filtered.length > 0
              ? filtered[filtered.length - 1].id
              : null
            : s.activeTerminalId,
      };
    }),
  setActiveTerminal: (id) => set({ activeTerminalId: id }),
  updateTerminalTitle: (id, title) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, title } : t)),
    })),
  setHostId: (id, hostId) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, hostId } : t)),
    })),
  clearConnectionParams: (id) =>
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === id ? { ...t, connectionParams: null } : t,
      ),
    })),
  setSshSessionId: (id, sshSessionId) =>
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === id ? { ...t, sshSessionId } : t,
      ),
    })),
  setStatus: (id, status) =>
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === id ? { ...t, status } : t,
      ),
    })),
  setHostSkillIds: (id, hostSkillIds) =>
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === id ? { ...t, hostSkillIds } : t,
      ),
    })),
  terminalSelection: "",
  setTerminalSelection: (text) => set({ terminalSelection: text }),
}));
