export type EntryType =
  | "API Key"
  | "OAuth"
  | "Env Variable"
  | "Token"
  | "JSON Credential"
  | "SSH Related"
  | "Other";

export type SecretValueType = "string" | "json" | "token" | "file_reference";

export type ProjectStatus = "active" | "disabled" | "system";

export type ShellType = "bash" | "zsh" | "fish";

export type VaultEntry = {
  id: string;
  name: string;
  key: string;
  type: EntryType;
  secretType?: SecretValueType;
  value: string;
  description?: string;
  project?: string;
  projectId?: string;
  tags: string[];
  favorite: boolean;
  includeInEnv: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VaultProject = {
  id: string;
  name: string;
  description?: string;
  color: string;
  status: ProjectStatus;
  defaultShell: ShellType;
  folderPath: string;
  createdAt: string;
  updatedAt: string;
  lastInjectedAt?: string;
};

export type VaultFile = {
  id: string;
  name: string;
  originalName: string;
  project?: string;
  projectId?: string;
  tags: string[];
  size: number;
  mimeType: string;
  path: string;
  updatedAt: string;
};

export const VAULT_TYPES: EntryType[] = [
  "API Key",
  "OAuth",
  "Env Variable",
  "Token",
  "JSON Credential",
  "SSH Related",
  "Other",
];

export const SECRET_VALUE_TYPES: SecretValueType[] = ["string", "json", "token", "file_reference"];

export const PROJECT_STATUSES: ProjectStatus[] = ["active", "disabled", "system"];

export const SHELL_TYPES: ShellType[] = ["bash", "zsh", "fish"];
