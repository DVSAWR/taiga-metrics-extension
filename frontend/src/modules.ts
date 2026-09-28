import type { ItemType, Module } from "./api";
import type { IconName } from "./icons";

export interface ModuleInfo {
  label: string;
  icon: IconName;
  type: ItemType;
}

export const MODULE_INFO: Record<Module, ModuleInfo> = {
  epics: { label: "Epics", icon: "moduleEpics", type: "epic" },
  userstories: { label: "User stories", icon: "moduleUserStories", type: "userstory" },
  tasks: { label: "Tasks", icon: "moduleTasks", type: "task" },
  issues: { label: "Issues", icon: "moduleIssues", type: "issue" },
};

export const MODULE_OF_TYPE: Record<ItemType, Module> = {
  epic: "epics",
  userstory: "userstories",
  task: "tasks",
  issue: "issues",
};

export const TYPE_LABELS: Record<ItemType, string> = {
  userstory: "User stories",
  task: "Tasks",
  issue: "Issues",
  epic: "Epics",
};
