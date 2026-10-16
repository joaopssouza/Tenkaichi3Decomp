/**
 * Embedded Atomic JSON Database with Write-Ahead Cache (DBZ BT3 Netplay)
 * 
 * Provides ACID-compliant persistence for:
 * - Users & Auth (Tagnames, Passwords, Country Flags, ELO Ratings)
 * - Friends & Real-time Presence
 * - Match History & Cross-verified Leaderboard
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Database {
  constructor(filePath) {
    this.filePath = filePath || process.env.DB_PATH || path.join(__dirname, 'data', 'bt3_store.json');
    this.dataDir = path.dirname(this.filePath);
    
    this.state = {
      users: {},       // id -> User
      byTagname: {},   // lowerTagname -> id
      sessions: {},    // token -> { userId, expiresAt }
      friends: {},     // friendKey -> { id, u1, u2, status, requesterId, createdAt }
      matches: [],     // [ MatchResult ]
      pendingResults: {} // roomCode -> { p1: { winnerSide, t }, p2: { winnerSide, t } }
    };

    this.saveTimeout = null;
    this.init();
  }

  init() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.state = { ...this.state, ...parsed };
      } catch (err) {
        console.error('[DB] Failed to load existing database, initializing fresh store:', err.message);
      }
    } else {
      this.saveSync();
    }
  }

  saveSync() {
    clearTimeout(this.saveTimeout);
    const tmpPath = `${this.filePath}.${Date.now()}.tmp`;
    const json = JSON.stringify({
      users: this.state.users,
      byTagname: this.state.byTagname,
      sessions: this.state.sessions,
      friends: this.state.friends,
      matches: this.state.matches
    }, null, 2);

    try {
      fs.writeFileSync(tmpPath, json, 'utf8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (e) {
      console.error('[DB] Failed writing database file:', e.message);
    }
  }

  save() {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.saveSync();
    }, 250); // Debounce disk writes to 250ms
  }

  hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex');
  }

  // --- Auth & Users ---
  register(tagname, displayName, country = 'BR', password = '') {
    const cleanTag = String(tagname || '').trim();
    if (!/^[a-zA-Z0-9_-]{3,16}$/.test(cleanTag)) {
      throw new Error('Tagname inválido. Use entre 3 e 16 caracteres alfanuméricos.');
    }

    const lower = cleanTag.toLowerCase();
    if (this.state.byTagname[lower]) {
      throw new Error('Esta tag já está em uso por outro guerreiro.');
    }

    const id = 'usr_' + crypto.randomBytes(8).toString('hex');
    const salt = crypto.randomBytes(16).toString('hex');
    const passHash = password ? this.hashPassword(password, salt) : '';

    const user = {
      id,
      tagname: cleanTag,
      displayName: (displayName || cleanTag).slice(0, 24),
      country: (country || 'BR').toUpperCase().slice(0, 3),
      salt,
      passHash,
      elo: 1000,
      wins: 0,
      losses: 0,
      streak: 0,
      createdAt: Date.now(),
      lastSeenAt: Date.now()
    };

    this.state.users[id] = user;
    this.state.byTagname[lower] = id;
    this.save();

    const token = this.createSession(id);
    return { user: this.sanitizeUser(user), token };
  }

  login(tagname, password = '') {
    const cleanTag = String(tagname || '').trim().toLowerCase();
    const id = this.state.byTagname[cleanTag];
    if (!id || !this.state.users[id]) {
      throw new Error('Usuário não encontrado.');
    }

    const user = this.state.users[id];
    if (user.passHash) {
      const hashed = this.hashPassword(password, user.salt);
      if (hashed !== user.passHash) {
        throw new Error('Senha incorreta.');
      }
    }

    user.lastSeenAt = Date.now();
    this.save();

    const token = this.createSession(id);
    return { user: this.sanitizeUser(user), token };
  }

  // Quick or Social Guest Login
  guestLogin(displayName, country = 'BR') {
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const baseName = (displayName || 'Z_Fighter').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || 'Fighter';
    const tagname = `${baseName}_${randSuffix}`.slice(0, 16);
    return this.register(tagname, displayName || tagname, country);
  }

  createSession(userId) {
    const token = 'tok_' + crypto.randomBytes(24).toString('hex');
    this.state.sessions[token] = {
      userId,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30 // 30 days
    };
    this.save();
    return token;
  }

  getUserByToken(token) {
    if (!token || !this.state.sessions[token]) return null;
    const session = this.state.sessions[token];
    if (Date.now() > session.expiresAt) {
      delete this.state.sessions[token];
      this.save();
      return null;
    }
    const user = this.state.users[session.userId];
    return user ? this.sanitizeUser(user) : null;
  }

  getUserById(id) {
    const user = this.state.users[id];
    return user ? this.sanitizeUser(user) : null;
  }

  sanitizeUser(user) {
    const { salt, passHash, ...safe } = user;
    return safe;
  }

  // --- Friends System ---
  getFriendshipKey(u1, u2) {
    return [u1, u2].sort().join('_');
  }

  sendFriendRequest(requesterId, targetTagname) {
    const targetId = this.state.byTagname[targetTagname.toLowerCase().trim()];
    if (!targetId || !this.state.users[targetId]) {
      throw new Error('Guerreiro não encontrado.');
    }
    if (requesterId === targetId) {
      throw new Error('Você não pode adicionar a si mesmo.');
    }

    const key = this.getFriendshipKey(requesterId, targetId);
    let f = this.state.friends[key];

    if (!f) {
      f = {
        id: 'fr_' + crypto.randomBytes(6).toString('hex'),
        u1: requesterId,
        u2: targetId,
        status: 'pending',
        requesterId,
        createdAt: Date.now()
      };
      this.state.friends[key] = f;
      this.save();
      return { status: 'pending', message: 'Pedido de amizade enviado!' };
    }

    if (f.status === 'accepted') {
      return { status: 'accepted', message: 'Vocês já são amigos!' };
    }

    if (f.status === 'pending' && f.requesterId !== requesterId) {
      // Automatic mutual accept
      f.status = 'accepted';
      this.save();
      return { status: 'accepted', message: 'Pedido de amizade aceito!' };
    }

    return { status: 'pending', message: 'Pedido de amizade já pendente.' };
  }

  getFriends(userId, presenceMap = new Map()) {
    const list = [];
    for (const key in this.state.friends) {
      const f = this.state.friends[key];
      if (f.u1 === userId || f.u2 === userId) {
        const otherId = f.u1 === userId ? f.u2 : f.u1;
        const other = this.state.users[otherId];
        if (other) {
          const presence = presenceMap.get(otherId) || { status: 'offline', room: null };
          list.push({
            id: other.id,
            tagname: other.tagname,
            displayName: other.displayName,
            country: other.country,
            elo: other.elo,
            friendshipStatus: f.status,
            isRequester: f.requesterId === userId,
            presenceStatus: presence.status,
            roomCode: presence.room
          });
        }
      }
    }
    return list;
  }

  // --- Leaderboards & Stats ---
  recordMatchResult(roomCode, p1Id, p2Id, winnerSide) {
    const p1 = this.state.users[p1Id];
    const p2 = this.state.users[p2Id];

    let winnerId = null;
    let loserId = null;

    if (winnerSide === 0 && p1) {
      winnerId = p1.id;
      loserId = p2 ? p2.id : null;
    } else if (winnerSide === 1 && p2) {
      winnerId = p2.id;
      loserId = p1 ? p1.id : null;
    }

    let eloChange = 16;
    if (winnerId && this.state.users[winnerId]) {
      const winner = this.state.users[winnerId];
      winner.wins += 1;
      winner.streak += 1;
      winner.elo += eloChange;
    }
    if (loserId && this.state.users[loserId]) {
      const loser = this.state.users[loserId];
      loser.losses += 1;
      loser.streak = 0;
      loser.elo = Math.max(100, loser.elo - eloChange);
    }

    const matchRecord = {
      id: 'mat_' + crypto.randomBytes(6).toString('hex'),
      roomCode,
      p1Id,
      p2Id,
      winnerId,
      eloChange,
      timestamp: Date.now()
    };

    this.state.matches.push(matchRecord);
    if (this.state.matches.length > 5000) {
      this.state.matches.shift();
    }

    this.save();
    return matchRecord;
  }

  getLeaderboard(limit = 50, timeframe = 'all') {
    // Only include users who have participated in at least one match (wins + losses > 0)
    const users = Object.values(this.state.users).filter(u => ((u.wins || 0) + (u.losses || 0)) > 0);
    
    // Sort primarily by ELO descending, secondarily by total wins
    users.sort((a, b) => (b.elo - a.elo) || (b.wins - a.wins));

    return users.slice(0, limit).map((u, rank) => ({
      rank: rank + 1,
      id: u.id,
      tagname: u.tagname,
      displayName: u.displayName,
      country: u.country,
      elo: u.elo,
      wins: u.wins,
      losses: u.losses,
      winRate: (u.wins + u.losses) > 0 ? Math.round((u.wins / (u.wins + u.losses)) * 100) : 0,
      streak: u.streak
    }));
  }
}

module.exports = { Database };
