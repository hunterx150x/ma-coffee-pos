// Server-Sent Events: push "something changed" signals to every open screen.
// Single server instance, so an in-memory client list is enough.
const clients = new Set();
const HEARTBEAT_MS = 25000; // keeps proxies (Render) from closing idle connections

export function subscribe(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write('event: hello\ndata: {}\n\n');
  const client = { res };
  clients.add(client);
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(beat);
    clients.delete(client);
  });
}

export function broadcast(type, data = {}) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.res.write(msg);
}

export const clientCount = () => clients.size;
