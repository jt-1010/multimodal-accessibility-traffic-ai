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
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
