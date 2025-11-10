// server.js — serveur coop (pseudos + curseurs + familles + infos)

const path = require("path");
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);

// ⚙️ Socket.io avec CORS pour Render + ton site Gandi
const io = new Server(httpServer, {
  cors: {
    origin: [
      "https://qui-est-qui-coop.onrender.com",
      "https://www.tristan-albert.com"
    ],
    methods: ["GET", "POST"]
  }
});

// On garde le static pour que l'app reste jouable directement sur Render
app.use(express.static(path.join(__dirname)));

// ---- ÉTAT PARTAGÉ ----
const state = {
  families: {},   // { [familyKey]: [cardId, ...] }
  zooms: {},      // (réservé plus tard)
  infosFound: {}  // { [cardId]: { date:true, auteur:true, titre:true } }
};

function recomputeCounters() {
  const placed = Object.values(state.families).reduce(
    (n, arr) => n + ((arr && arr.length) || 0),
    0
  );
  const infos = Object.values(state.infosFound).reduce((n, obj) => {
    if (!obj) return n;
    return n + Object.values(obj).filter(Boolean).length;
  }, 0);
  return { placed, infos };
}

// ---- JOUEURS / PSEUDOS / CURSORS ----
const COLORS = [
  "#ff6b6b","#feca57","#48dbfb","#1dd1a1",
  "#5f27cd","#ff9ff3","#ff9f43","#8395a7"
];
let nextColorIndex = 0;
const players = {}; // { socketId: { name, color } }

function ensurePlayer(id) {
  if (!players[id]) {
    const color = COLORS[nextColorIndex++ % COLORS.length];
    const number = Object.keys(players).length + 1;
    players[id] = { name: String(number), color };
  }
  return players[id];
}

function getConnectedCount() {
  if (io.of("/").sockets && typeof io.of("/").sockets.size === "number") {
    return io.of("/").sockets.size;
  }
  if (io.engine && typeof io.engine.clientsCount === "number") {
    return io.engine.clientsCount;
  }
  return 0;
}

function broadcastPresence() {
  io.emit("presence", getConnectedCount());
}

// ---- SOCKETS ----
io.on("connection", (socket) => {
  const MAX_PLAYERS = 20;
  const currentCount = io.of("/").sockets.size;

  if (currentCount >= MAX_PLAYERS) {
    console.log(`⚠️ Connexion refusée (${currentCount}/${MAX_PLAYERS})`);
    socket.emit("server:full", { max: MAX_PLAYERS });
    socket.disconnect(true);
    return;
  }

  console.log("🔌 Nouveau client", socket.id);
  ensurePlayer(socket.id);
  broadcastPresence();

  // Le client demande l'état quand il est prêt
  socket.on("client:ready", () => {
    console.log("📦 client:ready de", socket.id);
    socket.emit("state:init", {
      families:   state.families,
      zooms:      state.zooms,
      infosFound: state.infosFound,
      counters:   recomputeCounters()
    });
    socket.emit("players:init", players);
  });

  // Déplacement d'une carte dans une famille
  socket.on("moveToFamily", ({ cardId, family, posX, posY }) => {
    if (!cardId || !family) return;
    console.log("➡️ moveToFamily", cardId, "→", family, "de", socket.id);

    // retirer la carte de toutes les familles
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
    socket.broadcast.emit("moved", { cardId, family, posX, posY });
    io.emit("counters", recomputeCounters());
  });

  // Carte remise dans la pioche
  socket.on("moveToDraw", ({ cardId, posX, posY }) => {
    if (!cardId) return;
    console.log("🎯 moveToDraw", cardId, "de", socket.id);

    Object.keys(state.families).forEach((f) => {
      const list = state.families[f] || [];
      const idx = list.indexOf(cardId);
      if (idx !== -1) list.splice(idx, 1);
    });

    socket.broadcast.emit("draw:moved", { cardId, posX, posY });
    io.emit("counters", recomputeCounters());
  });

  // Info trouvée (date/auteur/titre)
  socket.on("info:found", ({ cardId, field }) => {
    if (!cardId || !field) return;
    if (!state.infosFound[cardId]) state.infosFound[cardId] = {};
    state.infosFound[cardId][field] = true;

    socket.broadcast.emit("info:update", { cardId, field });
    io.emit("counters", recomputeCounters());
  });

  // Curseurs
  socket.on("cursor:move", ({ x, y }) => {
    const p = ensurePlayer(socket.id);
    socket.broadcast.emit("cursor:move", {
      id: socket.id,
      x,
      y,
      color: p.color,
      name: p.name
    });
  });

  socket.on("cursor:hide", () => {
    socket.broadcast.emit("cursor:hide", { id: socket.id });
  });

  // Reset partagé
  socket.on("reset", () => {
    console.log("🔁 reset demandé par", socket.id);
    state.families   = {};
    state.zooms      = {};
    state.infosFound = {};
    io.emit("reset");
  });

  socket.on("disconnect", () => {
    console.log("⛔ disconnect", socket.id);
    delete players[socket.id];
    socket.broadcast.emit("cursor:hide", { id: socket.id });
    broadcastPresence();
  });
});

// Lancement
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`✅ Serveur temps réel prêt sur le port ${PORT}`);
});