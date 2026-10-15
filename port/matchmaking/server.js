#!/usr/bin/env node
/**
 * Self-Hosted WebRTC Signaling, Matchmaking & Platform API Server (Dragon Net Battle)
 * 
 * Supports 200+ concurrent players on Dell OptiPlex 3080:
 * - Room signaling relay for WebRTC (SDP offers, answers, ICE candidates) & UDP binary relay.
 * - Quick Match matchmaking queue (/net/queue).
 * - Real-time Community & Room Chat with Challenge Dispatcher (/net/chat).
 * - High-speed Binary Batch Asset Streamer (/game-assets/:rev/batch, /batch).
 * - Persistence layer with Auth, Player Profiles, Friends List, and Verified Match Leaderboard.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { WebSocketServer, WebSocket } = require('ws');
const { Database } = require('./db.js');
const { handleBatchStreaming } = require('./batch_streamer.js');

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude I and O to prevent ambiguity
const ROLES = ['host', 'join', 'p3', 'p4'];
const MAX_LOG_ENTRIES = 3000;
const MAX_ROOMS = 500;
const MAX_QUEUE = 200;
const MAX_PAYLOAD = 64 * 1024; // 64 KB max payload

class MatchmakingServer {
  constructor(options = {}) {
    this.port = options.port !== undefined ? options.port : (process.env.PORT || 3000);
    this.host = options.host || process.env.HOST || '0.0.0.0';
    this.db = options.db || new Database(options.dbPath);
    this.publicDir = options.publicDir || process.env.PUBLIC_DIR || path.resolve(__dirname, '../../port/build/web');

    // In-memory state
    this.rooms = new Map(); // roomCode -> Room
    this.queue = [];        // [{ ws, name, cid, t }]
    this.logs = [];         // [{ t, room, line }]
    this.chatClients = new Set(); // Set<WebSocket> for /net/chat
    this.presenceMap = new Map(); // userId -> { status: 'online'|'lobby'|'combat', room, tagname }

    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
    this.server = http.createServer(this.handleHttp.bind(this));
    this.server.on('upgrade', this.handleUpgrade.bind(this));

    // Periodic cleanup of stale rooms (older than 10 minutes)
    this.cleanupInterval = setInterval(() => this.cleanupStaleRooms(), 60000);
  }

  generateRoomCode() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  readJsonBody(req, maxLen = 65536) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > maxLen) {
          req.destroy();
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range'
    });
    res.end(JSON.stringify(data));
  }

  async handleHttp(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check & root status
    if (pathname === '/health') {
      return this.sendJson(res, 200, {
        status: 'ok',
        uptime: process.uptime(),
        rooms: this.rooms.size,
        queue: this.queue.length,
        chatUsers: this.chatClients.size,
        timestamp: new Date().toISOString()
      });
    }

    // High performance Batch Streaming Endpoint (/game-assets/:rev/batch, /batch)
    if (pathname.endsWith('/batch') || pathname === '/batch') {
      if (req.method === 'POST') {
        try {
          const body = await this.readJsonBody(req, 1024 * 1024);
          return handleBatchStreaming(req, res, body.paths || []);
        } catch (e) {
          return this.sendJson(res, 400, { error: e.message });
        }
      }
    }

    // Telemetry log buffer (/net/stat, /net/log)
    if (pathname === '/net/stat' || pathname === '/net/log') {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
          if (body.length > 100000) req.destroy();
        });
        req.on('end', () => {
          let room = '';
          try {
            const parsed = JSON.parse(body);
            room = String(parsed.room || '').slice(0, 8);
          } catch (e) { }
          this.logs.push({ t: Date.now(), room, line: body.slice(0, 2000) });
          if (this.logs.length > MAX_LOG_ENTRIES) {
            this.logs.shift();
          }
          res.writeHead(204);
          res.end();
        });
        return;
      }

      if (req.method === 'GET') {
        const filterRoom = parsedUrl.searchParams.get('room');
        const filtered = filterRoom
          ? this.logs.filter(l => l.room === filterRoom)
          : this.logs;
        const text = filtered
          .map(l => `${new Date(l.t).toISOString()} ${l.line}`)
          .join('\n') + '\n';
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(text);
        return;
      }
    }

    // -------------------------------------------------------------------------
    // Platform API Routes (/api/...)
    // -------------------------------------------------------------------------
    if (pathname.startsWith('/api/')) {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const user = token ? this.db.getUserByToken(token) : null;

      // Auth: Register
      if (pathname === '/api/auth/register' && req.method === 'POST') {
        try {
          const body = await this.readJsonBody(req);
          const result = this.db.register(body.tagname, body.displayName, body.country, body.password);
          return this.sendJson(res, 200, { success: true, ...result });
        } catch (e) {
          return this.sendJson(res, 400, { success: false, error: e.message });
        }
      }

      // Auth: Login
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        try {
          const body = await this.readJsonBody(req);
          const result = this.db.login(body.tagname, body.password);
          return this.sendJson(res, 200, { success: true, ...result });
        } catch (e) {
          return this.sendJson(res, 400, { success: false, error: e.message });
        }
      }

      // Auth: Guest / Quick Login
      if (pathname === '/api/auth/guest' && req.method === 'POST') {
        try {
          const body = await this.readJsonBody(req);
          const result = this.db.guestLogin(body.displayName, body.country);
          return this.sendJson(res, 200, { success: true, ...result });
        } catch (e) {
          return this.sendJson(res, 400, { success: false, error: e.message });
        }
      }

      // Profile
      if (pathname === '/api/profile' && req.method === 'GET') {
        if (!user) return this.sendJson(res, 401, { error: 'Não autorizado' });
        return this.sendJson(res, 200, { success: true, user });
      }

      // Friends List
      if (pathname === '/api/friends' && req.method === 'GET') {
        if (!user) return this.sendJson(res, 401, { error: 'Não autorizado' });
        const friends = this.db.getFriends(user.id, this.presenceMap);
        return this.sendJson(res, 200, { success: true, friends });
      }

      // Send Friend Request
      if (pathname === '/api/friends/request' && req.method === 'POST') {
        if (!user) return this.sendJson(res, 401, { error: 'Não autorizado' });
        try {
          const body = await this.readJsonBody(req);
          const resReq = this.db.sendFriendRequest(user.id, body.targetTagname);
          return this.sendJson(res, 200, { success: true, ...resReq });
        } catch (e) {
          return this.sendJson(res, 400, { success: false, error: e.message });
        }
      }

      // Leaderboard
      if (pathname === '/api/leaderboard' && req.method === 'GET') {
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
        const timeframe = parsedUrl.searchParams.get('timeframe') || 'all';
        const leaderboard = this.db.getLeaderboard(limit, timeframe);
        return this.sendJson(res, 200, { success: true, leaderboard });
      }

      // Real-time stats: active matches (2+ peers connected), visitors, registered users
      if (pathname === '/api/stats' && req.method === 'GET') {
        let activeMatches = 0;
        for (const r of this.rooms.values()) {
          const connected = Object.values(r.slots || {}).filter(s => s && s.readyState === WebSocket.OPEN).length;
          if (connected >= 2) activeMatches++;
        }
        return this.sendJson(res, 200, {
          success: true,
          activeMatches,
          onlinePlayers: this.chatClients.size,
          registeredUsers: Object.keys((this.db.state && this.db.state.users) || {}).length
        });
      }

      // Online Lobby Status Overview
      if (pathname === '/api/online' && req.method === 'GET') {
        const activeRooms = [];
        for (const [code, r] of this.rooms) {
          const connected = Object.entries(r.slots || {}).filter(([_, s]) => s && s.readyState === WebSocket.OPEN);
          activeRooms.push({
            code,
            host: r.hostInfo ? r.hostInfo.name : 'Unknown',
            hasJoin: !!r.join,
            playersCount: connected.length,
            maxPlayers: r.maxPlayers || 2,
            mode: r.battleMode || 'single',
            lastActive: r.lastActive
          });
        }
        return this.sendJson(res, 200, {
          success: true,
          totalOnline: this.presenceMap.size + this.chatClients.size,
          roomsCount: this.rooms.size,
          queueCount: this.queue.length,
          activeRooms: activeRooms.slice(0, 20)
        });
      }
    }

    // Static files serving fallback (index.html, runtime.html, assets)
    if (this.publicDir && fs.existsSync(this.publicDir)) {
      let rel = path.normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\/|\\)+/, '');
      let fullPath = path.join(this.publicDir, rel);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const ext = path.extname(fullPath).toLowerCase();
        const types = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.wasm': 'application/wasm',
          '.json': 'application/json',
          '.png': 'image/png',
          '.webmanifest': 'application/manifest+json'
        };
        const st = fs.statSync(fullPath);
        const lastMod = st.mtime.toUTCString();
        // Portal files are not content-hashed: revalidate instead of immutable caching
        const mutable = ext === '.html' || ext === '.js' || ext === '.css' || ext === '.json' || ext === '.webmanifest';
        const headers = {
          'Content-Type': types[ext] || 'application/octet-stream',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'credentialless',
          'Access-Control-Allow-Origin': '*',
          'Last-Modified': lastMod,
          'Cache-Control': mutable ? 'no-cache' : 'public, max-age=31536000, immutable'
        };
        if (mutable && req.headers['if-modified-since'] &&
            new Date(req.headers['if-modified-since']).getTime() >= Math.floor(st.mtimeMs / 1000) * 1000) {
          res.writeHead(304, headers);
          res.end();
          return;
        }
        res.writeHead(200, headers);
        fs.createReadStream(fullPath).pipe(res);
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  handleUpgrade(req, socket, head) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/net/ws' || pathname === '/net/queue' || pathname === '/net/chat') {
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        if (pathname === '/net/ws') {
          this.handleRoomConnection(ws, parsedUrl);
        } else if (pathname === '/net/queue') {
          this.handleQueueConnection(ws, parsedUrl);
        } else if (pathname === '/net/chat') {
          this.handleChatConnection(ws, parsedUrl);
        }
      });
    } else {
      socket.destroy();
    }
  }

  // ---------------------------------------------------------------------------
  // Room Management (/net/ws) - Supports 1v1 and 2v2 Tag Team (up to 4 players)
  // ---------------------------------------------------------------------------
  handleRoomConnection(ws, url) {
    const rawRoom = url.searchParams.get('room') || '';
    const roomCode = rawRoom.toUpperCase().trim();
    let role = url.searchParams.get('role'); // 'host' | 'join' | 'p3' | 'p4'
    const phase = url.searchParams.get('phase') === 'session' ? 'session' : 'lobby';
    const name = (url.searchParams.get('name') || 'Player').slice(0, 16);
    const cid = (url.searchParams.get('cid') || '').slice(0, 40);
    const userId = (url.searchParams.get('uid') || cid).slice(0, 40);

    if (!ROLES.includes(role) || !/^[A-Z]{4}$/.test(roomCode)) {
      ws.close(4000, 'Bad role or room code');
      return;
    }

    let room = this.rooms.get(roomCode);
    if (!room) {
      if (role !== 'host' && phase === 'lobby') {
        try { ws.send(JSON.stringify({ t: 'nohost' })); } catch (e) { }
        ws.close(4002, 'no host');
        return;
      }
      if (this.rooms.size >= MAX_ROOMS) {
        ws.close(4004, 'Server capacity reached');
        return;
      }
      const mode = url.searchParams.get('mode') || '';
      const slots = parseInt(url.searchParams.get('slots') || '0', 10);
      const isTag = mode === 'tag' || mode === '2v2' || slots === 4;

      room = {
        code: roomCode,
        maxPlayers: isTag ? 4 : 2,
        battleMode: isTag ? 'tag' : (mode || 'single'),
        rules: url.searchParams.get('rules') || '768',
        slots: { host: null, join: null, p3: null, p4: null },
        slotInfo: { host: null, join: null, p3: null, p4: null },
        lastActive: Date.now(),
        results: {} // cid -> { winnerSide, t }
      };

      // Backward compatibility getters and setters for host/join/p3/p4
      for (const r of ['host', 'join', 'p3', 'p4']) {
        Object.defineProperty(room, r, {
          get() { return this.slots[r]; },
          set(v) { this.slots[r] = v; },
          configurable: true,
          enumerable: true
        });
        Object.defineProperty(room, `${r}Info`, {
          get() { return this.slotInfo[r]; },
          set(v) { this.slotInfo[r] = v; },
          configurable: true,
          enumerable: true
        });
      }
      this.rooms.set(roomCode, room);
    }

    room.lastActive = Date.now();

    // In a 4-player Tag Team room, auto-assign joining players to available slots (join -> p3 -> p4)
    if (role === 'join' && room.maxPlayers === 4) {
      const jWs = room.slots.join;
      const jInfo = room.slotInfo.join;
      if (jWs && jWs.readyState === WebSocket.OPEN && (!jInfo || jInfo.cid !== cid)) {
        if (!room.slots.p3 || room.slots.p3.readyState !== WebSocket.OPEN || (room.slotInfo.p3 && room.slotInfo.p3.cid === cid)) {
          role = 'p3';
        } else if (!room.slots.p4 || room.slots.p4.readyState !== WebSocket.OPEN || (room.slotInfo.p4 && room.slotInfo.p4.cid === cid)) {
          role = 'p4';
        }
      }
    }

    const existingWs = room.slots[role];
    const existingInfo = room.slotInfo[role];

    // Check if slot is already occupied
    if (existingWs && existingWs.readyState === WebSocket.OPEN) {
      if (existingInfo && existingInfo.cid === cid && cid) {
        // Reconnection with same client id
        try { existingWs.close(4000, 'replaced'); } catch (e) { }
      } else {
        const reason = role === 'host' ? 'taken' : 'full';
        try { ws.send(JSON.stringify({ t: reason })); } catch (e) { }
        ws.close(4001, reason);
        return;
      }
    }

    // Attach client to room slot
    room.slots[role] = ws;
    room.slotInfo[role] = { role, phase, name, cid, userId };
    ws.meta = { roomCode, role, phase, name, cid, userId };

    // Explicitly notify joining peers of their assigned slot in multi-player rooms (join, p3, p4)
    if (role !== 'host' && room.maxPlayers === 4) {
      try {
        ws.send(JSON.stringify({
          t: 'assigned_role',
          role,
          room: roomCode,
          maxPlayers: room.maxPlayers,
          mode: room.battleMode
        }));
      } catch (e) { }
    }

    // Update player presence status
    this.presenceMap.set(userId, {
      status: phase === 'session' ? 'combat' : 'lobby',
      room: roomCode,
      tagname: name
    });
    this.broadcastPresence();

    if (role !== 'host' && phase === 'lobby' && (!room.slots.host || room.slots.host.readyState !== WebSocket.OPEN)) {
      try { ws.send(JSON.stringify({ t: 'nohost' })); } catch (e) { }
      ws.close(4002, 'no host');
      room.slots[role] = null;
      room.slotInfo[role] = null;
      return;
    }

    // In multi-player session phase: broadcast 'session_ready' when all expected players have joined the session
    if (phase === 'session') {
      const sessionPeers = Object.entries(room.slots).filter(
        ([r, s]) => s && s.readyState === WebSocket.OPEN && room.slotInfo[r] && room.slotInfo[r].phase === 'session'
      );
      const expectedCount = room.humanPlayers || (room.maxPlayers === 4 ? 4 : 2);
      if (sessionPeers.length >= expectedCount) {
        for (const [sRole, sWs] of sessionPeers) {
          try {
            sWs.send(JSON.stringify({
              t: 'session_ready',
              humanPlayers: expectedCount,
              activeRoles: sessionPeers.map(([r]) => r),
              mode: room.battleMode
            }));
          } catch (e) { }
        }
      }
    }

    // Check all other active peers present in the same phase
    const otherPeers = Object.entries(room.slots).filter(
      ([r, s]) => s && s !== ws && s.readyState === WebSocket.OPEN && room.slotInfo[r] && room.slotInfo[r].phase === phase
    );

    if (otherPeers.length > 0) {
      try {
        // Send 'peer' for 1v1 backward compatibility
        const primaryPeer = otherPeers.find(([r]) => r === (role === 'host' ? 'join' : 'host')) || otherPeers[0];
        ws.send(JSON.stringify({ t: 'peer', name: room.slotInfo[primaryPeer[0]].name, peerRole: primaryPeer[0] }));

        if (room.maxPlayers === 4) {
          const peersData = otherPeers.map(([r]) => ({ role: r, name: room.slotInfo[r].name }));
          ws.send(JSON.stringify({
            t: 'peers',
            peers: peersData,
            myRole: role,
            maxPlayers: room.maxPlayers,
            battleMode: room.battleMode
          }));
        }
      } catch (e) { }

      // Notify existing peers about the newcomer (send peerRole, never role, so existing peers keep their own role)
      for (const [oRole, oWs] of otherPeers) {
        try {
          oWs.send(JSON.stringify({ t: 'peer', name, peerRole: role }));
          if (room.maxPlayers === 4) {
            oWs.send(JSON.stringify({ t: 'peer_joined', name, peerRole: role }));
          }
        } catch (e) { }
      }
    } else {
      try {
        ws.send(JSON.stringify({ t: 'wait' }));
      } catch (e) { }
    }

    // Message handler
    ws.on('message', (data, isBinary) => {
      room.lastActive = Date.now();

      // Binary relay (multicast to all other peers in the room in the same phase)
      if (isBinary) {
        for (const [oRole, oWs] of Object.entries(room.slots)) {
          if (oWs && oWs !== ws && oWs.readyState === WebSocket.OPEN) {
            const oInfo = room.slotInfo[oRole];
            if (oInfo && oInfo.phase === ws.meta.phase) {
              try { oWs.send(data, { binary: true }); } catch (e) { }
            }
          }
        }
        return;
      }

      // JSON messages
      let msg;
      const text = data.toString('utf8');
      try {
        msg = JSON.parse(text);
      } catch (e) {
        return;
      }

      if (msg.t === 'ping') {
        try { ws.send(JSON.stringify({ t: 'pong', ts: msg.ts })); } catch (e) { }
        return;
      }

      // Cross-verification of Match Results ({ t: 'result', winnerSide: 0|1 })
      if (msg.t === 'result' && typeof msg.winnerSide === 'number') {
        room.results = room.results || {};
        room.results[cid] = { winnerSide: msg.winnerSide, t: Date.now() };

        const otherRole = role === 'host' ? 'join' : 'host';
        const targetInfo = room.slotInfo[otherRole];
        if (targetInfo && room.results[targetInfo.cid]) {
          const r1 = room.results[cid];
          const r2 = room.results[targetInfo.cid];
          if (r1.winnerSide === r2.winnerSide) {
            const p1 = room.hostInfo ? room.hostInfo.userId : 'unknown';
            const p2 = room.joinInfo ? room.joinInfo.userId : 'unknown';
            this.db.recordMatchResult(roomCode, p1, p2, r1.winnerSide);
            try {
              ws.send(JSON.stringify({ t: 'result_ack', verified: true }));
              if (room.slots[otherRole]) room.slots[otherRole].send(JSON.stringify({ t: 'result_ack', verified: true }));
            } catch (e) { }
          }
        }
        return;
      }

      // Relay signaling or control messages
      if (['sig', 'go', 'relay', 'bye'].includes(msg.t)) {
        if (msg.target && room.slots[msg.target]) {
          const targetWs = room.slots[msg.target];
          if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            try { targetWs.send(text); } catch (e) { }
          }
        } else {
          const activeRoles = Object.entries(room.slots)
            .filter(([r, s]) => s && s.readyState === WebSocket.OPEN && room.slotInfo[r] && room.slotInfo[r].phase === ws.meta.phase)
            .map(([r]) => r);

          if (msg.t === 'go') {
            room.isLaunching = true;
            room.expectedRoles = activeRoles;
            room.humanPlayers = activeRoles.length;

            // Echo enriched go message to the sender (host) as well
            const hostGo = JSON.stringify({
              ...msg,
              role,
              myRole: role,
              activeRoles,
              humanPlayers: activeRoles.length,
              maxPlayers: room.maxPlayers,
              mode: room.battleMode
            });
            try { ws.send(hostGo); } catch (e) { }
          }

          for (const [oRole, oWs] of Object.entries(room.slots)) {
            if (oWs && oWs !== ws && oWs.readyState === WebSocket.OPEN) {
              const oInfo = room.slotInfo[oRole];
              if (oInfo && oInfo.phase === ws.meta.phase) {
                if (msg.t === 'go') {
                  const goMsg = JSON.stringify({
                    ...msg,
                    role: oRole,
                    myRole: oRole,
                    activeRoles,
                    humanPlayers: activeRoles.length,
                    maxPlayers: room.maxPlayers,
                    mode: room.battleMode
                  });
                  try { oWs.send(goMsg); } catch (e) { }
                } else {
                  try { oWs.send(text); } catch (e) { }
                }
              }
            }
          }
        }
      }
    });

    ws.on('close', (code) => {
      this.presenceMap.delete(userId);
      this.broadcastPresence();

      if (room.slots[role] === ws) {
        room.slots[role] = null;
        room.slotInfo[role] = null;
      }

      // Suppress 'left' broadcast during room transitions (launching into session)
      const isTransition = Boolean(room.isLaunching);
      const isSuppressedCode = [1000, 1001, 1005, 1006, 4000, 4001, 4002].includes(code);
      if (!(isTransition && isSuppressedCode)) {
        for (const [oRole, oWs] of Object.entries(room.slots)) {
          if (oWs && oWs !== ws && oWs.readyState === WebSocket.OPEN) {
            const oInfo = room.slotInfo[oRole];
            if (oInfo && oInfo.phase === ws.meta.phase) {
              try { oWs.send(JSON.stringify({ t: 'left', role })); } catch (e) { }
            }
          }
        }
      }

      const anyOpen = Object.values(room.slots).some(s => s && s.readyState === WebSocket.OPEN);
      if (!anyOpen) {
        this.rooms.delete(roomCode);
      }
    });

    ws.on('error', () => {
      try { ws.close(); } catch (e) { }
    });
  }

  // ---------------------------------------------------------------------------
  // Quick Match Queue (/net/queue)
  // ---------------------------------------------------------------------------
  handleQueueConnection(ws, url) {
    const name = (url.searchParams.get('name') || 'Player').slice(0, 16);
    const cid = (url.searchParams.get('cid') || '').slice(0, 40);

    for (const q of this.queue) {
      if (q.cid === cid && cid && q.ws !== ws) {
        try { q.ws.close(4000, 'replaced'); } catch (e) { }
      }
    }
    this.cleanQueue();
    if (this.queue.length >= MAX_QUEUE) {
      ws.close(4004, 'Queue full');
      return;
    }

    const entry = { ws, name, cid, t: Date.now() };
    this.queue.push(entry);

    ws.on('message', (data) => {
      const text = data.toString('utf8');
      if (text.includes('ping')) {
        try { ws.send(JSON.stringify({ t: 'pong' })); } catch (e) { }
      }
    });

    ws.on('close', () => {
      this.cleanQueue();
      this.broadcastQueueCount();
    });

    ws.on('error', () => {
      try { ws.close(); } catch (e) { }
    });

    this.tryMatchQueue();
    this.broadcastQueueCount();
  }

  cleanQueue() {
    this.queue = this.queue.filter(q => q.ws.readyState === WebSocket.OPEN);
  }

  broadcastQueueCount() {
    this.cleanQueue();
    const countMsg = JSON.stringify({ t: 'count', n: this.queue.length });
    for (const q of this.queue) {
      try { q.ws.send(countMsg); } catch (e) { }
    }
  }

  tryMatchQueue() {
    this.cleanQueue();
    while (this.queue.length >= 2) {
      const p1 = this.queue.shift();
      const p2 = this.queue.shift();

      if (p1.ws.readyState !== WebSocket.OPEN) {
        if (p2.ws.readyState === WebSocket.OPEN) this.queue.unshift(p2);
        continue;
      }
      if (p2.ws.readyState !== WebSocket.OPEN) {
        this.queue.unshift(p1);
        continue;
      }

      const roomCode = this.generateRoomCode();
      const rules = String(3 << 8); // single battle, 240 seconds

      try {
        p1.ws.send(JSON.stringify({
          t: 'match',
          room: roomCode,
          role: 'host',
          vs: p2.name,
          rules
        }));
      } catch (e) { }

      try {
        p2.ws.send(JSON.stringify({
          t: 'match',
          room: roomCode,
          role: 'join',
          vs: p1.name,
          rules
        }));
      } catch (e) { }
    }
  }

  // ---------------------------------------------------------------------------
  // Community & Room Chat with Challenge Dispatcher (/net/chat)
  // ---------------------------------------------------------------------------
  handleChatConnection(ws, url) {
    const name = (url.searchParams.get('name') || 'Guerreiro').slice(0, 16);
    const tagname = (url.searchParams.get('tag') || name).slice(0, 16);
    const roomCode = (url.searchParams.get('room') || '').toUpperCase().trim();

    ws.chatMeta = { name, tagname, roomCode, lastMsgTime: 0, msgCount: 0 };
    this.chatClients.add(ws);

    // Welcome message and current count
    try {
      ws.send(JSON.stringify({
        t: 'system',
        text: `Bem-vindo ao Dragon Net Chat, ${name}! Guerreiros online: ${this.chatClients.size}`
      }));
    } catch (e) { }

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString('utf8'));
      } catch (e) {
        return;
      }

      const now = Date.now();
      // Rate limiting: max 5 messages per 3 seconds
      if (now - ws.chatMeta.lastMsgTime < 3000) {
        ws.chatMeta.msgCount++;
        if (ws.chatMeta.msgCount > 5) {
          try { ws.send(JSON.stringify({ t: 'error', text: 'Você está enviando mensagens rápido demais!' })); } catch (e) { }
          return;
        }
      } else {
        ws.chatMeta.lastMsgTime = now;
        ws.chatMeta.msgCount = 1;
      }

      // 1. Direct Challenge ({ t: 'challenge', toTag: 'Vegeta', room: 'ABCD' })
      if (msg.t === 'challenge' && msg.toTag && msg.room) {
        const targetTag = msg.toTag.toLowerCase().trim();
        let targetFound = false;
        for (const client of this.chatClients) {
          if (client.readyState === WebSocket.OPEN && client.chatMeta.tagname.toLowerCase() === targetTag) {
            try {
              client.send(JSON.stringify({
                t: 'challenged',
                fromName: ws.chatMeta.name,
                fromTag: ws.chatMeta.tagname,
                room: msg.room
              }));
              targetFound = true;
            } catch (e) { }
          }
        }
        try {
          ws.send(JSON.stringify({
            t: 'challenge_status',
            ok: targetFound,
            text: targetFound ? `Desafio enviado para ${msg.toTag}!` : `Guerreiro ${msg.toTag} não está no chat.`
          }));
        } catch (e) { }
        return;
      }

      // 2. Chat Message (Global or Room)
      const cleanText = String(msg.text || '').trim().slice(0, 200);
      if (!cleanText) return;

      const broadcastMsg = JSON.stringify({
        t: 'chat',
        scope: msg.scope === 'room' ? 'room' : 'global',
        room: msg.room || ws.chatMeta.roomCode,
        from: ws.chatMeta.name,
        tag: ws.chatMeta.tagname,
        text: cleanText,
        time: now
      });

      for (const client of this.chatClients) {
        if (client.readyState === WebSocket.OPEN) {
          if (msg.scope === 'room') {
            // Forward only to clients in same room
            if (client.chatMeta.roomCode && client.chatMeta.roomCode === ws.chatMeta.roomCode) {
              try { client.send(broadcastMsg); } catch (e) { }
            }
          } else {
            // Global broadcast
            try { client.send(broadcastMsg); } catch (e) { }
          }
        }
      }
    });

    ws.on('close', () => {
      this.chatClients.delete(ws);
    });

    ws.on('error', () => {
      try { ws.close(); } catch (e) { }
      this.chatClients.delete(ws);
    });
  }

  broadcastPresence() {
    const list = Array.from(this.presenceMap.entries()).map(([uid, info]) => ({
      uid, ...info
    }));
    const presenceMsg = JSON.stringify({ t: 'presence_update', users: list });
    for (const client of this.chatClients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(presenceMsg); } catch (e) { }
      }
    }
  }

  cleanupStaleRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const isHostOpen = room.host && room.host.readyState === WebSocket.OPEN;
      const isJoinOpen = room.join && room.join.readyState === WebSocket.OPEN;
      if (!isHostOpen && !isJoinOpen) {
        this.rooms.delete(code);
      } else if (now - room.lastActive > 1000 * 60 * 60) {
        if (room.host) try { room.host.close(4003, 'idle timeout'); } catch (e) { }
        if (room.join) try { room.join.close(4003, 'idle timeout'); } catch (e) { }
        this.rooms.delete(code);
      }
    }
  }

  start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => {
        resolve({ port: this.server.address().port, host: this.host });
      });
    });
  }

  close() {
    clearInterval(this.cleanupInterval);
    if (this.db && this.db.saveSync) {
      this.db.saveSync();
    }
    for (const [, room] of this.rooms) {
      if (room.host) try { room.host.close(); } catch (e) { }
      if (room.join) try { room.join.close(); } catch (e) { }
    }
    for (const q of this.queue) {
      try { q.ws.close(); } catch (e) { }
    }
    for (const c of this.chatClients) {
      try { c.close(); } catch (e) { }
    }
    this.wss.close();
    return new Promise(resolve => this.server.close(resolve));
  }
}

if (require.main === module) {
  const server = new MatchmakingServer();
  server.start().then(({ port, host }) => {
    console.log(`[DBZ BT3 Signaling & Platform Server] Listening on http://${host}:${port}`);
    console.log(`Endpoints available:`);
    console.log(`  POST /game-assets/:rev/batch (High-throughput binary streaming)`);
    console.log(`  POST /api/auth/register, /api/auth/login, /api/auth/guest`);
    console.log(`  GET  /api/profile, /api/friends, /api/leaderboard, /api/online`);
    console.log(`  WS   ws://${host}:${port}/net/ws?room=CODE&role=host|join`);
    console.log(`  WS   ws://${host}:${port}/net/queue?name=...`);
    console.log(`  WS   ws://${host}:${port}/net/chat?name=...&tag=...`);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down server...');
    await server.close();
    process.exit(0);
  });
}

module.exports = { MatchmakingServer };
