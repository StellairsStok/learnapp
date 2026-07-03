import fs from "node:fs";
import path from "node:path";
import { makeAnthropicBrain } from "./anthropic";
import { claudeCliBrain } from "./claude-cli";
import { mockBrain } from "./mock";
import type { Brain, ProviderConfig } from "./types";

const CONFIG_PATH = path.resolve(process.cwd(), "server", "config.json");

export function getConfig(): ProviderConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return { provider: "mock", model: "claude-opus-4-8", maxTokens: 2048 };
  }
}

export function getBrain(): { brain: Brain; config: ProviderConfig } {
  const config = getConfig();
  switch (config.provider) {
    case "anthropic":
      return { brain: makeAnthropicBrain(config), config };
    case "claude-cli":
      return { brain: claudeCliBrain, config };
    default:
      return { brain: mockBrain, config };
  }
}
