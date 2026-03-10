export type EntryType =
  | "API Key"
  | "OAuth"
  | "Env Variable"
  | "Token"
  | "JSON Credential"
  | "SSH Related"
  | "Other";

export type VaultEntry = {
  id: string;
  name: string;
  key: string;
  type: EntryType;
  value: string;
  description?: string;
  project?: string;
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
  icon?: string;
  updatedAt: string;
};

export type VaultFile = {
  id: string;
  name: string;
  originalName: string;
  project?: string;
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
