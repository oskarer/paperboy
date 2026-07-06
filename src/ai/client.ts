import OpenAI from "openai";

// Bun auto-loads .env, so OPENAI_API_KEY is picked up from the repo root.
export const openai = new OpenAI({ maxRetries: 2 });
