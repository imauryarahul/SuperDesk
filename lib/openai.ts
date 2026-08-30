import 'server-only'

import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from 'openai'

import { openaiApiKey } from './env'

export const GPT_MINI_MODEL = 'gpt-5.4-mini'
/** A few seconds. Retries are disabled so this is a hard ceiling, not 3×. */
export const AI_TIMEOUT_MS = 8_000

export class AiTimeoutError extends Error {
  constructor() {
    super('AI request timed out')
    this.name = 'AiTimeoutError'
  }
}

export class AiCallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiCallError'
  }
}

function unwrap(text: string): string {
  const fenced = /^```(?:\w+)?\n([\s\S]*?)\n```$/.exec(text)
  return (fenced?.[1] ?? text).trim()
}

/**
 * gpt-5.4-mini via the Responses API. Reasoning is explicitly off — these
 * tasks are extraction and drafting, not multi-step thinking, and the inbox
 * cannot wait on a reasoning pass.
 */
export async function completeText(input: {
  system: string
  user: string
  maxTokens: number
}): Promise<string> {
  let client: OpenAI
  try {
    client = new OpenAI({
      apiKey: openaiApiKey(),
      timeout: AI_TIMEOUT_MS,
      maxRetries: 0,
    })
  } catch (err) {
    throw new AiCallError(err instanceof Error ? err.message : 'AI is not configured')
  }

  try {
    const response = await client.responses.create({
      model: GPT_MINI_MODEL,
      instructions: input.system,
      input: input.user,
      max_output_tokens: input.maxTokens,
      reasoning: { effort: 'none' },
    })
    const cleaned = unwrap(response.output_text)
    if (!cleaned) throw new AiCallError('Empty model response')
    return cleaned
  } catch (err) {
    if (err instanceof AiCallError) throw err
    if (err instanceof APIConnectionTimeoutError || err instanceof APIUserAbortError) {
      throw new AiTimeoutError()
    }
    throw new AiCallError(err instanceof Error ? err.message : 'AI call failed')
  }
}
