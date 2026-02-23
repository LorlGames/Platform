/**
 * ui.js — Rendering helpers for Lorl UI
 */

window.LorldUI = (() => {
  function renderGameCard(meta, { onPlay, onRemove } = {}) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.dataset.id = meta.id;

    const iconHtml = meta.icon
      ? `<img src="${meta.icon}" class="game-card-icon-img" style="width:48px;height:48px;object-fit:contain;border-radius:8px;" alt="">`
      : `<div class="game-card-icon">🎮</div>`;

    card.innerHTML = `
      ${iconHtml}
      <div class="game-card-name">${escHtml(meta.name)}</div>
      <div class="game-card-author">${escHtml(meta.author)}</div>
      <div class="game-card-desc">${escHtml(meta.description)}</div>
      <div class="game-card-actions"></div>
    `;

    const actions = card.querySelector('.game-card-actions');
    if (onPlay) {
      const playBtn = document.createElement('button');
      playBtn.className = 'btn-primary small';
      playBtn.textContent = 'Play';
      playBtn.onclick = (e) => { e.stopPropagation(); onPlay(meta); };
      actions.appendChild(playBtn);
    }
    if (onRemove) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-secondary small';
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = (e) => { e.stopPropagation(); onRemove(meta); };
      actions.appendChild(removeBtn);
    }

    return card;
  }

  function renderServerItem(server, { onRemove, statusDot } = {}) {
    const item = document.createElement('div');
    item.className = 'server-item';
    item.id = 'srv_item_' + server.id;

    const dot = document.createElement('div');
    dot.className = 'server-dot';
    dot.id = 'dot_' + server.id;

    const name = document.createElement('div');
    name.className = 'server-name';
    name.textContent = server.name;

    const url = document.createElement('div');
    url.className = 'server-url';
    url.textContent = server.url;

    item.appendChild(dot);
    item.appendChild(name);
    item.appendChild(url);

    if (onRemove) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'server-remove';
      removeBtn.textContent = '✕';
      removeBtn.title = 'Remove server';
      removeBtn.onclick = () => onRemove(server.id);
      item.appendChild(removeBtn);
    }

    return item;
  }

  function renderModalServerItem(server, { onSelect, selected } = {}) {
    const item = document.createElement('div');
    item.className = 'modal-server-item' + (selected ? ' selected' : '');
    item.dataset.id = server.id;

    item.innerHTML = `
      <div class="server-dot" id="mdot_${server.id}"></div>
      <div>
        <div class="server-name">${escHtml(server.name)}</div>
        <div class="server-url">${escHtml(server.url)}</div>
      </div>
    `;
    item.onclick = () => onSelect && onSelect(server.id);
    return item;
  }

  function showNotification(msg, type = 'info') {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed; bottom:1.5rem; right:1.5rem; z-index:9999;
      background:${type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#7c3aed'};
      color:#fff; padding:0.75rem 1.25rem; border-radius:10px;
      font-family:'Syne',sans-serif; font-weight:600; font-size:0.9rem;
      box-shadow:0 4px 20px rgba(0,0,0,0.4); animation:fadeIn 0.2s ease;
      max-width:320px;
    `;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  return { renderGameCard, renderServerItem, renderModalServerItem, showNotification, escHtml };
})();
