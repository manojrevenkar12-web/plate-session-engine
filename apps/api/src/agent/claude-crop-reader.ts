import type { CropAnswer, CropQuestion } from "@pse/domain";

/**
 * Asks Claude to compare the exit crop with the candidate entry crops. It returns the model's pick and its
 * confidence; it decides nothing. The engine accepts the pick only if its own evidence makes it plausible.
 */
export class ClaudeCropReader {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async compare(q: CropQuestion): Promise<CropAnswer | null> {
    const exitCrop = q.exit.reads.find((r) => r.cropUrl)?.cropUrl;
    const candidates = q.candidates
      .map((c) => ({ id: c.id, url: c.reads.find((r) => r.cropUrl)?.cropUrl }))
      .filter((c): c is { id: string; url: string } => Boolean(c.url));
    if (!exitCrop || candidates.length === 0) return null;
    const content: unknown[] = [
      { type: "text", text: "Exit camera crop of a vehicle leaving a car park:" },
      { type: "image", source: { type: "url", url: exitCrop } },
    ];
    for (const c of candidates) content.push({ type: "text", text: `Entry candidate ${c.id}:` }, { type: "image", source: { type: "url", url: c.url } });
    content.push({
      type: "text",
      text:
        "Which entry candidate shows the same vehicle as the exit crop? Compare the plate characters first, then the car. " +
        'Answer with JSON only: {"candidate": "<id>" or null, "confidence": <0..1>}. Use null if none is the same vehicle.',
    });
    const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: this.model, max_tokens: 200, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`crop reader: Anthropic API answered ${res.status}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.find((b) => b.type === "text")?.text ?? "";
    return parseCropAnswer(text, new Set(candidates.map((c) => c.id)));
  }
}

/** Reads the model's JSON; anything malformed, or a candidate it was not shown, counts as no answer. */
export function parseCropAnswer(text: string, ids: Set<string>): CropAnswer | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { candidate?: unknown; confidence?: unknown };
    const confidence = typeof j.confidence === "number" && j.confidence >= 0 && j.confidence <= 1 ? j.confidence : null;
    if (confidence === null) return null;
    if (j.candidate === null) return { candidate: null, confidence };
    if (typeof j.candidate === "string" && ids.has(j.candidate)) return { candidate: j.candidate, confidence };
    return null;
  } catch {
    return null;
  }
}
