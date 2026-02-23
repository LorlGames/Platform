/**
 * library.js — Handles loading, parsing, and storing .lorlgame files
 * A .lorlgame is a ZIP containing:
 *   - manifest.json  (required)
 *   - index.html     (required – the game entry point)
 *   - [any other assets]
 */

window.LorldLibrary = (() => {
  // ── JSZip loader (CDN, loaded lazily) ──
  let _jszip = null;
  async function getJSZip() {
    if (_jszip) return _jszip;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = () => { _jszip = window.JSZip; resolve(_jszip); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // ── Load file from File object ──
  async function loadFromFile(file) {
    const JSZip = await getJSZip();
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Read manifest
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) throw new Error('Invalid .lorlgame: missing manifest.json');
    const manifest = JSON.parse(await manifestFile.async('string'));

    if (!manifest.id) throw new Error('manifest.json must have an "id" field');
    if (!manifest.name) throw new Error('manifest.json must have a "name" field');

    // Read index.html
    const indexFile = zip.file('index.html');
    if (!indexFile) throw new Error('Invalid .lorlgame: missing index.html');

    // Extract all files into a virtual FS (base64 or text)
    const vfs = {};
    const fileNames = Object.keys(zip.files);
    for (const fname of fileNames) {
      const zipEntry = zip.files[fname];
      if (zipEntry.dir) continue;
      const ext = fname.split('.').pop().toLowerCase();
      const textTypes = ['html', 'js', 'css', 'json', 'txt', 'md', 'svg'];
      if (textTypes.includes(ext)) {
        vfs[fname] = { type: 'text', content: await zipEntry.async('string') };
      } else {
        const b64 = await zipEntry.async('base64');
        const mime = getMime(ext);
        vfs[fname] = { type: 'binary', content: b64, mime };
      }
    }

    // Build the game meta
    const meta = {
      id: manifest.id,
      name: manifest.name,
      author: manifest.author || 'Unknown',
      description: manifest.description || '',
      version: manifest.version || '1.0.0',
      icon: manifest.icon || null,
      lorlVersion: manifest.lorlVersion || '1',
      addedAt: Date.now(),
      vfs, // Virtual file system
    };

    return meta;
  }

  // ── Get inline data URI for an asset ──
  function resolveAsset(meta, path) {
    const entry = meta.vfs[path];
    if (!entry) return null;
    if (entry.type === 'text') {
      const enc = encodeURIComponent(entry.content);
      return 'data:text/plain;charset=utf-8,' + enc;
    } else {
      return `data:${entry.mime};base64,${entry.content}`;
    }
  }

  // ── Build a blob URL for the game's index.html ──
  // Rewrites relative asset references to data URIs
  function buildGameBlob(meta) {
    let html = meta.vfs['index.html'].content;

    // Inject Lorl SDK before anything else
    const sdk = buildSDKScript(meta);
    html = html.replace('<head>', '<head>' + sdk);

    // Replace src/href with data URIs for known assets
    html = html.replace(/(src|href)=["']([^"'#?]+)["']/g, (match, attr, path) => {
      if (path.startsWith('http') || path.startsWith('data:') || path.startsWith('//')) return match;
      const asset = meta.vfs[path];
      if (!asset) return match;
      if (asset.type === 'text') {
        const ext = path.split('.').pop().toLowerCase();
        let mime = 'text/plain';
        if (ext === 'js') mime = 'application/javascript';
        if (ext === 'css') mime = 'text/css';
        if (ext === 'html') mime = 'text/html';
        const blob = new Blob([asset.content], { type: mime });
        return `${attr}="${URL.createObjectURL(blob)}"`;
      } else {
        return `${attr}="data:${asset.mime};base64,${asset.content}"`;
      }
    });

    // Also handle CSS url() references
    html = html.replace(/url\(['"]?([^'")\s]+)['"]?\)/g, (match, path) => {
      if (path.startsWith('http') || path.startsWith('data:')) return match;
      const asset = meta.vfs[path];
      if (!asset || asset.type !== 'binary') return match;
      return `url("data:${asset.mime};base64,${asset.content}")`;
    });

    const blob = new Blob([html], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }

  // ── Build the SDK script tag to inject ──
  function buildSDKScript(meta) {
    const sdkCode = `
<script>
(function() {
  // ── LORL SDK ──
  // Available as window.Lorl inside the game
  
  const _listeners = {};
  const _state = {};
  let _ws = null;
  let _playerId = null;
  let _serverUrl = null;
  let _gameId = ${JSON.stringify(meta.id)};
  let _roomId = null;
  let _connected = false;
  let _players = {};
  let _username = null;

  function on(event, cb) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(cb);
  }
  function off(event, cb) {
    if (!_listeners[event]) return;
    _listeners[event] = _listeners[event].filter(f => f !== cb);
  }
  function emit(event, data) {
    (_listeners[event] || []).forEach(cb => { try { cb(data); } catch(e) { console.error(e); } });
  }

  // ── Connect to server ──
  function connect(serverUrl, roomId, username) {
    _serverUrl = serverUrl;
    _roomId = roomId || 'default';
    _username = username || 'Guest';
    _playerId = 'p_' + Math.random().toString(36).slice(2,9);

    _ws = new WebSocket(serverUrl);
    _ws.onopen = () => {
      _connected = true;
      _ws.send(JSON.stringify({
        type: 'join',
        gameId: _gameId,
        roomId: _roomId,
        playerId: _playerId,
        username: _username,
      }));
      emit('connected', { playerId: _playerId });
    };
    _ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleMessage(msg);
      } catch(_) {}
    };
    _ws.onclose = () => {
      _connected = false;
      emit('disconnected', {});
    };
    _ws.onerror = (err) => {
      emit('error', err);
    };
    return _playerId;
  }

  function handleMessage(msg) {
    switch(msg.type) {
      case 'player_joined':
        _players[msg.playerId] = { id: msg.playerId, username: msg.username, data: {} };
        emit('playerJoined', _players[msg.playerId]);
        break;
      case 'player_left':
        const leaving = _players[msg.playerId];
        delete _players[msg.playerId];
        emit('playerLeft', { id: msg.playerId, username: leaving && leaving.username });
        break;
      case 'state_update':
        if (_players[msg.playerId]) {
          _players[msg.playerId].data = { ..._players[msg.playerId].data, ...msg.data };
        } else {
          _players[msg.playerId] = { id: msg.playerId, username: msg.username || 'Player', data: msg.data };
        }
        emit('playerUpdated', { id: msg.playerId, data: msg.data });
        break;
      case 'room_state':
        // Full room state dump on join
        msg.players.forEach(p => {
          _players[p.id] = p;
        });
        emit('roomState', { players: Object.values(_players) });
        break;
      case 'custom':
        emit('message', { from: msg.playerId, event: msg.event, data: msg.data });
        break;
    }
  }

  // ── Send player state update ──
  function updateState(data) {
    if (!_connected || !_ws) return;
    _ws.send(JSON.stringify({ type: 'state_update', playerId: _playerId, data }));
  }

  // ── Send a custom message ──
  function sendMessage(event, data) {
    if (!_connected || !_ws) return;
    _ws.send(JSON.stringify({ type: 'custom', playerId: _playerId, event, data }));
  }

  // ── Get all players ──
  function getPlayers() { return Object.values(_players); }
  function getPlayerId() { return _playerId; }
  function isConnected() { return _connected; }
  function getUsername() { return _username; }

  // ── Disconnect ──
  function disconnect() {
    if (_ws) _ws.close();
  }

  window.Lorl = {
    connect, disconnect,
    updateState, sendMessage,
    getPlayers, getPlayerId, isConnected, getUsername,
    on, off,
    // Utility: called by Lorl platform to init multiplayer
    _init(serverUrl, roomId, username) {
      if (serverUrl) connect(serverUrl, roomId, username);
      emit('ready', { multiplayer: !!serverUrl, serverUrl, roomId, username });
    },
  };

  // ── Receive init from parent ──
  window.addEventListener('message', (e) => {
    if (e.data && e.data.lorlInit) {
      const { serverUrl, roomId, username } = e.data.lorlInit;
      window.Lorl._init(serverUrl, roomId, username);
    }
  });

  // Tell parent we're ready
  window.addEventListener('load', () => {
    window.parent.postMessage({ lorlReady: true }, '*');
  });
})();
<\/script>`;
    return sdkCode;
  }

  function getMime(ext) {
    const map = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
      mp4: 'video/mp4', webm: 'video/webm',
      woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
      json: 'application/json',
    };
    return map[ext] || 'application/octet-stream';
  }

  return { loadFromFile, buildGameBlob, resolveAsset };
})();
