/**
 * Dragon Net Battle - Portal App Shell Controller
 * 
 * Manages Dual-Layer architecture:
 * - Outer Portal (Auth, Friends, Deep Link room sharing, HD Texture selector, Chat, Leaderboards)
 * - Inner Runtime Iframe (#game-frame)
 */

(function () {
  'use strict';

  // State
  const state = {
    user: null,
    token: null,
    activeTab: 'lobby',
    texPack: localStorage.getItem('bt3.hd_textures') || '0', // 0 = off (default), 1 = ui, 2 = full
    aspectRatio: localStorage.getItem('bt3.aspect') || '16:9',
    gameStarted: false,
    currentRoom: null,
    friends: [],
    chatSocket: null,
    presenceMap: new Map(),
    pendingChallengeRoom: null,
    inQueue: false,
    queueWs: null
  };

  const Q = new URLSearchParams(window.location.search);

  // Helper DOM
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  // --- 1. Audio & Persistence Helpers ---
  function initAuth() {
    try {
      const saved = localStorage.getItem('bt3.auth');
      if (saved) {
        const parsed = JSON.parse(saved);
        state.user = parsed.user;
        state.token = parsed.token;
        updateProfileUI();
        refreshFriends();
        connectChat();
      } else {
        // Auto guest setup
        doGuestLogin();
      }
    } catch (e) {
      doGuestLogin();
    }
  }

  async function doGuestLogin() {
    try {
      const res = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Guerreiro Z', country: 'BR' })
      });
      const data = await res.json();
      if (data.success) {
        state.user = data.user;
        state.token = data.token;
        localStorage.setItem('bt3.auth', JSON.stringify({ user: data.user, token: data.token }));
        updateProfileUI();
        connectChat();
      }
    } catch (e) {
      console.warn('Backend offline or standalone mode, using local guest fallback');
      state.user = {
        id: 'local_usr',
        tagname: 'Guerreiro_' + Math.floor(1000 + Math.random() * 9000),
        displayName: 'Guerreiro Z',
        country: 'BR',
        elo: 1000,
        wins: 0,
        losses: 0
      };
      updateProfileUI();
    }
  }

  function updateProfileUI() {
    if (!state.user) return;
    $('user-tag').textContent = state.user.displayName || state.user.tagname;
    $('user-elo').textContent = `⚡ ${state.user.elo || 1000} ELO · ${state.user.country || 'BR'}`;
    $('user-avatar').textContent = (state.user.tagname || 'Z')[0].toUpperCase();
  }

  // --- 2. Deep Linking & Private Room Invite ---
  function checkDeepLink() {
    const net = Q.get('net');
    const room = Q.get('room');
    const rules = Q.get('rules');
    const mode = Q.get('mode');
    const slots = Q.get('slots');

    if (net === 'join' && room) {
      switchTab('lobby');
      $('join-room-code').value = room.toUpperCase();
      const isTag = mode === 'tag' || slots === '4' || rules === '771';
      showNotification(isTag 
        ? `Conectando à sala 2v2 Tag Team [${room.toUpperCase()}]...`
        : `Conectando à sala privada [${room.toUpperCase()}]...`, 'cyan');
      
      // Auto boot into room after brief visual confirmation
      setTimeout(() => {
        launchGame({ 
          net: 'join', 
          room: room.toUpperCase(), 
          rules: rules || (isTag ? '771' : String(3 << 8)),
          mode: isTag ? 'tag' : (mode || 'single'),
          slots: isTag ? '4' : '2'
        });
        cleanUrlQueryParams();
      }, 800);
    }
  }

  function copyInviteLink(roomCode) {
    if (!roomCode) {
      showNotification('Crie uma sala primeiro para gerar o link.', 'red');
      return;
    }
    const origin = window.location.origin;
    const mode = state.currentMode || $('rule-selector').value || 'single';
    const isTag = mode === 'tag' || state.currentSlots === 4;
    const rules = state.currentRules || (isTag ? '771' : '768');
    
    let url = `${origin}/?net=join&room=${roomCode}&rules=${encodeURIComponent(rules)}&lobby=1`;
    if (isTag) {
      url += `&mode=tag&slots=4`;
    }
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        showNotification(`Link copiado: [${roomCode}] ${isTag ? '(2v2 Tag Team)' : ''}! Envie para seus parceiros.`, 'cyan');
      });
    } else {
      prompt('Copie o link de convite abaixo:', url);
    }
  }

  function cleanUrlQueryParams() {
    try {
      const url = new URL(window.location.href);
      ['net', 'room', 'rules', 'vs', 'lobby'].forEach(k => url.searchParams.delete(k));
      window.history.replaceState({}, document.title, url.pathname);
    } catch (e) {}
  }

  // --- 3. HD Texture Pack Opt-in & Warning Modal ---
  function setTexturePack(level) {
    level = String(level);
    if (level === state.texPack && !state.pendingTexLevel) { updateTexturePills(); return; }
    if (level === '0') {
      applyTexturePack('0');
      showNotification('Texturas Originais PS2 ativadas (Leve e rápido).', 'cyan');
      return;
    }

    // Modal warning for HD options (1 or 2)
    state.pendingTexLevel = level;
    $('modal-warning').classList.add('active');
  }

  // Single source of truth: updates state, storage, pills, radios and the running game
  function applyTexturePack(level) {
    const changed = state.texPack !== level;
    state.texPack = level;
    state.pendingTexLevel = null;
    localStorage.setItem('bt3.hd_textures', level);
    updateTexturePills();
    if (changed && state.gameStarted) {
      // Textures are indexed at boot: reload the runtime with the new pack
      reloadGameWithTextures();
    }
  }

  function reloadGameWithTextures() {
    const frame = $('game-frame');
    try {
      const u = new URL(frame.src);
      u.searchParams.set('hd', state.texPack);
      frame.src = u.toString();
      showNotification('Reiniciando o motor com o novo pacote de texturas...', 'orange');
    } catch (e) {}
  }

  function confirmTexturePack() {
    if (state.pendingTexLevel) {
      const lvl = state.pendingTexLevel;
      applyTexturePack(lvl);
      showNotification(lvl === '1' ? 'Apenas UI & Botões HD ativados.' : 'Remaster Completo HD 4K ativado!', 'cyan');
    }
    $('modal-warning').classList.remove('active');
  }

  function cancelTexturePack() {
    state.pendingTexLevel = null;
    $('modal-warning').classList.remove('active');
    updateTexturePills();
  }

  function updateTexturePills() {
    $$('.tex-pill').forEach(pill => {
      pill.classList.toggle('active', pill.dataset.level === state.texPack);
    });
    $$('input[name="tex-opt"]').forEach(r => {
      r.checked = r.value === state.texPack;
    });
  }

  // --- Live stats (matches / online / registered) ---
  async function refreshStats() {
    try {
      const r = await fetch('/api/stats', { cache: 'no-store' });
      const d = await r.json();
      const n = Number(d.activeMatches) || 0;
      $('stat-rooms').textContent = `${n} ${n === 1 ? 'ativa' : 'ativas'}`;
      $('stat-online').textContent = String(d.onlinePlayers);
      $('stat-players').textContent = String(d.registeredUsers);
    } catch (e) { /* backend offline: keep last values */ }
  }

  let fullscreenIdleTimer = null;

  function showFullscreenExitBtn() {
    const btn = $('btn-exit-fullscreen');
    if (!btn || !document.fullscreenElement) return;
    btn.classList.add('visible');
    clearTimeout(fullscreenIdleTimer);
    fullscreenIdleTimer = setTimeout(() => {
      if (document.fullscreenElement) {
        btn.classList.remove('visible');
      }
    }, 2500);
  }

  function updateFullscreenUI() {
    const on = !!document.fullscreenElement;
    const exitBtn = $('btn-exit-fullscreen');
    const fsBtn = $('btn-fullscreen');
    if (fsBtn) fsBtn.textContent = on ? '⛶ Sair da Tela Cheia' : '⛶ Tela Cheia';

    if (on) {
      if (exitBtn) exitBtn.style.display = 'flex';
      showFullscreenExitBtn();
    } else {
      clearTimeout(fullscreenIdleTimer);
      if (exitBtn) {
        exitBtn.classList.remove('visible');
        exitBtn.style.display = 'none';
      }
    }
  }

  // --- 4. Game Lifecycle & Iframe Controller ---
  function launchGame(params = {}) {
    const frame = $('game-frame');
    const hero = $('hero-lobby');
    
    const query = new URLSearchParams();
    query.set('hd', state.texPack);
    if (params.net) query.set('net', params.net);
    if (params.room) query.set('room', params.room);
    if (params.rules) query.set('rules', params.rules);
    if (params.mode) query.set('mode', params.mode);
    if (params.slots) query.set('slots', params.slots);

    // Boot iframe
    frame.src = `/runtime.html?${query.toString()}`;
    frame.classList.add('active');
    hero.style.display = 'none';
    state.gameStarted = true;
    $('btn-quit-game').style.display = 'flex';

    showNotification('Iniciando o motor de combate...', 'cyan');
  }

  function quitGame() {
    const frame = $('game-frame');
    const hero = $('hero-lobby');

    frame.src = 'about:blank';
    frame.classList.remove('active');
    hero.style.display = 'flex';
    state.gameStarted = false;
    $('btn-quit-game').style.display = 'none';

    cleanUrlQueryParams();
    showNotification('Combate encerrado. Retornou ao Portal.', 'orange');
  }

  function toggleAspectRatio(ratio) {
    state.aspectRatio = ratio;
    localStorage.setItem('bt3.aspect', ratio);
    const vp = $('viewport-area');
    if (ratio === '4:3') {
      vp.style.maxWidth = '960px';
      vp.style.aspectRatio = '4/3';
      vp.style.margin = '0 auto';
      vp.style.alignSelf = 'center';
    } else {
      vp.style.maxWidth = '100%';
      vp.style.aspectRatio = '16/9';
      vp.style.margin = '0 auto';
      vp.style.alignSelf = 'stretch';
    }
    $$('.btn-ratio').forEach(b => b.classList.toggle('active', b.dataset.ratio === ratio));
  }

  // --- 5. Real-Time Chat & Friends WebSocket ---
  function connectChat() {
    if (!state.user) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${location.host}/net/chat?name=${encodeURIComponent(state.user.displayName || state.user.tagname)}&tag=${encodeURIComponent(state.user.tagname)}`;

    try {
      const ws = new WebSocket(wsUrl);
      state.chatSocket = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleChatMessage(msg);
        } catch (e) {}
      };

      ws.onclose = () => {
        setTimeout(connectChat, 5000);
      };
    } catch (e) {}
  }

  function handleChatMessage(msg) {
    const windowEl = $('chat-window');
    const div = document.createElement('div');
    div.className = 'chat-msg';

    if (msg.t === 'system') {
      div.className += ' system';
      div.textContent = `[Sistema] ${msg.text}`;
    } else if (msg.t === 'chat') {
      div.innerHTML = `<span class="sender">${escapeHtml(msg.from)}:</span> ${escapeHtml(msg.text)}`;
    } else if (msg.t === 'challenged') {
      div.className += ' system';
      div.innerHTML = `⚔️ <strong>${escapeHtml(msg.fromName)}</strong> desafiou você para um combate na sala <strong>[${escapeHtml(msg.room)}]</strong>! <button class="btn-sm-challenge" onclick="window.BT3App.acceptChallenge('${escapeHtml(msg.room)}')">ACEITAR</button>`;
      showNotification(`Desafio recebido de ${msg.fromName}!`, 'orange');
    }

    windowEl.appendChild(div);
    windowEl.scrollTop = windowEl.scrollHeight;
  }

  function sendChatMessage() {
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text || !state.chatSocket || state.chatSocket.readyState !== WebSocket.OPEN) return;

    state.chatSocket.send(JSON.stringify({
      text,
      scope: 'global'
    }));
    input.value = '';
  }

  function sendChallenge(toTag) {
    const room = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
    state.currentRoom = room;

    if (state.chatSocket && state.chatSocket.readyState === WebSocket.OPEN) {
      state.chatSocket.send(JSON.stringify({
        t: 'challenge',
        toTag,
        room
      }));
      showNotification(`Desafio enviado para ${toTag}! Criando sala [${room}]...`, 'cyan');
      launchGame({ net: 'host', room, rules: String(3 << 8) });
    }
  }

  async function refreshFriends() {
    if (!state.token) return;
    try {
      const res = await fetch('/api/friends', {
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      const data = await res.json();
      if (data.success && data.friends) {
        renderFriendsList(data.friends);
      }
    } catch (e) {}
  }

  function renderFriendsList(friends) {
    const container = $('friends-list');
    container.innerHTML = '';
    if (friends.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">Nenhum guerreiro adicionado ainda. Digite a tag abaixo para adicionar!</div>';
      return;
    }

    friends.forEach(f => {
      const item = document.createElement('div');
      item.className = 'friend-item';
      item.innerHTML = `
        <div class="friend-info">
          <div class="status-indicator status-${f.presenceStatus || 'offline'}"></div>
          <div>
            <div class="friend-name">${escapeHtml(f.displayName || f.tagname)}</div>
            <div style="font-size: 0.7rem; color: var(--text-muted);">${f.tagname} · ${f.elo} ELO</div>
          </div>
        </div>
        <button class="btn-sm-challenge" onclick="window.BT3App.sendChallenge('${f.tagname}')">DESAFIAR</button>
      `;
      container.appendChild(item);
    });
  }

  async function addFriend() {
    const input = $('friend-tag-input');
    const targetTagname = input.value.trim();
    if (!targetTagname || !state.token) return;

    try {
      const res = await fetch('/api/friends/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ targetTagname })
      });
      const data = await res.json();
      if (data.success) {
        showNotification(data.message, 'cyan');
        input.value = '';
        refreshFriends();
      } else {
        showNotification(data.error || 'Erro ao enviar pedido', 'red');
      }
    } catch (e) {
      showNotification('Erro na requisição', 'red');
    }
  }

  // --- 6. Live Leaderboard Loader ---
  async function loadLeaderboard() {
    try {
      const res = await fetch('/api/leaderboard?limit=25');
      const data = await res.json();
      if (data.success && data.leaderboard) {
        renderLeaderboard(data.leaderboard);
      }
    } catch (e) {}
  }

  function renderLeaderboard(list) {
    const tableBody = $('leaderboard-rows');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    const validList = (list || []).filter(p => ((p.wins || 0) + (p.losses || 0)) > 0);

    if (validList.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; padding: 2.2rem 1rem; color: var(--text-muted); font-size: 0.85rem;">
            Nenhum guerreiro pontuou no ranking ainda.<br>
            <span style="font-size: 0.78rem; color: var(--scouter-cyan); font-weight: 600;">Dispute uma partida online para entrar no topo!</span>
          </td>
        </tr>
      `;
      return;
    }

    validList.forEach((p, idx) => {
      const rank = idx + 1;
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-subtle)';
      tr.innerHTML = `
        <td style="padding: 0.6rem 0.4rem; font-weight: 800; color: ${rank <= 3 ? 'var(--ki-gold)' : 'var(--text-muted)'};">#${rank}</td>
        <td style="padding: 0.6rem 0.4rem; font-weight: 700;">${escapeHtml(p.displayName || p.tagname)}</td>
        <td style="padding: 0.6rem 0.4rem; color: var(--scouter-cyan); font-weight: 800;">${p.elo}</td>
        <td style="padding: 0.6rem 0.4rem; color: var(--success-green);">${p.wins}V / ${p.losses}D</td>
      `;
      tableBody.appendChild(tr);
    });
  }

  // --- 7. UI Tab Navigation ---
  function switchTab(tabId) {
    state.activeTab = tabId;
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    $$('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tabId}`));

    if (tabId === 'leaderboard') loadLeaderboard();
    if (tabId === 'friends') refreshFriends();
  }

  function showNotification(text, tone = 'cyan') {
    const el = $('global-notification');
    el.textContent = text;
    el.style.borderColor = tone === 'orange' ? 'var(--capsule-orange)' : tone === 'red' ? 'var(--saiyan-red)' : 'var(--scouter-cyan)';
    el.style.boxShadow = `0 4px 20px ${tone === 'orange' ? 'var(--capsule-orange-glow)' : 'var(--scouter-cyan-glow)'}`;
    el.classList.add('show');
    clearTimeout(state.notifTimer);
    state.notifTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  // --- Quick Matchmaker Queue Controller ---
  function toggleQuickMatch() {
    if (state.inQueue) {
      if (state.queueWs) {
        try { state.queueWs.close(); } catch (e) {}
        state.queueWs = null;
      }
      state.inQueue = false;
      const btn = $('btn-quick-match');
      if (btn) {
        btn.innerHTML = '⚡ BUSCAR OPONENTE NA FILA';
        btn.classList.remove('btn-searching');
      }
      showNotification('Busca de oponente cancelada.', 'orange');
      return;
    }

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const name = (state.user && (state.user.displayName || state.user.tagname)) || 'Guerreiro';
    let cid = localStorage.getItem('bt3.cid');
    if (!cid) {
      cid = Math.random().toString(36).slice(2, 12);
      localStorage.setItem('bt3.cid', cid);
    }
    const qUrl = `${proto}://${location.host}/net/queue?name=${encodeURIComponent(name)}&cid=${encodeURIComponent(cid)}`;

    const btn = $('btn-quick-match');
    if (btn) {
      btn.innerHTML = '⏳ Buscando Oponente (Conectando fila)... <span style="font-size:0.75rem; text-decoration:underline; margin-left:6px;">(Cancelar)</span>';
      btn.classList.add('btn-searching');
    }
    showNotification('Buscando oponente na fila global... Você pode continuar no portal!', 'cyan');
    state.inQueue = true;

    try {
      const ws = new WebSocket(qUrl);
      state.queueWs = ws;

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.t === 'count') {
            if (state.inQueue && btn) {
              btn.innerHTML = `⏳ Buscando Oponente (${msg.n} na fila)... <span style="font-size:0.75rem; text-decoration:underline; margin-left:6px;">(Cancelar)</span>`;
            }
          } else if (msg.t === 'match') {
            state.inQueue = false;
            state.queueWs = null;
            if (btn) {
              btn.innerHTML = '⚡ BUSCAR OPONENTE NA FILA';
              btn.classList.remove('btn-searching');
            }
            showNotification(`⚔️ Oponente encontrado: ${msg.vs || 'Guerreiro'}! Conectando à sala [${msg.room}]...`, 'cyan');
            try { ws.close(); } catch (err) {}
            launchGame({
              net: msg.role,
              room: msg.room,
              rules: msg.rules || String(3 << 8),
              vs: msg.vs
            });
          }
        } catch (err) {}
      };

      ws.onclose = () => {
        if (state.inQueue) {
          state.inQueue = false;
          state.queueWs = null;
          if (btn) {
            btn.innerHTML = '⚡ BUSCAR OPONENTE NA FILA';
            btn.classList.remove('btn-searching');
          }
        }
      };

      ws.onerror = () => {
        if (state.inQueue) {
          state.inQueue = false;
          state.queueWs = null;
          if (btn) {
            btn.innerHTML = '⚡ BUSCAR OPONENTE NA FILA';
            btn.classList.remove('btn-searching');
          }
          showNotification('Falha ao conectar à fila global.', 'red');
        }
      };
    } catch (err) {
      state.inQueue = false;
      if (btn) {
        btn.innerHTML = '⚡ BUSCAR OPONENTE NA FILA';
        btn.classList.remove('btn-searching');
      }
      showNotification('Erro ao iniciar fila.', 'red');
    }
  }

  // --- 8. Event Listeners Initialization ---
  function setupEvents() {
    // Tab switching
    $$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Texture pills
    $$('.tex-pill').forEach(pill => {
      pill.addEventListener('click', () => setTexturePack(pill.dataset.level));
    });

    // Ratio buttons
    $$('.btn-ratio').forEach(btn => {
      btn.addEventListener('click', () => toggleAspectRatio(btn.dataset.ratio));
    });

    // Hero buttons
    $('btn-hero-play').addEventListener('click', () => launchGame());
    $('btn-hero-tag').addEventListener('click', () => {
      switchTab('lobby');
      $('rule-selector').value = 'tag';
      showNotification('Modo 2v2 Tag Team selecionado! Crie ou entre em uma sala.', 'cyan');
    });

    // Quit button
    $('btn-quit-game').addEventListener('click', quitGame);

    // Create Room
    $('btn-create-room').addEventListener('click', () => {
      const mode = $('rule-selector').value;
      const isTag = mode === 'tag';
      const isTeam = mode === 'team';
      const isDp = mode === 'dp';
      
      const room = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
      state.currentRoom = room;
      state.currentMode = mode;
      state.currentSlots = isTag ? 4 : 2;
      
      let rulesVal = String(3 << 8); // 768
      if (isTag) rulesVal = String(3 | (3 << 8)); // 771
      else if (isTeam) rulesVal = String(1 | (3 << 8)); // 769
      else if (isDp) rulesVal = String(2 | (1 << 4) | (3 << 8)); // 786
      state.currentRules = rulesVal;

      $('created-room-code').textContent = room;
      const badge = $('created-room-badge');
      if (badge) {
        if (isTag) {
          badge.textContent = '⚔️ Modo 2v2 Tag Team (4 Jogadores)';
          badge.style.borderColor = 'var(--scouter-cyan)';
          badge.style.color = 'var(--scouter-cyan)';
          badge.style.background = 'rgba(0, 240, 255, 0.15)';
        } else if (isTeam) {
          badge.textContent = '🛡️ Batalha em Equipe (5v5)';
          badge.style.borderColor = 'var(--ki-gold)';
          badge.style.color = 'var(--ki-gold)';
          badge.style.background = 'rgba(255, 187, 0, 0.15)';
        } else if (isDp) {
          badge.textContent = '⚖️ Batalha DP (15 Pontos)';
          badge.style.borderColor = 'var(--success-green)';
          badge.style.color = 'var(--success-green)';
          badge.style.background = 'rgba(0, 255, 136, 0.15)';
        } else {
          badge.textContent = '⚔️ Duelo 1v1 (2 Jogadores)';
          badge.style.borderColor = 'var(--ki-gold)';
          badge.style.color = 'var(--ki-gold)';
          badge.style.background = 'rgba(255, 187, 0, 0.15)';
        }
      }
      $('room-created-box').style.display = 'block';
      showNotification(`Sala [${room}] criada (${isTag ? '2v2 Tag Team' : '1v1'})!`, 'cyan');
    });

    $('btn-start-created-room').addEventListener('click', () => {
      if (state.currentRoom) {
        launchGame({ 
          net: 'host', 
          room: state.currentRoom, 
          rules: state.currentRules || String(3 << 8),
          mode: state.currentMode || 'single',
          slots: state.currentSlots ? String(state.currentSlots) : '2'
        });
      }
    });

    $('btn-share-room').addEventListener('click', () => {
      copyInviteLink(state.currentRoom);
    });

    // Join Room
    $('btn-join-room').addEventListener('click', () => {
      const code = $('join-room-code').value.trim().toUpperCase();
      if (!code || code.length !== 4) {
        showNotification('Código da sala deve conter 4 letras.', 'red');
        return;
      }
      const mode = $('rule-selector').value;
      const isTag = mode === 'tag';
      launchGame({ 
        net: 'join', 
        room: code, 
        rules: isTag ? '771' : String(3 << 8),
        mode: isTag ? 'tag' : 'single',
        slots: isTag ? '4' : '2'
      });
    });

    // Quick match (WebSocket queue without page/iframe reload)
    $('btn-quick-match').addEventListener('click', toggleQuickMatch);

    // Refresh friends without full-page reload
    const btnRefreshFriends = $('btn-refresh-friends');
    if (btnRefreshFriends) {
      btnRefreshFriends.addEventListener('click', async () => {
        btnRefreshFriends.style.transform = 'rotate(360deg)';
        btnRefreshFriends.style.transition = 'transform 0.4s ease';
        await refreshFriends();
        setTimeout(() => {
          btnRefreshFriends.style.transform = 'none';
          btnRefreshFriends.style.transition = 'none';
        }, 450);
        showNotification('Lista de amigos atualizada.', 'cyan');
      });
    }

    // Friends
    $('btn-add-friend').addEventListener('click', addFriend);

    // Chat
    $('btn-send-chat').addEventListener('click', sendChatMessage);
    $('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });

    // Modal
    $('btn-modal-confirm').addEventListener('click', confirmTexturePack);
    $('btn-modal-cancel').addEventListener('click', cancelTexturePack);

    // Fullscreen
    $('btn-fullscreen').addEventListener('click', () => {
      const vp = $('viewport-area');
      if (!document.fullscreenElement) {
        vp.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
    $('btn-exit-fullscreen').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    });
    document.addEventListener('fullscreenchange', updateFullscreenUI);

    // Auto-hide fullscreen exit button on mouse/touch inactivity
    const handleFullscreenActivity = () => {
      if (document.fullscreenElement) {
        showFullscreenExitBtn();
      }
    };
    document.addEventListener('mousemove', handleFullscreenActivity, { passive: true });
    document.addEventListener('touchstart', handleFullscreenActivity, { passive: true });
    window.addEventListener('message', (e) => {
      if (e.data && e.data.t === 'bt3_mousemove' && document.fullscreenElement) {
        showFullscreenExitBtn();
      }
    });

    // Esc inside the iframe is swallowed by the game: relay it from the runtime
    window.addEventListener('message', (e) => {
      if (e.data && e.data.t === 'bt3_exit_fullscreen' && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F10' && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    });
  }

  // Global exports for inline actions
  window.BT3App = {
    acceptChallenge: (room) => {
      cleanUrlQueryParams();
      launchGame({ net: 'join', room, rules: String(3 << 8) });
    },
    sendChallenge,
    setTexturePack,
    refreshFriends,
    toggleQuickMatch
  };

  // Init
  window.addEventListener('DOMContentLoaded', () => {
    setupEvents();
    initAuth();
    updateTexturePills();
    toggleAspectRatio(state.aspectRatio);
    checkDeepLink();
    refreshStats();
    setInterval(refreshStats, 5000);
  });
})();
