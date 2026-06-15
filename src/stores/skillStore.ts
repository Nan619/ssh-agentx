import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  tags: string;
  enabled: number;
}

export interface SkillFull extends SkillSummary {
  content: string;
}

export interface SkillInput {
  name: string;
  description: string;
  tags: string;
  content: string;
}

interface SkillStore {
  skills: SkillSummary[];
  loaded: boolean;
  loadSkills: () => Promise<void>;
  getSkill: (id: string) => Promise<SkillFull>;
  createSkill: (input: SkillInput) => Promise<SkillSummary>;
  updateSkill: (id: string, input: SkillInput, enabled: number) => Promise<SkillSummary>;
  deleteSkill: (id: string) => Promise<void>;
}

export const useSkillStore = create<SkillStore>((set, get) => ({
  skills: [],
  loaded: false,

  loadSkills: async () => {
    if (get().loaded) return;
    try {
      const skills = await invoke<SkillSummary[]>("list_skills");
      set({ skills, loaded: true });
    } catch (e) {
      console.error("Failed to load skills:", e);
    }
  },

  getSkill: async (id: string): Promise<SkillFull> => {
    return invoke<SkillFull>("get_skill", { id });
  },

  createSkill: async (input: SkillInput): Promise<SkillSummary> => {
    const created = await invoke<SkillSummary>("create_skill", { skill: input });
    set((s) => ({ skills: [...s.skills, created] }));
    return created;
  },

  updateSkill: async (id: string, input: SkillInput, enabled: number): Promise<SkillSummary> => {
    const updated = await invoke<SkillSummary>("update_skill", { id, skill: input, enabled });
    set((s) => ({
      skills: s.skills.map((k) => (k.id === id ? updated : k)),
    }));
    return updated;
  },

  deleteSkill: async (id: string): Promise<void> => {
    await invoke("delete_skill", { id });
    set((s) => ({ skills: s.skills.filter((k) => k.id !== id) }));
  },
}));
