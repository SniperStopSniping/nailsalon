/** The stream, not Content-Length, is the authoritative request size. */
export class RequestBodyTooLarge extends Error {}

export async function readBoundedJsonBody(request: Request, maximumBytes: number): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLarge();
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return null;
    }
  } catch (error) {
    if (error instanceof RequestBodyTooLarge) {
      throw error;
    }
    return null;
  } finally {
    reader.releaseLock();
  }
}
