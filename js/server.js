/**
 * server.js — Server host management and ping/status checking
 */

window.LorldServer = (() => {
  // Ping a WebSocket server to see if it's reachable
  function ping(url) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ online: false, latency: null });
      }, 4000);

      const start = Date.now();
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        clearTimeout(timeout);
        resolve({ online: false, latency: null });
        return;
      }

      ws.onopen = () => {
        clearTimeout(timeout);
        const latency = Date.now() - start;
        ws.close();
        resolve({ online: true, latency });
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        resolve({ online: false, latency: null });
      };
    });
  }

  async function pingAll(servers) {
    const results = {};
    await Promise.all(servers.map(async (s) => {
      const r = await ping(s.url);
      results[s.id] = r;
    }));
    return results;
  }

  return { ping, pingAll };
})();
