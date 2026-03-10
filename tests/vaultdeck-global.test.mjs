import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const cli = path.join(process.cwd(), "bin", "vaultdeck");

function run(args, env) {
  return execFileSync(cli, args, { env: { ...process.env, ...env }, encoding: "utf8" });
}

test("global enable + regen writes environment.d file with quoted values", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vaultdeck-test-"));
  const home = path.join(root, "home");
  const vault = path.join(home, ".vaultdeck");
  fs.mkdirSync(path.join(vault, "entries"), { recursive: true });

  const entry = {
    id: "1",
    name: "OpenAI",
    key: "OPENAI_API_KEY",
    value: 'sk-test value',
    includeInEnv: true,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(vault, "entries", "1.json"), JSON.stringify(entry));

  const env = { HOME: home, VAULTDECK_HOME: vault };
  run(["global", "enable"], env);

  const globalFile = path.join(home, ".config", "environment.d", "90-vaultdeck.conf");
  const content = fs.readFileSync(globalFile, "utf8");
  assert.match(content, /OPENAI_API_KEY="sk-test value"/);
});

test("global disable removes global file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vaultdeck-test-"));
  const home = path.join(root, "home");
  const vault = path.join(home, ".vaultdeck");
  fs.mkdirSync(path.join(vault, "entries"), { recursive: true });

  fs.writeFileSync(
    path.join(vault, "entries", "1.json"),
    JSON.stringify({ id: "1", name: "A", key: "A", value: "1", includeInEnv: true, updatedAt: new Date().toISOString() })
  );

  const env = { HOME: home, VAULTDECK_HOME: vault };
  run(["global", "enable"], env);
  run(["global", "disable"], env);

  const globalFile = path.join(home, ".config", "environment.d", "90-vaultdeck.conf");
  assert.equal(fs.existsSync(globalFile), false);
});
