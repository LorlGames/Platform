/**
 * library.js — Lorl SDK
 *
 * Provides multiplayer connectivity including the lobby system.
 * Injected into every exported game's index.html.
 *
 * Public API (window.Lorl):
 *
 *   Core
 *     connect(serverUrl, roomId, username) → playerId   [legacy room join]
 *     disconnect()
 *     isConnected() → bool
 *     getPlayerId() → string
 *     getUsername() → string
 *     isHost() → bool
 *     getPlayers() → [{id, username, data}]
 *     getState(playerId) → data object
 *     updateState(data)
 *     sendMessage(event, data)
 *     on(event, handler)
 *     off(event, handler)
 *
 *   Lobbies
 *     createLobby(opts)  → Promise<lobbyInfo>
 *       opts: { serverUrl, gameId, lobbyId?, lobbyName, maxPlayers?, username }
 *       • lobbyName starting with "PUBLIC_" → publicly listed
 *     joinLobby(opts)    → Promise<lobbyState>
 *       opts: { serverUrl, gameId, lobbyId, username }
 *     leaveLobby()
 *     listLobbies(opts)  → Promise<lobby[]>
 *       opts: { serverUrl, gameId }
 *     kickFromLobby(targetPlayerId)
 *     closeLobby()
 *     getLobbyInfo()     → current lobby meta or null
 *
 *   Events emitted (via Lorl.on):
 *     'ready'             — { multiplayer: bool }
 *     'connected'         — { playerId }
 *     'disconnected'      — {}
 *     'error'             — Error
 *     'playerJoined'      — { id, username }
 *     'playerLeft'        — { id, username, reason }
 *     'playerUpdated'     — { id, data }
 *     'roomState'         — { players }       [legacy]
 *     'message'           — { from, event, data }
 *     'lobbyCreated'      — lobbyInfo
 *     'lobbyJoined'       — { lobbyId, lobbyName, players, ownerId }
 *     'lobbyLeft'         — {}
 *     'lobbyKicked'       — { reason }
 *     'lobbyClosed'       — {}
 *     'lobbyOwnerChanged' — { newOwnerId }
 *     'lobbyList'         — { lobbies: [] }
 */

