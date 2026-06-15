import { create } from "zustand";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  convSkillIds?: string[];
}

export interface AgentSession {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
}

const DEFAULT_SESSION: AgentSession = Object.freeze({
  messages: Object.freeze([]) as unknown as ChatMessage[],
  isStreaming: false,
  streamingContent: "",
}) as AgentSession;

interface AgentStore {
  sessions: Record<string, AgentSession>;
  getSession: (terminalId: string) => AgentSession;
  addMessage: (terminalId: string, msg: ChatMessage) => void;
  setStreaming: (terminalId: string, v: boolean) => void;
  appendStreamingContent: (terminalId: string, chunk: string) => void;
  resetStreamingContent: (terminalId: string) => void;
  clearMessages: (terminalId: string) => void;
  removeSession: (terminalId: string) => void;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  sessions: {},
  getSession: (terminalId) => get().sessions[terminalId] ?? DEFAULT_SESSION,
  addMessage: (terminalId, msg) =>
    set((s) => {
      const prev = s.sessions[terminalId] ?? DEFAULT_SESSION;
      return {
        sessions: {
          ...s.sessions,
          [terminalId]: { ...prev, messages: [...prev.messages, msg] },
        },
      };
    }),
  setStreaming: (terminalId, v) =>
    set((s) => {
      const prev = s.sessions[terminalId] ?? DEFAULT_SESSION;
      return {
        sessions: {
          ...s.sessions,
          [terminalId]: {
            ...prev,
            isStreaming: v,
            streamingContent: v ? prev.streamingContent : "",
          },
        },
      };
    }),
  appendStreamingContent: (terminalId, chunk) =>
    set((s) => {
      const prev = s.sessions[terminalId] ?? DEFAULT_SESSION;
      return {
        sessions: {
          ...s.sessions,
          [terminalId]: { ...prev, streamingContent: prev.streamingContent + chunk },
        },
      };
    }),
  resetStreamingContent: (terminalId) =>
    set((s) => {
      const prev = s.sessions[terminalId] ?? DEFAULT_SESSION;
      return {
        sessions: {
          ...s.sessions,
          [terminalId]: { ...prev, streamingContent: "" },
        },
      };
    }),
  clearMessages: (terminalId) =>
    set((s) => {
      const prev = s.sessions[terminalId] ?? DEFAULT_SESSION;
      return {
        sessions: {
          ...s.sessions,
          [terminalId]: { ...prev, messages: [] },
        },
      };
    }),
  removeSession: (terminalId) =>
    set((s) => {
      const { [terminalId]: _removed, ...rest } = s.sessions;
      return { sessions: rest };
    }),
}));
