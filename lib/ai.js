import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

// The key is read from the environment (.env locally, a secret in production).
// It is never sent to the browser.
const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

export const aiEnabled = () => Boolean(client);
export const aiModel = () => MODEL;

/**
 * Ask Claude for JSON matching a zod schema. Returns the parsed object, or
 * null on any failure so callers can fall back to keyword logic.
 */
export async function askJSON({ system, prompt, schema, effort = 'low', maxTokens = 16000 }) {
  if (!client) return null;
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      output_config: { format: zodOutputFormat(schema), effort },
      messages: [{ role: 'user', content: prompt }],
    });
    if (response.stop_reason === 'refusal') {
      console.warn('[ai] request declined:', response.stop_details?.category);
      return null;
    }
    return response.parsed_output ?? null;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) console.error('[ai] ANTHROPIC_API_KEY was rejected.');
    else if (error instanceof Anthropic.RateLimitError) console.error('[ai] rate limited; using keyword fallback.');
    else if (error instanceof Anthropic.APIError) console.error(`[ai] API error ${error.status}:`, error.message);
    else console.error('[ai] failed:', error.message);
    return null;
  }
}