(function () {
  'use strict';

  // ── Internal state ──────────────────────────────────────────────────
  let _ws         = null;
  let _connected  = false;
  let _playerId   = null;
  let _username   = 'Player';
  let _gameId     = null;
  let _roomId     = null;
  let _players    = {};   // id → {id, username, data}
  let _lobbyInfo  = null; // current lobby meta or null
  let _isHost     = false;
  const _handlers = {};   // event → [handlers]

  // ── Event emitter ───────────────────────────────────────────────────
  function emit(event, data) {
    (_handlers[event] || []).forEach(fn => { try { fn(data); } catch (e) { console.error('[Lorl] handler error', e); } });
  }

  function on(event, handler) {
    if (!_handlers[event]) _handlers[event] = [];
    _handlers[event].push(handler);
  }

  function off(event, handler) {
    if (!_handlers[event]) return;
    _handlers[event] = _handlers[event].filter(h => h !== handler);
  }

  // ── Low-level WebSocket connect ──────────────────────────────────────
  function _openWS(serverUrl) {
    return new Promise((resolve, reject) => {
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        resolve(_ws);
        return;
      }
      // Close any stale socket
      if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }

      const ws = new WebSocket(serverUrl);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Connection timed out'));
      }, 8000);

      ws.onopen = () => {
        clearTimeout(timeout);
        _ws = ws;
        _connected = true;

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            _handleMessage(msg);
          } catch (_) {}
        };

        ws.onclose = () => {
          _connected = false;
          _lobbyInfo = null;
          _isHost    = false;
          emit('disconnected', {});
        };

        ws.onerror = (err) => {
          emit('error', err);
        };

        resolve(ws);
      };

      ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(err);
      };
    });
  }

  function _send(msg) {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      try { _ws.send(JSON.stringify(msg)); } catch (_) {}
    }
  }

  // ── Message dispatcher ───────────────────────────────────────────────
  function _handleMessage(msg) {
    switch (msg.type) {

      // ── Lobby messages ───────────────────────────────────────

      case 'lobby_created':
        _lobbyInfo = {
          lobbyId:    msg.lobbyId,
          lobbyName:  msg.lobbyName,
          isPublic:   msg.isPublic,
          maxPlayers: msg.maxPlayers,
        };
        _isHost = true;
        emit('lobbyCreated', { ..._lobbyInfo, playerId: msg.playerId });
        break;

      case 'lobby_state':
        // Sent to a player who just joined
        _players = {};
        (msg.players || []).forEach(p => { _players[p.id] = p; });
        _lobbyInfo = {
          lobbyId:    msg.lobbyId,
          lobbyName:  msg.lobbyName,
          isPublic:   msg.isPublic,
          ownerId:    msg.ownerId,
          maxPlayers: msg.maxPlayers,
        };
        _isHost = msg.ownerId === _playerId;
        emit('lobbyJoined', {
          lobbyId:   msg.lobbyId,
          lobbyName: msg.lobbyName,
          ownerId:   msg.ownerId,
          players:   Object.values(_players),
        });
        break;

      case 'lobby_player_joined':
        _players[msg.playerId] = { id: msg.playerId, username: msg.username, data: {} };
        emit('playerJoined', { id: msg.playerId, username: msg.username });
        break;

      case 'lobby_player_left':
        {
          const leaving = _players[msg.playerId];
          delete _players[msg.playerId];
          emit('playerLeft', { id: msg.playerId, username: leaving && leaving.username, reason: msg.reason });
        }
        break;

      case 'lobby_left':
        _lobbyInfo = null;
        _isHost    = false;
        _players   = {};
        emit('lobbyLeft', {});
        break;

      case 'lobby_kicked':
        _lobbyInfo = null;
        _isHost    = false;
        _players   = {};
        emit('lobbyKicked', { reason: msg.reason });
        break;

      case 'lobby_closed':
        _lobbyInfo = null;
        _isHost    = false;
        _players   = {};
        emit('lobbyClosed', {});
        break;

      case 'lobby_owner_changed':
        if (_lobbyInfo) _lobbyInfo.ownerId = msg.newOwnerId;
        _isHost = msg.newOwnerId === _playerId;
        emit('lobbyOwnerChanged', { newOwnerId: msg.newOwnerId });
        break;

      case 'lobby_list':
        emit('lobbyList', { lobbies: msg.lobbies || [] });
        break;

      // ── Shared messages ───────────────────────────────────────

      case 'state_update':
        if (_players[msg.playerId]) {
          _players[msg.playerId].data = { ..._players[msg.playerId].data, ...msg.data };
        } else {
          _players[msg.playerId] = { id: msg.playerId, username: msg.username || 'Player', data: msg.data || {} };
        }
        emit('playerUpdated', { id: msg.playerId, data: msg.data });
        break;

      case 'custom':
        emit('message', { from: msg.playerId, event: msg.event, data: msg.data });
        break;

      // ── Legacy room messages ──────────────────────────────────

      case 'player_joined':
        _players[msg.playerId] = { id: msg.playerId, username: msg.username, data: {} };
        emit('playerJoined', { id: msg.playerId, username: msg.username });
        break;

      case 'player_left':
        {
          const leaving = _players[msg.playerId];
          delete _players[msg.playerId];
          emit('playerLeft', { id: msg.playerId, username: leaving && leaving.username });
        }
        break;

      case 'room_state':
        _players = {};
        (msg.players || []).forEach(p => { _players[p.id] = p; });
        emit('roomState', { players: Object.values(_players) });
        break;

      case 'error':
        console.warn('[Lorl server error]', msg.message);
        emit('error', new Error(msg.message));
        break;

      default:
        break;
    }
  }

  // ── Lobby API ────────────────────────────────────────────────────────

  /**
   * Create a new lobby and become its owner.
   * lobbyName starting with "PUBLIC_" makes it publicly listable.
   * Returns a Promise that resolves with lobby info once created.
   */
  async function createLobby({ serverUrl, gameId, lobbyId, lobbyName = 'My Lobby', maxPlayers = 8, username }) {
    _playerId  = _playerId || ('p_' + Math.random().toString(36).slice(2, 9));
    _username  = username || _username;
    _gameId    = gameId;

    await _openWS(serverUrl);
    emit('connected', { playerId: _playerId });

    return new Promise((resolve, reject) => {
      const onCreated = (info) => { off('lobbyCreated', onCreated); off('error', onErr); resolve(info); };
      const onErr     = (err)  => { off('lobbyCreated', onCreated); off('error', onErr); reject(err); };
      on('lobbyCreated', onCreated);
      on('error', onErr);

      _send({
        type:       'lobby_create',
        gameId,
        lobbyId:    lobbyId || undefined,
        lobbyName,
        maxPlayers,
        playerId:   _playerId,
        username:   _username,
      });
    });
  }

  /**
   * Join an existing lobby by ID.
   * Returns a Promise that resolves with the lobby state (players list etc.).
   */
  async function joinLobby({ serverUrl, gameId, lobbyId, username }) {
    _playerId = _playerId || ('p_' + Math.random().toString(36).slice(2, 9));
    _username = username || _username;
    _gameId   = gameId;

    await _openWS(serverUrl);
    emit('connected', { playerId: _playerId });

    return new Promise((resolve, reject) => {
      const onJoined = (state) => { off('lobbyJoined', onJoined); off('error', onErr); resolve(state); };
      const onErr    = (err)   => { off('lobbyJoined', onJoined); off('error', onErr); reject(err); };
      on('lobbyJoined', onJoined);
      on('error', onErr);

      _send({
        type:     'lobby_join',
        gameId,
        lobbyId,
        playerId: _playerId,
        username: _username,
      });
    });
  }

  /** Leave the current lobby. */
  function leaveLobby() {
    _send({ type: 'lobby_leave' });
    _lobbyInfo = null;
    _isHost    = false;
    _players   = {};
  }

  /**
   * List publicly visible lobbies for a game.
   * Sends lobby_list request; resolves when server responds.
   */
  async function listLobbies({ serverUrl, gameId }) {
    await _openWS(serverUrl);
    return new Promise((resolve) => {
      const onList = ({ lobbies }) => { off('lobbyList', onList); resolve(lobbies); };
      on('lobbyList', onList);
      _send({ type: 'lobby_list', gameId });
      // Timeout after 5s with empty array
      setTimeout(() => { off('lobbyList', onList); resolve([]); }, 5000);
    });
  }

  /** Kick a player (owner only). */
  function kickFromLobby(targetPlayerId) {
    _send({ type: 'lobby_kick', targetId: targetPlayerId });
  }

  /** Close the lobby (owner only). */
  function closeLobby() {
    _send({ type: 'lobby_close' });
  }

  /** Get current lobby metadata, or null if not in a lobby. */
  function getLobbyInfo() {
    return _lobbyInfo ? { ..._lobbyInfo } : null;
  }

  // ── Legacy room API (backwards compat) ────────────────────────────────

  function connect(serverUrl, roomId, username) {
    _playerId = _playerId || ('p_' + Math.random().toString(36).slice(2, 9));
    _username = username || _username;
    _roomId   = roomId;

    const ws = new WebSocket(serverUrl);
    _ws = ws;
    ws.onopen = () => {
      _connected = true;
      _send({
        type:     'join',
        gameId:   _gameId || 'unknown',
        roomId:   _roomId,
        playerId: _playerId,
        username: _username,
      });
      emit('connected', { playerId: _playerId });
    };
    ws.onmessage = (e) => {
      try { _handleMessage(JSON.parse(e.data)); } catch (_) {}
    };
    ws.onclose = () => {
      _connected = false;
      emit('disconnected', {});
    };
    ws.onerror = (err) => { emit('error', err); };
    return _playerId;
  }

  function disconnect() {
    if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }
    _connected = false;
    _lobbyInfo = null;
    _isHost    = false;
  }

  // ── Shared API ───────────────────────────────────────────────────────

  function updateState(data) {
    _send({ type: 'state_update', playerId: _playerId, data });
  }

  function sendMessage(event, data) {
    _send({ type: 'custom', playerId: _playerId, event, data });
  }

  function getPlayers()     { return Object.values(_players); }
  function getPlayerId()    { return _playerId; }
  function getUsername()    { return _username; }
  function isConnected()    { return _connected; }
  function isHost()         { return _isHost; }
  function myId()           { return _playerId; }
  function getState(pid)    { return (_players[pid] && _players[pid].data) || {}; }

  // ── Platform init hook ───────────────────────────────────────────────
  /**
   * Called by the Lorl platform after the game iframe loads.
   * lobbyCtx: { createLobby: { lobbyName, maxPlayers } } | { joinLobbyId: string } | null
   */
  function _init(serverUrl, roomId, username, gameId, lobbyCtx) {
    _gameId   = gameId || 'unknown';
    _username = username || 'Player';

    // Expose for lobby blocks in generated game code
    window.__lorlServerUrl = serverUrl || null;
    window.__lorlGameId    = _gameId;

    if (!serverUrl) {
      emit('ready', { multiplayer: false });
      return;
    }

    if (lobbyCtx && lobbyCtx.createLobby) {
      // Platform asked us to create a lobby on game start
      createLobby({
        serverUrl,
        gameId:     _gameId,
        lobbyName:  lobbyCtx.createLobby.lobbyName  || 'My Lobby',
        maxPlayers: lobbyCtx.createLobby.maxPlayers || 8,
        username,
      })
        .then(() => emit('ready', { multiplayer: true }))
        .catch((err) => {
          console.warn('[Lorl] createLobby failed, falling back to legacy room:', err);
          connect(serverUrl, roomId, username);
          emit('ready', { multiplayer: true });
        });
    } else if (lobbyCtx && lobbyCtx.joinLobbyId) {
      // Platform asked us to join a specific lobby
      joinLobby({
        serverUrl,
        gameId:  _gameId,
        lobbyId: lobbyCtx.joinLobbyId,
        username,
      })
        .then(() => emit('ready', { multiplayer: true }))
        .catch((err) => {
          console.warn('[Lorl] joinLobby failed, falling back to legacy room:', err);
          connect(serverUrl, roomId, username);
          emit('ready', { multiplayer: true });
        });
    } else {
      // Legacy direct-room join (backwards compatible)
      connect(serverUrl, roomId, username);
      emit('ready', { multiplayer: true });
    }
  }

  // ── Expose ────────────────────────────────────────────────────────────
  window.Lorl = {
    // Legacy
    connect, disconnect,
    updateState, sendMessage,
    getPlayers, getPlayerId, getUsername, isConnected,

    // Lobby
    createLobby, joinLobby, leaveLobby, listLobbies,
    kickFromLobby, closeLobby, getLobbyInfo,

    // Helpers
    isHost, myId, getState,

    // Events
    on, off,

    // Platform internal
    _init,
  };

})();
