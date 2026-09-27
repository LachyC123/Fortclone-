// Rift Rascals LAN server: serves the built game and relays room traffic over WebSockets.
// Zero dependencies (plain Node 18+). Run `npm run lan`, then open the printed address on every
// device on the same Wi-Fi. The first player to create a room hosts the match in their browser;
// this server only forwards messages between them.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const PORT = Number(process.env.PORT) || 8787;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

/* ------------------------------------------------------------------ static files */
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(ROOT, url);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end('Build the game first: npm run build');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

/* ------------------------------------------------------------------ minimal WebSocket */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
let nextId = 1;

class Conn {
  constructor(socket) {
    this.id = nextId++;
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.room = null;
    this.name = 'Rascal';
    this.alive = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.onClose());
    socket.on('error', () => this.onClose());
  }
  send(obj) {
    if (!this.alive) return;
    const data = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
    const len = data.length;
    let head;
    if (len < 126) head = Buffer.from([0x81, len]);
    else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x81;
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x81;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([head, data]));
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(need);
      if (op === 0x8) {
        this.onClose();
        return;
      }
      if (op === 0x9) {
        // ping -> pong
        this.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
        continue;
      }
      if (op === 0x1) {
        let msg;
        try {
          msg = JSON.parse(payload.toString('utf8'));
        } catch {
          continue;
        }
        handle(this, msg, payload);
      }
    }
  }
  onClose() {
    if (!this.alive) return;
    this.alive = false;
    try {
      this.socket.destroy();
    } catch {
      /* already gone */
    }
    leave(this);
  }
}

server.on('upgrade', (req, socket) => {
  if (!(req.url || '').startsWith('/ws')) {
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
  new Conn(socket);
});

/* ------------------------------------------------------------------ rooms */
/** code -> { code, host: Conn, members: Map<id, Conn>, teams: Map<id, number>, teamSize, started } */
const rooms = new Map();

function code4() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let c;
  do c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  while (rooms.has(c));
  return c;
}

function roster(room) {
  return [...room.members.values()].map((c) => ({ id: c.id, name: c.name, team: room.teams.get(c.id) ?? 0, host: c === room.host, tr: c.tr ?? 0 }));
}

function broadcastRoom(room) {
  const msg = { t: 'lobby', code: room.code, teamSize: room.teamSize, members: roster(room), started: room.started };
  for (const c of room.members.values()) c.send({ ...msg, you: c.id });
}

function handle(c, m, raw) {
  const room = c.room;
  switch (m.t) {
    case 'create': {
      const r = { code: code4(), host: c, members: new Map([[c.id, c]]), teams: new Map([[c.id, 0]]), teamSize: 2, started: false };
      rooms.set(r.code, r);
      c.room = r;
      c.name = String(m.name || 'Host').slice(0, 16);
      c.tr = Math.max(0, Math.min(99999, Number(m.tr) || 0));
      broadcastRoom(r);
      console.log(`room ${r.code} created by ${c.name}`);
      return;
    }
    case 'join': {
      const r = rooms.get(String(m.code || '').toUpperCase());
      if (!r) return c.send({ t: 'error', msg: 'No room with that code on this network.' });
      if (r.started) return c.send({ t: 'error', msg: 'That match has already started.' });
      if (r.members.size >= 8) return c.send({ t: 'error', msg: 'Room is full (8 players).' });
      c.room = r;
      c.name = String(m.name || 'Rascal').slice(0, 16);
      c.tr = Math.max(0, Math.min(99999, Number(m.tr) || 0));
      r.members.set(c.id, c);
      // new players join the host's team by default when there's room, else the next free team
      r.teams.set(c.id, pickTeam(r));
      broadcastRoom(r);
      console.log(`${c.name} joined ${r.code}`);
      return;
    }
    case 'team':
      if (!room || room.started) return;
      room.teams.set(c.id, Math.max(0, Math.min(11, Number(m.team) || 0)));
      broadcastRoom(room);
      return;
    case 'name':
      if (!room) return;
      c.name = String(m.name || c.name).slice(0, 16);
      broadcastRoom(room);
      return;
    case 'mode':
      if (!room || c !== room.host || room.started) return;
      room.teamSize = Math.max(1, Math.min(4, Number(m.teamSize) || 1));
      broadcastRoom(room);
      return;
    case 'start':
      if (!room || c !== room.host) return;
      room.started = true;
      for (const x of room.members.values()) x.send({ t: 'start', code: room.code, teamSize: room.teamSize, members: roster(room), you: x.id });
      console.log(`room ${room.code} started (${room.members.size} players, team size ${room.teamSize})`);
      return;
    case 'back':
      // host returns everyone to the room screen after a match
      if (!room || c !== room.host) return;
      room.started = false;
      broadcastRoom(room);
      return;
    default:
      if (!room) return;
      // game traffic: clients -> host (tagged with who sent it); host -> one client or everyone
      if (c === room.host) {
        const txt = raw.toString('utf8');
        if (STATS) STATS[m.t] = (STATS[m.t] ?? 0) + txt.length;
        if (m.to) room.members.get(m.to)?.send(txt);
        else for (const x of room.members.values()) if (x !== c) x.send(txt);
      } else {
        m.from = c.id;
        room.host.send(m);
      }
  }
}

function pickTeam(r) {
  const size = r.teamSize;
  const counts = new Map();
  for (const t of r.teams.values()) counts.set(t, (counts.get(t) ?? 0) + 1);
  const hostTeam = r.teams.get(r.host.id) ?? 0;
  if ((counts.get(hostTeam) ?? 0) < size) return hostTeam;
  for (let t = 0; t < 12; t++) if ((counts.get(t) ?? 0) < size) return t;
  return 0;
}

function leave(c) {
  const r = c.room;
  if (!r) return;
  r.members.delete(c.id);
  r.teams.delete(c.id);
  if (c === r.host) {
    for (const x of r.members.values()) {
      x.send({ t: 'closed', msg: 'The host left the room.' });
      x.room = null;
    }
    rooms.delete(r.code);
    console.log(`room ${r.code} closed`);
    return;
  }
  r.host.send({ t: 'left', id: c.id, name: c.name });
  broadcastRoom(r);
}

/* ------------------------------------------------------------------ go */
// LAN_STATS=1: print how many bytes the host sends per second, by message type
const STATS = process.env.LAN_STATS ? {} : null;
if (STATS)
  setInterval(() => {
    const tot = Object.values(STATS).reduce((a, b) => a + b, 0);
    if (tot) console.log(`  host out: ${(tot / 5 / 1024).toFixed(1)} KB/s ` + Object.entries(STATS).map(([k, v]) => `${k}=${(v / 5 / 1024).toFixed(1)}`).join(' '));
    for (const k of Object.keys(STATS)) delete STATS[k];
  }, 5000);

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  RIFT RASCALS — LAN server running\n');
  for (const ip of ips) console.log(`  → open  http://${ip}:${PORT}  on every phone / computer on this Wi-Fi`);
  console.log(`  → (this computer: http://localhost:${PORT})\n`);
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) console.log('  ! dist/ is missing — run `npm run build` first\n');
  console.log('  Keep this window open while you play. Press Ctrl+C to stop.\n');
  // open the game on this computer straight away (set NO_OPEN=1 to skip)
  if (!process.env.NO_OPEN) {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
