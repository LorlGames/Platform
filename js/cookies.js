/**
 * cookies.js — Simple cookie-based storage for Lorl
 * All persistent data (settings, server hosts, library) stored in cookies
 * and localStorage (cookies for small data, localStorage for game blobs)
 */

window.LorldStorage = (() => {
  const KEYS = {
    USERNAME: 'lorl_username',
    SERVERS: 'lorl_servers',
    LIBRARY: 'lorl_library',
    RECENT: 'lorl_recent',
  };

  function setCookie(name, value, days = 365) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`;
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function delCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  }

  // JSON helpers
  function setJSON(key, data) {
    const s = JSON.stringify(data);
    try {
      localStorage.setItem(key, s);
      setCookie(key + '_flag', '1'); // flag that data exists
    } catch (e) {
      setCookie(key, s);
    }
  }

  function getJSON(key) {
    try {
      const ls = localStorage.getItem(key);
      if (ls) return JSON.parse(ls);
    } catch (_) {}
    const c = getCookie(key);
    if (c) { try { return JSON.parse(c); } catch (_) {} }
    return null;
  }

  function delJSON(key) {
    localStorage.removeItem(key);
    delCookie(key);
    delCookie(key + '_flag');
  }

  // ── USERNAME ──
  function getUsername() {
    return getCookie(KEYS.USERNAME) || localStorage.getItem(KEYS.USERNAME) || 'Guest';
  }
  function setUsername(name) {
    const clean = name.trim().slice(0, 24) || 'Guest';
    setCookie(KEYS.USERNAME, clean);
    localStorage.setItem(KEYS.USERNAME, clean);
    return clean;
  }

  // ── SERVERS ──
  function getServers() {
    return getJSON(KEYS.SERVERS) || [];
  }
  function saveServers(servers) {
    setJSON(KEYS.SERVERS, servers);
  }
  function addServer(name, url) {
    const servers = getServers();
    const id = 'srv_' + Date.now();
    servers.push({ id, name: name.trim(), url: url.trim() });
    saveServers(servers);
    return id;
  }
  function removeServer(id) {
    const servers = getServers().filter(s => s.id !== id);
    saveServers(servers);
  }

  // ── LIBRARY ──
  function getLibrary() {
    return getJSON(KEYS.LIBRARY) || [];
  }
  function saveLibrary(lib) {
    setJSON(KEYS.LIBRARY, lib);
  }
  function addToLibrary(meta) {
    const lib = getLibrary();
    const existing = lib.findIndex(g => g.id === meta.id);
    if (existing >= 0) lib[existing] = meta;
    else lib.push(meta);
    saveLibrary(lib);
  }
  function removeFromLibrary(id) {
    saveLibrary(getLibrary().filter(g => g.id !== id));
    try { localStorage.removeItem('lorl_game_' + id); } catch (_) {}
  }
  function clearLibrary() {
    const lib = getLibrary();
    lib.forEach(g => { try { localStorage.removeItem('lorl_game_' + g.id); } catch (_) {} });
    delJSON(KEYS.LIBRARY);
  }

  // ── RECENT ──
  function getRecent() {
    return getJSON(KEYS.RECENT) || [];
  }
  function addRecent(id) {
    let recent = getRecent().filter(r => r !== id);
    recent.unshift(id);
    recent = recent.slice(0, 10);
    setJSON(KEYS.RECENT, recent);
  }

  // ── GAME DATA ──
  function saveGameData(id, data) {
    // data is a base64 string of the zip contents
    try { localStorage.setItem('lorl_game_' + id, data); } catch (e) {
      console.warn('Game data too large for localStorage', e);
    }
  }
  function getGameData(id) {
    return localStorage.getItem('lorl_game_' + id);
  }

  // ── RESET ──
  function resetAll() {
    Object.values(KEYS).forEach(k => delJSON(k));
    delCookie(KEYS.USERNAME);
    localStorage.removeItem(KEYS.USERNAME);
    // clear all game data
    Object.keys(localStorage).filter(k => k.startsWith('lorl_')).forEach(k => localStorage.removeItem(k));
  }

  return {
    getUsername, setUsername,
    getServers, addServer, removeServer,
    getLibrary, addToLibrary, removeFromLibrary, clearLibrary,
    getRecent, addRecent,
    saveGameData, getGameData,
    resetAll,
  };
})();
