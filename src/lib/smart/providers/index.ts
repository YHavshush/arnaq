import type { CategoriserProvider } from "../provider";
import type { SmartProviderId } from "../settings";

/**
 * The providers that exist. `claude` is added when the Claude provider is built (it needs the Anthropic
 * SDK and an API key in ANTHROPIC_API_KEY, server side only). `chatgpt` waits for OpenAI's approval of
 * hosted apps (see docs/progress-log.md). Until then nothing can be switched on and nothing is sent.
 */
export const PROVIDERS: Partial<Record<SmartProviderId, () => CategoriserProvider>> = {};
