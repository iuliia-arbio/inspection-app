export async function POST(req: Request) {
  const buf = await req.arrayBuffer();
  return Response.json({ bytesReceived: buf.byteLength }, { headers: { 'cache-control': 'no-store' } });
}
