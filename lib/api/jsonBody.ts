export class JsonBodyError extends Error {
  constructor(message: string, readonly status: 400 | 413 | 415) {
    super(message);
    this.name = 'JsonBodyError';
  }
}

/** Parse JSON without allowing an attacker to buffer an unbounded body. */
export async function readBoundedJson(request: Request, maximumBytes: number): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new JsonBodyError('Expected JSON.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new JsonBodyError('A JSON body is required.', 400);
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw new JsonBodyError('Request is too large.', 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text) as unknown; }
  catch { throw new JsonBodyError('Invalid JSON.', 400); }
}
