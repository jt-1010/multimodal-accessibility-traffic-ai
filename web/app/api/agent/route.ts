import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import { activeBackend, getModel } from '@/lib/agent/model';
import { SYSTEM_PROMPT } from '@/lib/agent/prompt';
import { buildTools } from '@/lib/agent/tools';

export const maxDuration = 30;

/**
 * Turn a provider failure into something the person reading the screen can act on.
 *
 * The AI SDK defaults to "An error occurred." on purpose -- provider errors can
 * leak keys and internals, so it refuses to forward them. That default is right
 * for production and useless in development, where the answer is almost always
 * one of two boring configuration problems.
 *
 * So: match the boring cases explicitly and say exactly what to do about them,
 * and fall through to the safe generic message for anything unrecognised. The
 * real error always goes to the server log regardless.
 */
function explainError(error: unknown, backend: string): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[agent] backend=${backend} FAILED:`, error);

  const text = raw.toLowerCase();

  if (backend === 'ollama') {
    if (text.includes('econnrefused') || text.includes('fetch failed')) {
      return `Ollama is not reachable at ${process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434/v1'}. Start it with "ollama serve", then pull the model with "ollama pull ${process.env.OLLAMA_MODEL ?? 'qwen2.5:3b-instruct'}".`;
    }
    if (text.includes('not found') || text.includes('404')) {
      return `Ollama is running but does not have the model "${process.env.OLLAMA_MODEL ?? 'qwen2.5:3b-instruct'}". Pull it with "ollama pull ${process.env.OLLAMA_MODEL ?? 'qwen2.5:3b-instruct'}".`;
    }
  }

  if (
    text.includes('api key') ||
    text.includes('unauthorized') ||
    text.includes('401') ||
    text.includes('403') ||
    text.includes('authentication')
  ) {
    return 'No LLM credential is configured. Either set AI_GATEWAY_API_KEY in web/.env.local, or install Ollama and set LLM_BACKEND=ollama to run a model locally. See docs/development.md.';
  }

  if (text.includes('rate limit') || text.includes('429')) {
    return 'The model provider is rate limiting us. Wait a moment and try again.';
  }

  return `The assistant could not respond (${backend} backend). Check the server log for details.`;
}

export async function POST(req: Request) {
  const started = performance.now();
  const { messages, sessionId } = (await req.json()) as {
    messages: UIMessage[];
    sessionId?: string;
  };

  if (!sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const backend = activeBackend();

  const result = streamText({
    model: getModel(backend),
    instructions: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: buildTools(sessionId),
    // Ordering routinely needs search -> add -> read-back in one turn.
    stopWhen: isStepCount(8),
    onFinish({ usage }) {
      // Part of the end-to-end latency budget from the spec. Logged from M0
      // onward so a regression shows up the day it lands, not at demo time.
      console.log(
        `[agent] backend=${backend} ${Math.round(performance.now() - started)}ms ` +
          `in=${usage?.inputTokens ?? '?'} out=${usage?.outputTokens ?? '?'}`,
      );
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: (error) => explainError(error, backend),
    }),
  });
}
