const MAX_BYTES = 50 * 1024 * 1024; // 50MB ceiling — plenty for a fast connection, prevents abuse
const DEFAULT_BYTES = 4 * 1024 * 1024; // 4MB default chunk

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requested = Number(url.searchParams.get('bytes') ?? DEFAULT_BYTES);
  const bytes = Math.min(Math.max(Number.isFinite(requested) ? requested : DEFAULT_BYTES, 0), MAX_BYTES);

  const chunk = new Uint8Array(64 * 1024); // 64KB chunks
  crypto.getRandomValues(chunk); // avoid gzip/compression shrinking the payload in transit

  const stream = new ReadableStream({
    start(controller) {
      let sent = 0;
      while (sent < bytes) {
        const remaining = bytes - sent;
        controller.enqueue(remaining >= chunk.length ? chunk : chunk.slice(0, remaining));
        sent += chunk.length;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes),
      'cache-control': 'no-store',
    },
  });
}
