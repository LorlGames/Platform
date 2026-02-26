/**
 * app.js — Main Lorl application controller
 */

(async () => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  // ── State ──
  let currentPage = 'home';
  let pendingGameMeta = null; // game waiting to be launched
  let currentBlobUrl = null;
  let selectedServerId = null;
  let serverStatuses = {};

  // ── Page navigation ──
  function navigate(page) {
    $$('.page').forEach(p => p.classList.remove('active'));
    $$('.nav-btn').forEach(b => b.classList.remove('active'));
    const pageEl = $('#page-' + page);
    if (!pageEl) return;
    pageEl.classList.add('active');
    currentPage = page;
    const btn = $('#btn-' + page);
    if (btn) btn.classList.add('active');

    if (page === 'home') renderRecent();
    if (page === 'library') renderLibrary();
    if (page === 'settings') renderSettings();
  }

  $('#btn-home').onclick = () => navigate('home');
  $('#btn-library').onclick = () => navigate('library');
  $('#btn-settings').onclick = () => navigate('settings');

  // ── Username ──
  function refreshUsername() {
    $('#username-display').textContent = LorldStorage.getUsername();
    $('#settings-name').value = LorldStorage.getUsername();
  }
  refreshUsername();

  $('#btn-set-name').onclick = () => openNameModal();
  $('#save-name').onclick = () => {
    const v = $('#settings-name').value.trim();
    if (v) { LorldStorage.setUsername(v); refreshUsername(); LorldUI.showNotification('Name saved!', 'success'); }
  };

  function openNameModal() {
    $('#modal-name-input').value = LorldStorage.getUsername();
    showModal('modal-name');
  }
  $('#modal-name-save').onclick = () => {
    const v = $('#modal-name-input').value.trim();
    if (v) { LorldStorage.setUsername(v); refreshUsername(); }
    closeModal();
  };
  $('#modal-name-cancel').onclick = closeModal;

  // ── Modal control ──
  function showModal(id) {
    $('#modal-overlay').classList.remove('hidden');
    $$('.modal').forEach(m => m.classList.add('hidden'));
    $('#' + id).classList.remove('hidden');
  }
  function closeModal() {
    $('#modal-overlay').classList.add('hidden');
    $$('.modal').forEach(m => m.classList.add('hidden'));
  }
  $('#modal-overlay').onclick = (e) => { if (e.target === $('#modal-overlay')) closeModal(); };

  // ── File loading ──
  const fileInput = $('#file-input');

  function openFilePicker() {
    fileInput.value = '';
    fileInput.click();
  }

  fileInput.onchange = async () => {
    if (!fileInput.files[0]) return;
    await handleGameFile(fileInput.files[0]);
  };

  async function handleGameFile(file) {
    try {
      LorldUI.showNotification('Loading game...', 'info');
      const meta = await LorldLibrary.loadFromFile(file);
      LorldStorage.addToLibrary({ ...meta, vfs: undefined }); // store meta without full VFS
      // Store VFS separately
      const fullMeta = meta;
      // Keep in memory for this session
      sessionStorage.setItem('lorl_vfs_' + meta.id, JSON.stringify(meta.vfs));
      LorldStorage.addToLibrary({ id: meta.id, name: meta.name, author: meta.author, description: meta.description, version: meta.version, icon: meta.icon, addedAt: meta.addedAt });

      LorldUI.showNotification(`"${meta.name}" loaded!`, 'success');
      promptLaunch(meta);
    } catch (e) {
      console.error(e);
      LorldUI.showNotification('Failed to load game: ' + e.message, 'error');
    }
  }

  // Try to get full meta (with VFS) for a game
  function getFullMeta(id) {
    const vfsStr = sessionStorage.getItem('lorl_vfs_' + id);
    if (!vfsStr) return null;
    const base = LorldStorage.getLibrary().find(g => g.id === id);
    if (!base) return null;
    return { ...base, vfs: JSON.parse(vfsStr) };
  }

  $('#btn-open-game').onclick = openFilePicker;
  $('#btn-open-game-lib').onclick = openFilePicker;
  $('#btn-browse-library').onclick = () => navigate('library');

  // Drag-and-drop on body
  document.body.ondragover = (e) => { e.preventDefault(); document.body.classList.add('drag-over'); };
  document.body.ondragleave = () => document.body.classList.remove('drag-over');
  document.body.ondrop = async (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) await handleGameFile(file);
  };

  // ── Launch flow ──
  function promptLaunch(meta) {
    pendingGameMeta = meta;
    $('#modal-game-name-display').textContent = meta.name;
    selectedServerId = null;
    _lobbyList = [];
    _selectedLobbyId = null;
  
    // Reset mode
    $$('input[name="play-mode"]').forEach(r => r.checked = r.value === 'singleplayer');
    $('#server-select-section').style.display = 'none';
    _hideLobbySection();
  
    renderModalServers();
    showModal('modal-server');
  
    // Ping servers
    const servers = LorldStorage.getServers();
    if (servers.length > 0) {
      LorldServer.pingAll(servers).then(statuses => {
        serverStatuses = statuses;
        updateServerDots(statuses, 'mdot_');
      });
    }
  }

  $$('input[name="play-mode"]').forEach(radio => {
    radio.onchange = () => {
      const multiplayer = radio.value === 'multiplayer';
      $('#server-select-section').style.display = multiplayer ? 'block' : 'none';
      if (!multiplayer) _hideLobbySection();
    };
  });


  $('#modal-cancel').onclick = () => { pendingGameMeta = null; closeModal(); };
  $('#modal-launch').onclick = () => {
    const mode = $('input[name="play-mode"]:checked')?.value || 'singleplayer';
    if (mode === 'multiplayer' && !selectedServerId) {
      LorldUI.showNotification('Please select a server host', 'error');
      return;
    }
    const server = mode === 'multiplayer' ? LorldStorage.getServers().find(s => s.id === selectedServerId) : null;
    closeModal();
    launchGame(pendingGameMeta, server);
  };

  function renderModalServers() {
    const list = $('#modal-server-list');
    list.innerHTML = '';
    const servers = LorldStorage.getServers();
    if (servers.length === 0) {
      list.innerHTML = '<div class="empty-state" style="padding:1rem;font-size:0.85rem;">No server hosts added yet. Add one in Settings.</div>';
      return;
    }
    servers.forEach(s => {
      const el = LorldUI.renderModalServerItem(s, {
        function _onServerSelected(serverId) {
          selectedServerId = serverId;
          $$('.modal-server-item').forEach(i => i.classList.remove('selected'));
          const listEl = $('#modal-server-list');
          listEl.querySelector(`[data-id="${serverId}"]`)?.classList.add('selected');
        
          // Load lobby list for this server + game
          _loadAndRenderLobbies(serverId);
        }
    });
  }

  // ── Launch game ──
  function launchGame(meta, server) {
    if (!meta || !meta.vfs) {
      // Try to reload from session
      const full = getFullMeta(meta.id);
      if (!full) {
        LorldUI.showNotification('Game data not in memory. Please re-open the file.', 'error');
        return;
      }
      meta = full;
    }

    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = LorldLibrary.buildGameBlob(meta);

    const frame = $('#game-frame');
    frame.src = currentBlobUrl;

    // Init game once iframe loads
    frame.onload = () => {
      const username = LorldStorage.getUsername();
      const roomId = 'room_' + meta.id + '_' + (server ? 'multi' : 'single');
      frame.contentWindow.postMessage({
        lorlInit: {
          serverUrl: server ? server.url : null,
          roomId,
          username,
        }
      }, '*');
    };

    $('#game-title-display').textContent = meta.name;
    $('#game-server-label').textContent = server ? `🌐 ${server.name}` : '👤 Singleplayer';
    $('#game-players-label').textContent = '';

    LorldStorage.addRecent(meta.id);
    navigate('game');
  }

  $('#btn-exit-game').onclick = () => {
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
    $('#game-frame').src = 'about:blank';
    navigate('home');
  };

  // Listen for player count updates from game
  window.addEventListener('message', (e) => {
    if (e.data && e.data.lorlPlayerCount !== undefined) {
      $('#game-players-label').textContent = `👥 ${e.data.lorlPlayerCount} players`;
    }
  });

  // ── Home / Recent ──
  function renderRecent() {
    const container = $('#recent-games');
    container.innerHTML = '';
    const recent = LorldStorage.getRecent();
    const library = LorldStorage.getLibrary();
    const recentGames = recent.map(id => library.find(g => g.id === id)).filter(Boolean).slice(0, 8);

    if (recentGames.length === 0) {
      container.innerHTML = '<div class="empty-state">No games played yet. Open a .lorlgame file to get started!</div>';
      return;
    }
    recentGames.forEach(meta => {
      const card = LorldUI.renderGameCard(meta, {
        onPlay: (m) => {
          const full = getFullMeta(m.id);
          if (!full) { LorldUI.showNotification('Re-open the game file to play again.', 'error'); return; }
          promptLaunch(full);
        }
      });
      container.appendChild(card);
    });
  }

  // ── Library ──
  function renderLibrary() {
    const container = $('#library-games');
    container.innerHTML = '';
    const library = LorldStorage.getLibrary();
    if (library.length === 0) {
      container.innerHTML = '<div class="empty-state">Your library is empty.<br>Open a .lorlgame file to add games.</div>';
      return;
    }
    library.forEach(meta => {
      const card = LorldUI.renderGameCard(meta, {
        onPlay: (m) => {
          const full = getFullMeta(m.id);
          if (!full) { LorldUI.showNotification('Re-open the game file to play.', 'error'); return; }
          promptLaunch(full);
        },
        onRemove: (m) => {
          if (confirm(`Remove "${m.name}" from library?`)) {
            LorldStorage.removeFromLibrary(m.id);
            renderLibrary();
          }
        }
      });
      container.appendChild(card);
    });
  }

  // ── Settings ──
  function renderSettings() {
    renderServerList();
  }

  function renderServerList() {
    const list = $('#server-list');
    list.innerHTML = '';
    const servers = LorldStorage.getServers();
    if (servers.length === 0) {
      list.innerHTML = '<div style="color:var(--text2);font-size:0.85rem;margin-bottom:1rem;">No server hosts added yet.</div>';
    } else {
      servers.forEach(s => {
        const el = LorldUI.renderServerItem(s, {
          onRemove: (id) => {
            LorldStorage.removeServer(id);
            renderServerList();
          }
        });
        list.appendChild(el);
      });
      // Ping all
      LorldServer.pingAll(servers).then(statuses => {
        updateServerDots(statuses, 'dot_');
      });
    }
  }

  function updateServerDots(statuses, prefix) {
    Object.entries(statuses).forEach(([id, status]) => {
      const dot = document.getElementById(prefix + id);
      if (dot) dot.classList.toggle('online', status.online);
    });
  }

  $('#add-server-btn').onclick = () => {
    const name = $('#server-name-input').value.trim();
    const url = $('#server-url-input').value.trim();
    if (!name || !url) { LorldUI.showNotification('Please enter a name and URL', 'error'); return; }
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      LorldUI.showNotification('URL must start with ws:// or wss://', 'error'); return;
    }
    LorldStorage.addServer(name, url);
    $('#server-name-input').value = '';
    $('#server-url-input').value = '';
    renderServerList();
    LorldUI.showNotification('Server added!', 'success');
  };

  $('#clear-library').onclick = () => {
    if (confirm('Clear all games from library?')) {
      LorldStorage.clearLibrary();
      renderLibrary();
      LorldUI.showNotification('Library cleared.', 'info');
    }
  };

  $('#clear-all').onclick = () => {
    if (confirm('Reset everything? This will clear all settings, servers, and library.')) {
      LorldStorage.resetAll();
      refreshUsername();
      renderSettings();
      LorldUI.showNotification('Everything reset.', 'info');
    }
  };

  let _lobbyList = [];
  let _selectedLobbyId = null;
  let _createLobbyMode = false;
  
  function _hideLobbySection() {
    const s = $('#lobby-browser-section');
    if (s) s.style.display = 'none';
  }
  
  function _showLobbySection() {
    const s = $('#lobby-browser-section');
    if (s) s.style.display = 'block';
  }
  
  async function _loadAndRenderLobbies(serverId) {
    const server = LorldStorage.getServers().find(s => s.id === serverId);
    if (!server || !pendingGameMeta) return;
  
    _showLobbySection();
    const lobbyListEl = $('#lobby-browser-list');
    if (lobbyListEl) lobbyListEl.innerHTML = '<div class="lobby-loading">Loading lobbies…</div>';
  
    try {
      // Use HTTP endpoint to list public lobbies
      const httpUrl = server.url.replace(/^wss?:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
      const res = await fetch(`${httpUrl}/lobbies?game=${encodeURIComponent(pendingGameMeta.id)}`, { signal: AbortSignal.timeout(5000) });
      const json = await res.json();
      _lobbyList = json.lobbies || [];
    } catch (_) {
      _lobbyList = [];
    }
  
    _renderLobbyBrowser();
  }
  
  function _renderLobbyBrowser() {
    const container = $('#lobby-browser-list');
    if (!container) return;
  
    if (_lobbyList.length === 0 && !_createLobbyMode) {
      container.innerHTML = `
        <div class="lobby-empty">
          <div class="lobby-empty-icon">🏠</div>
          <div class="lobby-empty-text">No public lobbies found</div>
          <div class="lobby-empty-sub">Create one below, or join a private lobby by ID</div>
        </div>`;
    } else {
      container.innerHTML = '';
      _lobbyList.forEach(lobby => {
        const el = document.createElement('div');
        el.className = 'lobby-item' + (_selectedLobbyId === lobby.id ? ' selected' : '');
        el.dataset.id = lobby.id;
        el.innerHTML = `
          <div class="lobby-item-name">${_escHtml(lobby.name.replace(/^PUBLIC_/, ''))}</div>
          <div class="lobby-item-meta">
            <span class="lobby-players">${lobby.playerCount}/${lobby.maxPlayers} players</span>
            <span class="lobby-id">ID: ${_escHtml(lobby.id)}</span>
          </div>`;
        el.onclick = () => {
          _selectedLobbyId = lobby.id;
          _createLobbyMode = false;
          _renderLobbyBrowser();
        };
        container.appendChild(el);
      });
    }
  }
  
  function _escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Init ──
  navigate('home');
})();
