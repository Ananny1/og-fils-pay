import { API_BASE_URL, request } from "./client.js";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "error"; message: string }
  | { type: "done" };

/**
 * `POST /v1/assistant/chat`, read as a Server-Sent Events stream. Calls
 * `onEvent` for each event in order and resolves when the stream ends.
 * The Claude key lives on the API, never here.
 */
export async function streamAssistant(
  messages: ChatTurn[],
  onEvent: (event: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/v1/assistant/chat`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
    onEvent({ type: "error", message: body?.message ?? body?.error ?? `Request failed (${res.status})` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      let parsed: Record<string, unknown> = {};
      try {
        parsed = data ? (JSON.parse(data) as Record<string, unknown>) : {};
      } catch {
        continue;
      }
      if (event === "text" && typeof parsed.text === "string") onEvent({ type: "text", text: parsed.text });
      else if (event === "tool" && typeof parsed.name === "string") onEvent({ type: "tool", name: parsed.name });
      else if (event === "error") onEvent({ type: "error", message: String(parsed.message ?? "Something went wrong.") });
      else if (event === "done") onEvent({ type: "done" });
    }
  }
}

export interface PayoutExplanationResponse {
  explanation: string;
  cached: boolean;
}

/** `GET /v1/assistant/batches/:id/explanation` — Claude's plain-words
 *  summary of one settlement batch. */
export function getPayoutExplanation(batchId: string): Promise<PayoutExplanationResponse> {
  return request(`/v1/assistant/batches/${encodeURIComponent(batchId)}/explanation`);
}
