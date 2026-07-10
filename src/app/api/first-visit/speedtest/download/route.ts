const MiB = 1024 * 1024;
// Hard ceiling per request. This route is exempt from auth middleware (see middleware.ts),
// so an unauthenticated caller could request bytes — the cap bounds each response, and the
// stream below never allocates more than 64KB at a time regardless of the requested size.
// 100 MiB matches LibreSpeed's default garbagePhp_chunkSize of 100.
const MAX_BYTES = 100 * MiB;
const MIN_BYTES = 1 * MiB;
const DEFAULT_BYTES = 4 * MiB; // fallback when neither param is given

export async function GET(req: Request) {
  const url = new URL(req.url);

  // LibreSpeed's worker requests `ckSize=N` where N is the payload size in MEBIBYTES
  // (garbage.php semantics: N chunks of 1 MiB — see public/vendor/librespeed/
  // speedtest_worker.js, dlTest xhr.open). `bytes` (raw byte count) is kept as a
  // fallback for manual testing.
  const ckSizeRaw = url.searchParams.get('ckSize');
  let bytes: number;
  if (ckSizeRaw !== null) {
    const ckSize = Number(ckSizeRaw);
    bytes = (Number.isFinite(ckSize) ? Math.floor(ckSize) : 0) * MiB;
    bytes = Math.min(Math.max(bytes, MIN_BYTES), MAX_BYTES);
  } else {
    const requested = Number(url.searchParams.get('bytes') ?? DEFAULT_BYTES);
    bytes = Math.min(Math.max(Number.isFinite(requested) ? requested : DEFAULT_BYTES, 0), MAX_BYTES);
  }

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
