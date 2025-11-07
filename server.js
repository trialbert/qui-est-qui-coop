// server.js — version propre (coop + pseudos + curseurs)

const path = require('path');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",   // ou "https://www.tristan-albert.com" si tu veux restreindre
    methods: ["GET", "POST"]
  }
});

// Sert ton front (index.html, script.js, assets, cards.json…)
app.use(express.static(path.join(__dirname)));

// ---- ÉTAT PARTAGÉ SIMPLE ----
const state = {
  families: {},   // { [familyKey]: [cardId, ...] }
  zooms: {},      // { [cardId]: { zoomed: true, by: socketId } | { zoomed:false } }
  infosFound: {}  // { [cardId]: { auteur:true, date:true, ... } }
};

function recomputeCounters() {
  const placed = Object.values(state.families).reduce((n, arr) => n + ((arr && arr.length) || 0), 0);
  const infos = Object.values(state.infosFound).reduce((n, obj) => {
    if (!obj) return n;
    return n + Object.values(obj).filter(Boolean).length;
  }, 0);
  return { placed, infos };
}

// ---- JOUEURS / PSEUDOS / CURSORS ----
const COLORS = ['#ff6b6b','#feca57','#48dbfb','#1dd1a1','#5f27cd','#ff9ff3','#ff9f43','#8395a7'];
let nextColorIndex = 0;

const players = {}; // { socketId: { name, color } }

let playerCount = 0;

function ensurePlayer(socketId) {
  if (!players[socketId]) {
    const color = COLORS[nextColorIndex++ % COLORS.length];
    const number = ++playerCount;
    players[socketId] = { name: String(number), color }; // "1", "2", "3"…
  }
  return players[socketId];
}

// Compte robuste des connexions
function getConnectedCount() {
  if (io.of && io.of('/').sockets && typeof io.of('/').sockets.size === 'number') {
    return io.of('/').sockets.size;
  }
  if (io.sockets && io.sockets.sockets && typeof io.sockets.sockets.size === 'number') {
    return io.sockets.sockets.size;
  }
  if (io.engine && typeof io.engine.clientsCount === 'number') {
    return io.engine.clientsCount;
  }
  return 0;
}

function broadcastPresence() {
  io.emit('presence', getConnectedCount());
}

// ---- SOCKETS ----
io.on('connection', (socket) => {
  console.log('🔌 Nouveau client', socket.id);

  // crée une entrée joueur par défaut
  ensurePlayer(socket.id);
  broadcastPresence();

  // Le client demandera l'état quand il est prêt
  socket.on('client:ready', () => {
    console.log('📦 client:ready de', socket.id);
    socket.emit('state:init', {
      families:   state.families,
      zooms:      state.zooms,
      infosFound: state.infosFound,
      counters:   recomputeCounters()
    });

    // envoyer la liste des joueurs déjà présents
    socket.emit('players:init', players);
  });

  // Déplacements partagés
  socket.on('moveToFamily', ({ cardId, family, posX, posY }) => {
    console.log('➡️ moveToFamily', cardId, '→', family, 'de', socket.id, 'at', posX, posY);
    if (!cardId || !family) return;

      // Déplacements vers la pioche (draw)
  socket.on('moveToDraw', ({ cardId, posX, posY }) => {
    console.log('🎯 moveToDraw', cardId, 'de', socket.id, 'at', posX, posY);
    if (!cardId) return;

    // retirer la carte de toutes les familles
    Object.keys(state.families).forEach((f) => {
      const list = state.families[f] || [];
      const idx = list.indexOf(cardId);
      if (idx !== -1) list.splice(idx, 1);
    });

    // informer les autres clients
    socket.broadcast.emit('draw:moved', { cardId, posX, posY });

    // les compteurs "placed" sont basés sur state.families → on les met à jour
    io.emit('counters', recomputeCounters());
  });

    // retirer la carte des autres familles
    Object.keys(state.families).forEach((f) => {
      const list = state.families[f] || [];
      const idx = list.indexOf(cardId);
      if (idx !== -1) list.splice(idx, 1);
    });

    // ajouter à la famille cible
    if (!state.families[family]) state.families[family] = [];
    if (!state.families[family].includes(cardId)) {
      state.families[family].push(cardId);
    }

    // informer les autres clients
    socket.broadcast.emit('moved', { cardId, family, posX, posY });
    io.emit('counters', recomputeCounters());
  });

  // Zoom par carte
  socket.on('zoom:set', ({ cardId, zoomed }) => {
    console.log('🔍 zoom:set', cardId, zoomed, 'de', socket.id);
    if (!cardId) return;
    state.zooms[cardId] = zoomed ? { zoomed: true, by: socket.id } : { zoomed: false };
    io.emit('zoom:update', { cardId, zoomed: !!zoomed });
  });

    // Infos trouvées (date / auteur / titre)
  socket.on('info:found', ({ cardId, field }) => {
    if (!cardId || !field) return;
    if (!state.infosFound[cardId]) state.infosFound[cardId] = {};
    state.infosFound[cardId][field] = true;

    // informer tous les AUTRES clients (pas celui qui vient d'envoyer)
    socket.broadcast.emit('info:update', { cardId, field });

    // mettre à jour les compteurs serveur (si tu en fais usage plus tard)
    io.emit('counters', recomputeCounters());
  });

  // Mouvements de curseur
  socket.on('cursor:move', ({ x, y }) => {
    const p = ensurePlayer(socket.id);
    socket.broadcast.emit('cursor:move', {
      id: socket.id,
      x,
      y,
      color: p.color,
      name: p.name
    });
  });

  socket.on('cursor:hide', () => {
    socket.broadcast.emit('cursor:hide', { id: socket.id });
  });

  // --- RESET PARTAGÉ ---
  socket.on('reset', () => {
    console.log('🔁 reset demandé par', socket.id);

    // On remet l'état serveur à zéro
    state.families   = {};
    state.zooms      = {};
    state.infosFound = {};

    // On prévient tous les clients (y compris celui qui a cliqué)
    io.emit('reset');
  });

  socket.on('disconnect', () => {
    console.log('⛔ disconnect', socket.id);
    delete players[socket.id];
    socket.broadcast.emit('cursor:hide', { id: socket.id });
    broadcastPresence();
  });
});

// Lancement
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Serveur prêt sur le port ${PORT}`);
});