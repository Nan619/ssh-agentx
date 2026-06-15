import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface SshGroup {
  id: string;
  name: string;
}

export interface SshHost {
  id: string;
  name: string;
  group_name: string | null;
  hostname: string;
  port: number;
  username: string;
  authMethod: "password" | "key" | "agent";
  password?: string;
  keyId?: string;
  skillIds?: string;
  keepaliveInterval: number;
  connectionTimeout: number;
}

interface HostStore {
  hosts: SshHost[];
  groups: SshGroup[];
  loaded: boolean;
  loadHosts: () => Promise<void>;
  addHost: (host: SshHost) => Promise<void>;
  removeHost: (id: string) => Promise<void>;
  updateHost: (host: SshHost) => Promise<void>;
  addGroup: (name: string) => Promise<void>;
  removeGroup: (id: string) => Promise<void>;
  updateGroup: (id: string, name: string) => Promise<void>;
}

function fromDb(db: any): SshHost {
  return {
    id: db.id,
    name: db.name,
    group_name: db.group_name ?? null,
    hostname: db.hostname,
    port: db.port,
    username: db.username,
    authMethod: db.auth_method as SshHost["authMethod"],
    password: db.password ?? undefined,
    keyId: db.key_id ?? undefined,
    skillIds: db.skill_ids ?? "",
    keepaliveInterval: db.keepalive_interval,
    connectionTimeout: db.connection_timeout,
  };
}

function toDb(host: SshHost): any {
  return {
    id: host.id,
    name: host.name,
    group_name: host.group_name ?? null,
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    auth_method: host.authMethod,
    password: host.password ?? null,
    key_id: host.keyId ?? null,
    skill_ids: host.skillIds ?? "",
    keepalive_interval: host.keepaliveInterval,
    connection_timeout: host.connectionTimeout,
  };
}

export const useHostStore = create<HostStore>((set, get) => ({
  hosts: [],
  groups: [],
  loaded: false,

  loadHosts: async () => {
    if (get().loaded) return;
    try {
      const [hosts, groups] = await Promise.all([
        invoke<any[]>("list_hosts"),
        invoke<any[]>("list_groups"),
      ]);
      set({ hosts: hosts.map(fromDb), groups, loaded: true });
    } catch (e) {
      console.error("Failed to load hosts:", e);
    }
  },

  addHost: async (host) => {
    try {
      const created = await invoke<any>("create_host", { host: toDb(host) });
      set((s) => ({ hosts: [...s.hosts, fromDb(created)] }));
    } catch (e) {
      console.error("Failed to create host:", e);
    }
  },

  removeHost: async (id) => {
    try {
      await invoke("delete_host", { id });
      set((s) => ({ hosts: s.hosts.filter((h) => h.id !== id) }));
    } catch (e) {
      console.error("Failed to delete host:", e);
    }
  },

  updateHost: async (host) => {
    try {
      const updated = await invoke<any>("update_host", { host: toDb(host) });
      set((s) => ({
        hosts: s.hosts.map((h) => (h.id === host.id ? fromDb(updated) : h)),
      }));
    } catch (e) {
      console.error("Failed to update host:", e);
      throw e;
    }
  },

  addGroup: async (name) => {
    try {
      const created = await invoke<any>("create_group", { group: { id: "", name } });
      set((s) => ({ groups: [...s.groups, created] }));
    } catch (e) {
      console.error("Failed to create group:", e);
    }
  },

  removeGroup: async (id) => {
    try {
      await invoke("delete_group", { id });
      set((s) => {
        const old = s.groups.find((g) => g.id === id);
        return {
          groups: s.groups.filter((g) => g.id !== id),
          hosts: s.hosts.map((h) =>
            h.group_name === old?.name ? { ...h, group_name: null } : h,
          ),
        };
      });
    } catch (e) {
      console.error("Failed to delete group:", e);
    }
  },

  updateGroup: async (id, name) => {
    try {
      const updated = await invoke<SshGroup>("update_group", {
        group: { id, name },
      });
      set((s) => {
        const old = s.groups.find((g) => g.id === id);
        return {
          groups: s.groups.map((g) => (g.id === id ? updated : g)),
          hosts: s.hosts.map((h) =>
            h.group_name === old?.name ? { ...h, group_name: updated.name } : h,
          ),
        };
      });
    } catch (e) {
      console.error("Failed to update group:", e);
    }
  },
}));
