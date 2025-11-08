/* =========================
   ÉTAT GLOBAL
   ========================= */
let cards = [];               // jeu (cards.json)
let progress = {};            // état par carte
let currentCardId = null;     // carte ouverte en zoom
let zTop = 1200;              // z-index le plus haut pour la carte saisie

/* =========================
   OUTILS TEXTE / MATCH
   ========================= */
const norm = (s) => (s ?? "")
  .toString()
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-z0-9 ]+/g,' ')
  .replace(/\s+/g,' ')
  .trim();

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n; if (n === 0) return m;
  const dp = Array.from({length: m+1}, () => new Array(n+1).fill(0));
  for (let i=0;i<=m;i++) dp[i][0] = i;
  for (let j=0;j<=n;j++) dp[0][j] = j;
  for (let i=1;i<=m;i++){
    for (let j=1;j<=n;j++){
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }
  }
  return dp[m][n];
}
function isApproxMatch(input, target) {
  const ni = norm(input), nt = norm(target);
  if (!ni || !nt) return false;
  if (ni === nt) return true;
  if (ni.length >= 3 && nt.includes(ni)) return true;
  if (nt.length >= 3 && ni.includes(nt)) return true;
  if (Math.abs(ni.length - nt.length) <= 2 && levenshtein(ni, nt) <= 2) return true;
  return false;
}

/* === Dates : extraction + tolérance ±5 ans === */
function extractYears(str){
  if (!str) return [];
  const years = [];
  const re = /\b(1[5-9]\d{2}|20\d{2}|2100)\b/g; // 1500–2100
  let m; while ((m = re.exec(String(str))) !== null) years.push(m[1]);
  return years;
}
function normalizeDateText(s){
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[–—−]/g,'-').replace(/\b(circa|vers|ca|c\.)\b/g,'')
    .replace(/\s*-\s*/g,'-').replace(/[^\w\- ]+/g,' ')
    .replace(/\s+/g,' ').trim();
}
function yearsSpan(years){
  if (!years || !years.length) return null;
  const nums = years.map(Number).filter(n => Number.isFinite(n));
  if (!nums.length) return null;
  return [Math.min(...nums), Math.max(...nums)];
}
function isWithinTolerance(y, span, tol){
  const [a,b] = span; return y >= (a - tol) && y <= (b + tol);
}
function isDateMatch(input, target, tol = 5){
  const inYears  = extractYears(input);
  const tgtYears = extractYears(target);

  if (inYears.length){
    if (!tgtYears.length) return false;
    const span = yearsSpan(tgtYears);
    return inYears.some(y => isWithinTolerance(Number(y), span, tol));
  }
  if (/^\d{1,3}$/.test(String(input).trim())) return false;

  const ni = normalizeDateText(input);
  const nt = normalizeDateText(target);
  if (ni === nt) return true;

  if (/[a-z]/.test(ni) && /[a-z]/.test(nt) &&
      Math.abs(ni.length - nt.length) <= 2 &&
      levenshtein(ni, nt) <= 2) return true;

  return false;
}

/* =========================
   SAUVEGARDE
   ========================= */
function saveProgress(){ localStorage.setItem('progress', JSON.stringify(progress)); }
function loadProgress(){
  try{ const raw = localStorage.getItem('progress'); if (raw) progress = JSON.parse(raw) || {}; }
  catch(e){ progress = {}; }
}

/* =========================
   SCORE GLOBAL & FAMILLES
   ========================= */
function updateScore(){
  let totalFound = 0;
  let cardsComplete = 0;
  const totalPossible = cards.length * 3;
  for (const id in progress) {
    const st = progress[id];
    if (st?.date) totalFound++;
    if (st?.auteur) totalFound++;
    if (st?.titre) totalFound++;
    if (st?.completed) cardsComplete++;
  }
  const scoreEl = document.getElementById('scoreBar');
  const barEl   = document.getElementById('progressBar');
  if (scoreEl) scoreEl.textContent = `Progression : ${totalFound} / ${totalPossible} réponses trouvées (${cardsComplete} cartes complètes)`;
  if (barEl && totalPossible > 0) barEl.style.width = `${(totalFound/totalPossible)*100}%`;
}

function updateFamilyProgress(){
  const famDiv = document.getElementById('familyProgress');
  if (!famDiv) return;
  const families = ['Graphisme','Objet','Espace','Mode'];
  const icons = { 'Objet':'🪑', 'Graphisme':'💻', 'Espace':'🏠', 'Mode':'👗' };
  const counts = {}; families.forEach(f=>counts[f]={total:0,correct:0});
  for (const c of cards){
    if (families.includes(c.famille)){
      counts[c.famille].total++;
      const st = progress[c.id];
      if (st?.familleBonne) counts[c.famille].correct++;
    }
  }
  famDiv.innerHTML = families.map(f=>{
    const {total,correct}=counts[f]; const ratio = total>0?`${correct} / ${total}`:'—';
    return `<span>${icons[f]} ${f} : ${ratio}</span>`;
  }).join(' ');
}

/* =========================
   PIOCHE : helpers
   ========================= */
function snapToDraw(cardEl, idx = 0){
  const board = document.getElementById('board');
  const draw  = document.getElementById('drawZone');
  if (!board || !draw) return;
  const br = board.getBoundingClientRect();
  const dr = draw.getBoundingClientRect();
  const xCenter = dr.left - br.left + (dr.width  - cardEl.offsetWidth)/2;
  const yCenter = dr.top  - br.top  + (dr.height - cardEl.offsetHeight)/2;
  const ox = ((idx * 3) % 12) - 6;
  const oy = ((idx * 5) % 12) - 6;
  const x = xCenter + ox;
  const y = yCenter + oy;
  cardEl.style.left = `${x}px`;
  cardEl.style.top  = `${y}px`;
  const id = cardEl.dataset.id;
  progress[id] = { ...(progress[id]||{}), x, y, inDraw: true };
  saveProgress();
}
function isInDraw(cardEl){
  const draw = document.getElementById('drawZone');
  if (!draw) return false;
  const dr = draw.getBoundingClientRect();
  const cr = cardEl.getBoundingClientRect();
  const cx = cr.left + cr.width/2;
  const cy = cr.top  + cr.height/2;
  return (cx>=dr.left && cx<=dr.right && cy>=dr.top && cy<=dr.bottom);
}
function realignCardsInDraw(){
  const els = Array.from(document.querySelectorAll('.card')).filter(el => progress[el.dataset.id]?.inDraw);
  els.forEach((el,i)=>snapToDraw(el,i));
}

/* =========================
   POSITIONS RESPONSIVES (px <-> %)
   ========================= */
function toPct(xPx, yPx, boardRect){
  return { xPct: (xPx / boardRect.width)*100, yPct: (yPx / boardRect.height)*100 };
}
function toPxFromPct(xPct, yPct, boardRect){
  return { x: (xPct/100)*boardRect.width, y: (yPct/100)*boardRect.height };
}
function applyResponsivePositions(){
  const board = document.getElementById('board');
  if (!board) return;
  const br = board.getBoundingClientRect();

  document.querySelectorAll('.card').forEach(el => {
    const id = el.dataset.id;
    const st = progress[id];
    if (!st || st.inDraw) return;
    if (st.xPct != null && st.yPct != null) {
      const { x, y } = toPxFromPct(st.xPct, st.yPct, br);
      el.style.left = `${x}px`;
      el.style.top  = `${y}px`;
    }
  });
}

/* =========================
   FAMILLES : détection / feedback
   ========================= */
function detectZone(cardElement){
  const cardRect = cardElement.getBoundingClientRect();
  const centerX = cardRect.left + cardRect.width/2;
  const centerY = cardRect.top  + cardRect.height/2;

  // 1) Pioche neutre
  const draw = document.getElementById('drawZone');
  if (draw){
    const dr = draw.getBoundingClientRect();
    const inDraw = dr.width>0 && dr.height>0 && centerX>=dr.left && centerX<=dr.right && centerY>=dr.top && centerY<=dr.bottom;
    if (inDraw) return null;
  }
  // 2) Zones familles
  const zones = document.querySelectorAll('.dropzone');
  for (const z of zones){
    const r = z.getBoundingClientRect();
    if (centerX>=r.left && centerX<=r.right && centerY>=r.top && centerY<=r.bottom) return z;
  }
  return null;
}
function showZoneFeedback(zone, correct){
  if (!zone) return;
  zone.classList.add(correct ? 'good' : 'bad');
  setTimeout(()=>zone.classList.remove('good','bad'), 600);
}
function showFamilyMessage(text, good=true){
  const container = document.getElementById('familyMsgContainer');
  if (!container) return;
  const msg = document.createElement('div');
  msg.className = 'family-msg ' + (good ? 'good' : 'bad');
  msg.textContent = text;
  container.appendChild(msg);
  setTimeout(()=>msg.remove(), 1200);
}
function refreshFamilyIndicator(cardId){
  const el = document.querySelector(`.card[data-id="${cardId}"] .family-indicator`);
  if (!el) return;
  const state = progress[cardId]?.familleBonne;
  el.className = 'family-indicator';
  if (state === true) el.classList.add('good');
  else if (state === false) el.classList.add('bad');
}
function checkCardFamilyPlacement(cardEl){
  const cardId = cardEl.dataset.id;
  const card   = cards.find(c=>c.id==cardId);
  const detectedZone = detectZone(cardEl);

  // Pioche / neutre → retour dans la pioche + reset du voyant famille
if (!detectedZone){
  const cardId = cardEl.dataset.id;

  // On nettoie l'état "famille" pour cette carte
  if (progress[cardId]) {
    progress[cardId].familleBonne   = undefined;
    progress[cardId].familleTrouvée = false;
    progress[cardId].zone           = null;
  }

  saveProgress();
  refreshFamilyIndicator(cardId);  // carré neutre
  updateFamilyProgress();          // compteurs familles à jour

  snapToDraw(cardEl);
  try { SFX.snap(); } catch(e){}
  return;
}

  // Traitement famille
  const zoneFamille = detectedZone.dataset.famille;
  const isCorrect   = (zoneFamille === card.famille);
  showZoneFeedback(detectedZone, isCorrect);
  showFamilyMessage(isCorrect ? 'Famille correcte ! ✅' : 'Mauvaise famille ❌', isCorrect);

  // capture position courante + % pour la rendre responsive
  const board = document.getElementById('board');
  const br = board.getBoundingClientRect();
  const cr = cardEl.getBoundingClientRect();
  const posX = cr.left - br.left;
  const posY = cr.top  - br.top;
  const { xPct, yPct } = toPct(posX, posY, br);

  progress[cardId] = {
    ...(progress[cardId]||{}),
    inDraw:false,
    familleTrouvée:true,
    zone:zoneFamille,
    familleBonne:isCorrect,
    x: posX, y: posY,
    xPct, yPct
  };
  saveProgress();
  refreshFamilyIndicator(cardId);
  updateFamilyProgress();

  try { (isCorrect ? SFX.correctFamily : SFX.wrong)(); } catch(e){}
}

// --- Style pour curseurs distants ---
(function ensureRemoteCursorStyle(){
  if (document.getElementById('remote-cursor-style')) return;
      const css = `
    .remote-cursor{
      position:fixed;
      pointer-events:none;
      z-index:5000;
      transform:translate(-50%, -50%);
    }
    .remote-cursor-dot{
      width:14px;
      height:14px;
      border-radius:999px;
      display:block;
      background:#000;
      box-shadow:0 0 4px rgba(0,0,0,.4);
    }
  `;

  const s = document.createElement('style');
  s.id = 'remote-cursor-style';
  s.textContent = css;
  document.head.appendChild(s);
})();


/* =========================
   VISU : classes "completed"
   ========================= */
function applyCompletionClasses() {
  document.querySelectorAll('.card').forEach(el => {
    const id = el.dataset.id;
    const done = !!progress[id]?.completed;
    el.classList.toggle('completed', done);
  });
}

/* =========================
   RENDU DU BOARD
   ========================= */
function renderBoard(){
  const board = document.getElementById('board');
  board.querySelectorAll('.card').forEach(c=>c.remove());
  let stackIdx = 0;

  cards.forEach((c)=>{
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = c.id;

    const img = document.createElement('img');
    img.src = c.image;
    el.appendChild(img);

    // mini-dots + voyant famille
    const dots = document.createElement('div');
    dots.className = 'mini-dots';
    ['date','auteur','titre'].forEach(k=>{
      const d = document.createElement('div');
      d.className = 'dot';
      if (progress[c.id]?.[k]) d.classList.add('found');
      dots.appendChild(d);
    });
    const fam = document.createElement('div');
    fam.className = 'family-indicator';
    const st = progress[c.id];
    if (st?.familleBonne===true) fam.classList.add('good');
    else if (st?.familleBonne===false) fam.classList.add('bad');
    dots.appendChild(fam);
    el.appendChild(dots);

    // pastille “drag & click”
    const hint = document.createElement('div');
    hint.className = 'action-hint';
    el.appendChild(hint);

    el.addEventListener('click', ()=>{ if (el._dragMoved) return; openZoom(c.id); });

    board.appendChild(el);

    // z-index d’empilement
    el.style.zIndex = (++zTop).toString();

    // Position initiale
    if (st?.inDraw === true || (st?.x == null && st?.xPct == null)) {
      snapToDraw(el, stackIdx++);
    } else {
      const br = board.getBoundingClientRect();
      if (st.xPct != null && st.yPct != null) {
        const { x, y } = toPxFromPct(st.xPct, st.yPct, br);
        el.style.left = `${x}px`;
        el.style.top  = `${y}px`;
      } else {
        el.style.left = `${st.x}px`;
        el.style.top  = `${st.y}px`;
      }
    }

    if (progress[c.id]?.completed) el.classList.add('completed');
    el.style.setProperty('--rand-rot', `${(Math.random()*10 - 5).toFixed(2)}deg`);
  });

  // ⚠️ créer/rafraîchir les étiquettes après rendu
  ensureZoneLabels();
}

function enableDragAndDrop(){
  const board = document.getElementById('board');
  if (!board) return;

  let dragged = null;
  let startX = 0, startY = 0;
  let offX = 0, offY = 0;
  let moved = false; // seuil mouvement

  const onDown = (x, y, target) => {
    const card = target.closest('.card');
    if (!card) return;

    dragged = card;
    dragged.style.zIndex = (++zTop).toString();

    const r = dragged.getBoundingClientRect();
    offX = x - r.left;
    offY = y - r.top;
    startX = x;
    startY = y;
    moved = false;

    dragged.classList.add('dragging');
    dragged._dragMoved = false; // servira à distinguer clic vs drag
  };

  const onMove = (x, y) => {
    if (!dragged) return;

    const dx = x - startX;
    const dy = y - startY;

    // petit seuil pour éviter qu'un simple clic soit vu comme un drag
    if (!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      moved = true;
      dragged._dragMoved = true;
    }

    if (moved) {
      const boardRect = board.getBoundingClientRect();
      dragged.style.left = (x - offX - boardRect.left) + 'px';
      dragged.style.top  = (y - offY - boardRect.top)  + 'px';
    }
  };

  const onUp = () => {
    if (!dragged) return;

    const cardEl = dragged;
    const cardId = cardEl.dataset.id;

    // 👇 Si la carte n'a PAS vraiment bougé : on considère que c'était un clic
    // → on NE touche pas à la famille, ni à la position, ni au réseau
    if (!cardEl._dragMoved) {
      cardEl.classList.remove('dragging');
      setTimeout(() => {
        if (dragged) dragged._dragMoved = false;
        dragged = null;
        moved = false;
      }, 0);
      return;
    }

    // 🟢 À partir d'ici, on est sûr qu'il y a eu un drag & drop

    // 1) logique famille (y compris retour pioche + reset voyant)
    checkCardFamilyPlacement(cardEl);

    // 2) Sauvegarde de la position + % (pour la responsivité)
    const rect      = cardEl.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    const posX      = rect.left - boardRect.left;
    const posY      = rect.top  - boardRect.top;
    const { xPct, yPct } = toPct(posX, posY, boardRect);

    progress[cardId] = {
      ...(progress[cardId] || {}),
      x: posX,
      y: posY,
      xPct,
      yPct,
      inDraw: isInDraw(cardEl)
    };
    saveProgress();

    // 3) COLLAB : annoncer le move aux autres joueurs
    try {
      const famZone = (typeof detectZone === 'function')
        ? detectZone(cardEl)
        : cardEl.closest('.dropzone');

      const famKey = famZone
        ? (famZone.dataset.famille || famZone.dataset.family || famZone.id)
        : null;

      const socket = window.socketCollab;
      console.log('[DEBUG socket]', socket ? 'ok' : 'absent', 'famKey:', famKey);

      if (socket) {
        if (famKey) {
          // carte dans une famille
          console.log('[collab] emit moveToFamily', cardId, '→', famKey, 'at', posX, posY);
          socket.emit('moveToFamily', {
            cardId,
            family: famKey,
            posX,
            posY
          });
        } else if (progress[cardId]?.inDraw) {
          // carte en pioche
          console.log('[collab] emit moveToDraw', cardId, 'at', posX, posY);
          socket.emit('moveToDraw', {
            cardId,
            posX,
            posY
          });
        }
      }
    } catch (e) {
      console.warn('[collab] erreur annonce move', e);
    }

    cardEl.classList.remove('dragging');

    setTimeout(() => {
      if (dragged) dragged._dragMoved = false;
      dragged = null;
      moved = false;
    }, 0);
  };

  // Souris
  board.addEventListener('mousedown', (e) => {
    onDown(e.clientX, e.clientY, e.target);
  });
  board.addEventListener('mousemove', (e) => {
    onMove(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', onUp);

  // Touch
  board.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    onDown(t.clientX, t.clientY, e.target);
  }, { passive: true });

  board.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    onMove(t.clientX, t.clientY);
  }, { passive: true });

  window.addEventListener('touchend', onUp, { passive: true });
}


/* =========================
   ZOOM
   ========================= */
function openZoom(id){
  currentCardId = id;
  const c = cards.find(x=>x.id===id);
  document.getElementById('zoomImage').src = c.image;
  document.getElementById('answerInput').value = '';
  setFoundInfoFromState(id);
  renderProgressDots(id);
  document.getElementById('zoom').classList.remove('hidden');
  setTimeout(()=>document.getElementById('answerInput').focus(),40);
}
function closeZoom(){ document.getElementById('zoom').classList.add('hidden'); currentCardId=null; }
document.getElementById('closeZoom').addEventListener('click', closeZoom);
document.getElementById('zoomBackdrop').addEventListener('click', closeZoom);
window.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeZoom(); });

function setFoundInfoFromState(cardId){
  const box = document.getElementById('foundInfo');
  if (!box) return;
  const st = progress[cardId]||{};
  const c  = cards.find(x=>x.id===cardId);
  const items=[];
  if (st.date)   items.push(`✅ Date : ${c.date}`);
  if (st.auteur) items.push(`✅ Auteur : ${c.auteur}`);
  if (st.titre)  items.push(`✅ Création : ${c.titre}`);
  if (!items.length){ box.style.display='none'; box.textContent=''; }
  else { box.innerHTML = items.join('<br>'); box.style.display='block'; }
}
function showOneNewInfo(text){
  const box=document.getElementById('foundInfo'); if(!box) return;
  box.style.display='block'; if (box.innerHTML && !box.innerHTML.endsWith('<br>')) box.innerHTML += '<br>';
  box.innerHTML += text;
}
function renderProgressDots(cardId){
  const row=document.getElementById('progressDots'); row.innerHTML='';
  const st=progress[cardId]||{date:false,auteur:false,titre:false};
  ['date','auteur','titre'].forEach(k=>{ const d=document.createElement('div'); d.className='dot'+(st[k]?' found':''); row.appendChild(d); });
}

/* ---------- Son “complete” idempotent ---------- */
function playCompleteOnce(cardId) {
  const st = progress[cardId] || {};
  if (st.completed && !st._completeSoundPlayed) {
    try { SFX.complete(); } catch(e){}
    st._completeSoundPlayed = true;
    progress[cardId] = st;
    saveProgress();
  }
}

function emitInfoFound(cardId, fields) {
  if (!window.socketCollab) return;
  if (!Array.isArray(fields)) fields = [fields];
  fields.forEach(field => {
    console.log('[collab] emit info:found', cardId, field);
    window.socketCollab.emit('info:found', { cardId, field });
  });
}

function validateCurrent(){
  if(!currentCardId) return;
  const input=document.getElementById('answerInput'); const val=input.value.trim(); if(!val) return;

  const card=cards.find(x=>x.id===currentCardId);
  const st=progress[currentCardId]||{date:false,auteur:false,titre:false,completed:false};
  let matched=false;
  const newlyFound = [];

  // Date : stricte avec tolérance ±5
  if(!st.date && isDateMatch(val, card.date)){
    st.date=true; matched=true; newlyFound.push('date');
    showOneNewInfo(`✅ Date : ${card.date}`);
  }
  if(!st.auteur && !matched && isApproxMatch(val,card.auteur)){
    st.auteur=true; matched=true; newlyFound.push('auteur');
    showOneNewInfo(`✅ Auteur : ${card.auteur}`);
  }
  if(!st.titre && !matched && isApproxMatch(val,card.titre)){
    st.titre=true; matched=true; newlyFound.push('titre');
    showOneNewInfo(`✅ Création : ${card.titre}`);
  }

  if(matched){ try { SFX.tick(); } catch(e){}; input.value=''; }
  else { input.classList.add('wrong'); setTimeout(()=>input.classList.remove('wrong'),500); }

  st.completed=!!(st.date&&st.auteur&&st.titre);
  progress[currentCardId]=st; saveProgress();

  playCompleteOnce(currentCardId);

  renderProgressDots(currentCardId);

  const cardElement=document.querySelector(`.card[data-id="${currentCardId}"]`);
  if(cardElement){
    const dots=cardElement.querySelectorAll('.dot');
    ['date','auteur','titre'].forEach((k,i)=>{ if(st[k] && dots[i]) dots[i].classList.add('found'); });
  }

  applyCompletionClasses();
  updateScore();

  // 🔁 Coop : prévenir les autres joueurs des nouvelles infos trouvées
  if (newlyFound.length) {
    emitInfoFound(currentCardId, newlyFound);
  }
}

const GIVEUP_COOLDOWN_MS = 5000; // 5 secondes

function giveUp(){
  if (!currentCardId) return;

  const btn = document.getElementById('giveUpBtn');

  // Si le bouton est en cooldown, on ignore le clic
  if (btn && btn.disabled) {
    return;
  }

  // --- Gestion visuelle du cooldown ---
  if (btn) {
    btn.disabled = true;
    btn.classList.add('cooldown');
    btn.style.setProperty('--cd-duration', GIVEUP_COOLDOWN_MS + 'ms');

    // On recrée la barre pour relancer proprement l'animation
    let bar = btn.querySelector('.cooldown-bar');
    if (bar) {
      bar.remove();
    }
    bar = document.createElement('div');
    bar.className = 'cooldown-bar';
    btn.appendChild(bar);

    // À la fin du cooldown, on réactive le bouton et on enlève la barre
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove('cooldown');
      if (bar && bar.parentNode) {
        bar.parentNode.removeChild(bar);
      }
    }, GIVEUP_COOLDOWN_MS);
  }

  // --- Logique existante de "Ma langue au chat" ---
    const card = cards.find(x => x.id === currentCardId);
  const st = progress[currentCardId] || { date:false, auteur:false, titre:false };

  // Socket.io dispo ?
  const sock = window.socketCollab || null;

  if (!st.date) {
    st.date = true;
    showOneNewInfo(`💡 Date : ${card.date}`);
    // 🔁 Coop : prévenir les autres que la date est révélée
    if (sock) sock.emit('info:found', { cardId: currentCardId, field: 'date' });
  }
  else if (!st.auteur) {
    st.auteur = true;
    showOneNewInfo(`💡 Auteur : ${card.auteur}`);
    if (sock) sock.emit('info:found', { cardId: currentCardId, field: 'auteur' });
  }
  else if (!st.titre) {
    st.titre = true;
    showOneNewInfo(`💡 Création : ${card.titre}`);
    if (sock) sock.emit('info:found', { cardId: currentCardId, field: 'titre' });
  }
  else {
    showOneNewInfo(`😸 Tout est déjà révélé.`);
  }

  st.completed = !!(st.date && st.auteur && st.titre);
  progress[currentCardId] = st;
  saveProgress();

  playCompleteOnce(currentCardId);

  const cardElement = document.querySelector(`.card[data-id="${currentCardId}"]`);
  if (cardElement) {
    const dots = cardElement.querySelectorAll('.dot');
    ['date','auteur','titre'].forEach((k,i) => {
      if (st[k]) dots[i].classList.add('found');
    });
  }

  renderProgressDots(currentCardId);
  applyCompletionClasses();
  updateScore();
}

document.getElementById('validateBtn').addEventListener('click',validateCurrent);
document.getElementById('giveUpBtn').addEventListener('click',giveUp);
document.getElementById('answerInput').addEventListener('keydown',(e)=>{ if(e.key==='Enter') validateCurrent(); });

/* =========================
   RESET (GOMME)
   ========================= */
document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('Réinitialiser toutes les réponses et remélanger les cartes ?')) return;

  // 1️⃣ Reset local (ton comportement actuel)
  await shuffleDeck(false); // reset complet + mélange

  // 2️⃣ Prévenir les autres joueurs (coop)
  if (window.socketCollab) {
    console.log('[collab] emit reset');
    window.socketCollab.emit('reset');
  }
});

// 3️⃣ Quand un autre joueur demande un reset
if (window.socketCollab) {
  window.socketCollab.on('reset', async () => {
    console.log('[collab] reset reçu (depuis un autre joueur)');
    await shuffleDeck(false);
  });
}


/* =========================
   THÈME (bouton SVG)
   ========================= */
const themeBtn = document.querySelector('.theme-toggle');
if (themeBtn){
  themeBtn.addEventListener('click', ()=>{
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    positionZoneLabels(); // recale la couleur/contraste visuel mais surtout force un repaint
  });
}

/* =========================
   AJUSTEMENT DU PLATEAU
   ========================= */
function resizeBoard(){
  const board=document.getElementById('board'); if(!board) return;
  const topOffset = board.getBoundingClientRect().top;
  const newHeight = window.innerHeight - topOffset - 20;
  board.style.height = `${newHeight}px`;
  requestAnimationFrame(() => {
    positionZoneLabels();
    applyResponsivePositions();
    realignCardsInDraw();
  });
}
window.addEventListener('resize', resizeBoard);
window.addEventListener('orientationchange', resizeBoard);
window.addEventListener('load', resizeBoard);

/* =========================
   MODALE INTRO + START
   ========================= */
function showIntroModal(){ document.getElementById('introModal').classList.remove('hidden'); }
function hideIntroModal(){ document.getElementById('introModal').classList.add('hidden'); localStorage.setItem('introSeen','true'); }
document.getElementById('infoBtn').addEventListener('click', showIntroModal);
document.getElementById('introModal').addEventListener('click', (e)=>{ if(e.target.id==='introModal') hideIntroModal(); });
document.getElementById('closeIntro').addEventListener('click', hideIntroModal);
window.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && !document.getElementById('introModal').classList.contains('hidden')) hideIntroModal(); });
if(!localStorage.getItem('introSeen')) showIntroModal();

/* =========================
   MOBILE GATE
   ========================= */
function applyDesktopGate(){
  const isSmall = window.matchMedia('(max-width: 900px)').matches;
  const isCoarse = window.matchMedia('(pointer: coarse)').matches;
  document.body.classList.toggle('mobile-block', isSmall || isCoarse);
}
window.addEventListener('load', applyDesktopGate);
window.addEventListener('resize', applyDesktopGate);
window.addEventListener('orientationchange', applyDesktopGate);

/* =========================
   SFX — petits sons
   ========================= */
const SFX = (() => {
  let ctx, master;
  let baseVol = 1;
  let muted = false;

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : baseVol;
      master.connect(ctx.destination);
      const unlock = () => { ctx.resume && ctx.resume(); window.removeEventListener('pointerdown', unlock); };
      window.addEventListener('pointerdown', unlock, { once: true });
    }
    return ctx;
  }

  function tone({ f = 200, dur = 0.14, type = 'sine', vol = 0.08, attack = 0.006, release = 0.08, at = 0 }) {
    const c = ensureCtx();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, c.currentTime + at);
    g.gain.setValueAtTime(0, c.currentTime + at);
    g.gain.linearRampToValueAtTime(vol, c.currentTime + at + attack);
    g.gain.linearRampToValueAtTime(0, c.currentTime + at + dur + release);
    osc.connect(g); g.connect(master);
    osc.start(c.currentTime + at);
    osc.stop(c.currentTime + at + dur + release + 0.02);
  }

  function tick(){ tone({ f: 190, dur: 0.10, type: 'sine', vol: 0.06 }); tone({ f: 285, dur: 0.10, type: 'sine', vol: 0.04, at: 0.02 }); }
  function correctFamily(){ tone({ f: 170, dur: 0.12, type: 'triangle', vol: 0.06 }); tone({ f: 255, dur: 0.12, type: 'sine', vol: 0.05, at: 0.04 }); }
  function wrong(){ tone({ f: 120, dur: 0.16, type: 'sawtooth', vol: 0.035 }); }
  function complete(){ tone({ f: 196, dur: 0.12, type: 'sine', vol: 0.07 }); tone({ f: 247, dur: 0.12, type: 'sine', vol: 0.07, at: 0.10 }); tone({ f: 294, dur: 0.16, type: 'sine', vol: 0.07, at: 0.20 }); }
  function snap(){ tone({ f: 160, dur: 0.06, type: 'triangle', vol: 0.04 }); }

  function setMuted(m){ muted = !!m; ensureCtx(); if (master) master.gain.value = muted ? 0 : baseVol; try{ localStorage.setItem('soundMuted', muted ? '1' : '0'); }catch(e){} }
  function isMuted(){ return !!muted; }
  function setVolume(v){ baseVol = Math.max(0, Math.min(1, v)); ensureCtx(); if (!muted && master) master.gain.value = baseVol; }

  return { tick, correctFamily, wrong, complete, snap, setMuted, isMuted, setVolume };
})();
try { if (localStorage.getItem('soundMuted') === '1') SFX.setMuted(true); } catch(e){}

/* Bouton Son ON/OFF */
const soundBtn = document.getElementById('soundBtn');
const ICON_ON = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M640-440v-80h160v80H640Zm48 280-128-96 48-64 128 96-48 64Zm-80-480-48-64 128-96 48 64-128 96ZM120-360v-240h160l200-200v640L280-360H120Zm280-246-86 86H200v80h114l86 86v-252ZM300-480Z"/></svg>`;
const ICON_OFF=`<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="m616-320-56-56 104-104-104-104 56-56 104 104 104-104 56 56-104 104 104 104-56 56-104-104-104 104Zm-496-40v-240h160l200-200v640L280-360H120Zm280-246-86 86H200v80h114l86 86v-252ZM300-480Z"/></svg>`;
function refreshSoundBtn(){ if(!soundBtn) return; const muted=SFX.isMuted(); soundBtn.innerHTML = muted?ICON_OFF:ICON_ON; soundBtn.setAttribute('aria-pressed', muted?'true':'false'); soundBtn.setAttribute('title', muted?'Son désactivé':'Son activé'); }
if (soundBtn){ refreshSoundBtn(); soundBtn.addEventListener('click', ()=>{ SFX.setMuted(!SFX.isMuted()); refreshSoundBtn(); }); }

/* =========================
   TUTORIEL (coachmarks)
   ========================= */
const tour = {
  step: 0, steps: [], overlay: null, spot: null, tip: null,
  prevOnLeave: null, onRes: null, autoTimer: null
};
function rectOf(el){ return el.getBoundingClientRect(); }
function unionRects(rects){
  const left   = Math.min(...rects.map(r => r.left));
  const top    = Math.min(...rects.map(r => r.top));
  const right  = Math.max(...rects.map(r => r.right));
  const bottom = Math.max(...rects.map(r => r.bottom));
  return { left, top, right, bottom, width: right-left, height: bottom-top };
}
function getCombinedRect(selectors){
  const els = selectors.map(sel => document.querySelector(sel)).filter(Boolean);
  if(!els.length) return null;
  return unionRects(els.map(rectOf));
}
function placeSpotlight(targetOrRect){
  const r = (targetOrRect instanceof Element) ? rectOf(targetOrRect) : targetOrRect;
  if(!r || !tour.spot) return;
  const pad = 6;
  tour.spot.style.left   = `${r.left - pad}px`;
  tour.spot.style.top    = `${r.top  - pad}px`;
  tour.spot.style.width  = `${r.width  + pad*2}px`;
  tour.spot.style.height = `${r.height + pad*2}px`;
}
function placeTooltip(targetOrRect, pos = "bottom"){
  const r = (targetOrRect instanceof Element) ? rectOf(targetOrRect) : targetOrRect;
  if(!r || !tour.tip) return;
  const tip = tour.tip; tip.dataset.pos = pos;
  const pad = 10; let x = r.left, y = r.bottom + pad;
  if (pos === "top")    { y = r.top - tip.offsetHeight - pad; x = r.left; }
  if (pos === "bottom") { y = r.bottom + pad;                  x = r.left; }
  if (pos === "left")   { x = r.left - tip.offsetWidth - pad;  y = r.top;  }
  if (pos === "right")  { x = r.right + pad;                   y = r.top;  }
  x = Math.max(8, Math.min(x, window.innerWidth  - tip.offsetWidth  - 8));
  y = Math.max(8, Math.min(y, window.innerHeight - tip.offsetHeight - 8));
  tip.style.left = `${x}px`; tip.style.top  = `${y}px`;
}
function highlightDrawCards(on = true) {
  const els = Array.from(document.querySelectorAll('.card'));
  els.forEach(el => {
    const inDrawNow = isInDraw(el);
    if (inDrawNow && on) el.classList.add('pulse');
    else el.classList.remove('pulse');
  });
}
function buildOverlay() {
  if (tour.overlay) tour.overlay.remove();
  const ov = document.createElement('div'); ov.className = 'coach-overlay';
  const spot = document.createElement('div'); spot.className = 'coach-spot';
  const tip = document.createElement('div'); tip.className = 'coach-tip';
  tip.innerHTML = `
    <h4 id="coachTitle"></h4>
    <div id="coachText"></div>
    <div class="coach-actions">
      <button class="coach-btn secondary" id="coachSkip" type="button">Passer</button>
      <div class="coach-prog" id="coachProg"></div>
      <button class="coach-btn" id="coachNext" type="button">Suivant</button>
    </div>`;
  ov.appendChild(spot); ov.appendChild(tip); document.body.appendChild(ov);
  tour.overlay = ov; tour.spot = spot; tour.tip = tip;
  tip.querySelector('#coachSkip').addEventListener('click', endTour);
  tip.querySelector('#coachNext').addEventListener('click', nextStep);
}
function showStep(i) {
  const s = tour.steps[i];
  if (!s) { endTour(); return; }
  let targetEl = null, targetRect = null;
  if (s.selectors && Array.isArray(s.selectors)) {
    targetRect = getCombinedRect(s.selectors); if(!targetRect){ nextStep(); return; }
  } else if (s.selector) {
    targetEl = document.querySelector(s.selector); if (!targetEl) { nextStep(); return; }
  } else { nextStep(); return; }
  tour.tip.querySelector('#coachTitle').textContent = s.title || 'Astuce';
  tour.tip.querySelector('#coachText').innerHTML    = s.html || '';
  tour.tip.querySelector('#coachProg').textContent  = `${i+1} / ${tour.steps.length}`;
  tour.tip.querySelector('#coachNext').textContent  = (i === tour.steps.length - 1) ? 'Terminer' : 'Suivant';
  if (targetRect) { placeSpotlight(targetRect); requestAnimationFrame(() => placeTooltip(targetRect, s.pos || 'bottom')); }
  else { placeSpotlight(targetEl); requestAnimationFrame(() => placeTooltip(targetEl, s.pos || 'bottom')); }
  if (tour.prevOnLeave) tour.prevOnLeave(); tour.prevOnLeave = s.onLeave || null;
  if (s.onEnter) s.onEnter();
  if (tour.autoTimer) { clearTimeout(tour.autoTimer); tour.autoTimer = null; }
  if (s.auto) tour.autoTimer = setTimeout(nextStep, s.auto);
}
function nextStep() { tour.step++; if (tour.step >= tour.steps.length) { endTour(); return; } showStep(tour.step); }
function endTour() {
  highlightDrawCards(false);
  if (tour.autoTimer) { clearTimeout(tour.autoTimer); tour.autoTimer = null; }
  if (tour.overlay) tour.overlay.remove();
  if (tour.onRes) { window.removeEventListener('resize', tour.onRes); window.removeEventListener('orientationchange', tour.onRes); tour.onRes = null; }
  tour.step = 0; tour.steps = []; tour.overlay = tour.spot = tour.tip = null; tour.prevOnLeave = null;
}
function startTour() {
  if (document.body.classList.contains('mobile-block')) return;
  tour.steps = [
    {
      selector: '#drawZone',
      title: 'Pioche',
      html: `Cliquez sur <strong>une des cartes</strong> pour ouvrir sa fiche,
             puis tentez de trouver la <em>date</em>, l’<em>auteur</em> et le <em>titre</em> 😉`,
      pos: 'right',
      onEnter: () => highlightDrawCards(true),
      onLeave: () => highlightDrawCards(false)
    },
    { selector: '#drawZone', title: 'Pioche', html: `Cette zone est <strong>neutre</strong> : posez-y vos cartes pour y revenir plus tard.`, pos:'left' },
    { selector: '.dropzone[data-famille="Graphisme"]', title: 'Design graphique', html: `Déposez ici les cartes de <strong>design graphique</strong>.`, pos:'top' },
    { selector: '.dropzone[data-famille="Objet"]',     title: 'Design d’objet',   html: `Ici, les cartes de <strong>design d’objet</strong>.`, pos:'top' },
    { selector: '.dropzone[data-famille="Espace"]',    title: 'Design d’espace',  html: `Ici, le <strong>design d’espace</strong>.`, pos:'bottom' },
    { selector: '.dropzone[data-famille="Mode"]',      title: 'Design de mode',   html: `Et ici, le <strong>design de mode</strong>.`, pos:'bottom' },
    { selectors: ['#progressWrapper', '#familyProgress'], title: 'Progression', html: `Surveillez votre <strong>progression</strong> ici, et le décompte par <strong>famille</strong> juste à côté !`, pos: 'bottom' }
  ];
  buildOverlay(); tour.step = 0; showStep(0);
  tour.onRes = () => { if (!tour.tip || !tour.steps.length) return; showStep(tour.step); };
  window.addEventListener('resize', tour.onRes);
  window.addEventListener('orientationchange', tour.onRes);
}
const startBtn = document.getElementById('startGameBtn');
if (startBtn) {
  startBtn.addEventListener('click', () => {
    hideIntroModal();
    setTimeout(startTour, 280);
  });
}

/* =========================
   ÉTIQUETTES GÉLULE — overlay
   ========================= */
const FAMILY_LABELS = {
  Graphisme: 'Design graphique',
  Objet:     'Design d’objet',
  Espace:    'Design d’espace',
  Mode:      'Design de mode'
};

function ensureZoneLabels(){
  const board = document.getElementById('board');
  if (!board) return;

  let layer = document.getElementById('zoneLabels');
  if (!layer){
    layer = document.createElement('div');
    layer.id = 'zoneLabels';
    board.appendChild(layer);
  } else {
    layer.innerHTML = '';
  }

  document.querySelectorAll('.dropzone').forEach(z => {
    const fam = z.dataset.famille || z.getAttribute('data-famille');
    if (!fam) return; // 🔸 évite la création d'une étiquette "Zone"
    const lab = document.createElement('div');
    lab.className = 'zone-label';
    lab.dataset.for = fam;
    lab.textContent = FAMILY_LABELS[fam] || fam;
    layer.appendChild(lab);
  });

  positionZoneLabels();
}

function positionZoneLabels(){
  const board = document.getElementById('board');
  const layer = document.getElementById('zoneLabels');
  if (!board || !layer) return;

  const br = board.getBoundingClientRect();
  const offset = 12;

  document.querySelectorAll('.dropzone').forEach(z => {
    const fam = z.dataset.famille || z.getAttribute('data-famille') || 'Zone';
    const lab = layer.querySelector(`.zone-label[data-for="${fam}"]`);
    if (!lab) return;

    const r = z.getBoundingClientRect();

    // coin par défaut: haut-gauche
    let left = r.left - br.left + offset;
    let top  = r.top  - br.top  + offset;

    // mêmes coins que tes anciens titres
    if (fam === 'Objet'){ // haut-droit
      left = r.right - br.left - offset - lab.offsetWidth;
      top  = r.top   - br.top  + offset;
    } else if (fam === 'Espace'){ // bas-gauche
      left = r.left  - br.left + offset;
      top  = r.bottom- br.top  - offset - lab.offsetHeight;
    } else if (fam === 'Mode'){ // bas-droit
      left = r.right - br.left - offset - lab.offsetWidth;
      top  = r.bottom- br.top  - offset - lab.offsetHeight;
    }

    lab.style.left = `${left}px`;
    lab.style.top  = `${top}px`;
  });
}

/* =========================
   OBSERVATION TAILLE BOARD
   ========================= */
function observeBoardAndDraw() {
  const board = document.getElementById('board');
  const draw  = document.getElementById('drawZone');
  if (!board || !draw || typeof ResizeObserver === 'undefined') return;

  const ro = new ResizeObserver(() => {
    requestAnimationFrame(() => {
      positionZoneLabels();
      applyResponsivePositions();
      realignCardsInDraw();
    });
  });

  ro.observe(board);
  ro.observe(draw);
}

/* =========================
   CHARGEMENT
   ========================= */
function afterFirstLayout(){ return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))); }
function waitForCardImages(){
  const imgs = Array.from(document.querySelectorAll('.card img'));
  const list = imgs.map(img => {
    if (img.complete) return img.decode ? img.decode().catch(()=>{}) : Promise.resolve();
    return new Promise(resolve => {
      const done = () => { img.removeEventListener('load', done); img.removeEventListener('error', done); resolve(); };
      img.addEventListener('load', done, { once:true });
      img.addEventListener('error', done, { once:true });
    });
  });
  return Promise.all(list);
}
function shuffleInPlace(arr){
  for (let i = arr.length - 1; i > 0; i--) {
    let j;
    if (window.crypto?.getRandomValues) {
      const buf = new Uint32Array(1);
      window.crypto.getRandomValues(buf);
      j = Math.floor((buf[0] / 2**32) * (i + 1));
    } else {
      j = Math.floor(Math.random() * (i + 1));
    }
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
/* Remélange le paquet et repile dans la pioche
   keepAnswers=true => on garde les réponses, on efface juste les positions */
async function shuffleDeck(keepAnswers = true){
  if (keepAnswers){
    // garde date/auteur/titre/completed, supprime positions
    for (const id in progress){
      const st = progress[id];
      if (!st) continue;
      delete st.x; delete st.y; delete st.xPct; delete st.yPct;
      st.inDraw = true;
    }
  } else {
    progress = {};   // reset total
  }
  shuffleInPlace(cards);
  saveProgress();

  // re-render + réalignement pile
  renderBoard();
  enableDragAndDrop();
  updateScore();
  updateFamilyProgress();
  applyCompletionClasses();
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch(e){}
  await afterFirstLayout();
  await waitForCardImages();
  await afterFirstLayout();
  realignCardsInDraw();
  applyResponsivePositions();
  positionZoneLabels();
}

async function loadCards() {
  const res = await fetch('cards.json');
  cards = await res.json();
  loadProgress();
  const SHUF_KEY = 'forceShuffle';
  const forceShuffle = localStorage.getItem(SHUF_KEY) === '1';
  if (forceShuffle){
  shuffleInPlace(cards);
  // Si tu veux conserver les réponses, mais repiler : efface seulement les positions
  for (const id in progress){
    const st = progress[id];
    if (!st) continue;
    delete st.x; delete st.y; delete st.xPct; delete st.yPct;
    st.inDraw = true;
  }
  localStorage.removeItem(SHUF_KEY);
  } else {
  // Mélange si nouvelle partie (pas de positions)
  const hasPositions = Object.values(progress).some(st => st && (('x' in st) || ('inDraw' in st) || ('xPct' in st)));
  if (!hasPositions) shuffleInPlace(cards);
  }
  // Exemple : on “programme” un mélange au prochain refresh
  function requestShuffleAndReload(keepAnswers=true){
  // Ici on conserve les réponses : au chargement, on efface juste les positions
  localStorage.setItem('forceShuffle','1');
  location.reload();
  }


  // Mélange si nouvelle partie (pas de positions sauvegardées)
  const hasPositions = Object.values(progress).some(st => st && (('x' in st) || ('inDraw' in st) || ('xPct' in st)));
  if (!hasPositions) shuffleInPlace(cards);

  renderBoard();
  enableDragAndDrop();
  updateScore();
  updateFamilyProgress();
  applyCompletionClasses();

  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch(e){}
  await afterFirstLayout();
  await waitForCardImages();
  await afterFirstLayout();
  realignCardsInDraw();
  applyResponsivePositions();
  positionZoneLabels();

  if (localStorage.getItem('theme') === 'light') document.body.classList.add('light');
  observeBoardAndDraw();
}

loadCards();

// ============ COOP SIMPLE ============

// petite fonction neutre pour éviter une erreur si on l'appelle
function initPseudoUI() {
  // UI pseudos désactivée pour le moment
}

function initCollabSimple() {
  // 1) Vérifier que Socket.IO est disponible
  if (!window.io) {
    console.warn('[collab] io() indisponible. Vérifie <script src="https://cdn.socket.io/4.8.1/socket.io.min.js"> avant script.js');
    return;
  }

  // 2) Un socket global par onglet
  const socket = io("https://qui-est-qui-coop.onrender.com", {
    transports: ["websocket", "polling"]
  });
  window.socketCollab = socket; // <-- on le stocke ici pour le reste du code

  let selfId = null;
  const remoteCursors = {}; // { socketId: HTMLElement }
  const peers = {};        // { socketId: { name, color } }

  function getOrCreateCursor(id, color) {
    let el = remoteCursors[id];
    if (!el) {
      el = document.createElement('div');
      el.className = 'remote-cursor';
      el.innerHTML = `
        <span class="remote-cursor-dot" style="background:${color}"></span>
      `;
      document.body.appendChild(el);
      remoteCursors[id] = el;
    } else {
      const dot = el.querySelector('.remote-cursor-dot');
      if (dot && color) dot.style.background = color;
    }
    return el;
  }

  // 3) Connexion + pseudo
  socket.on('connect', () => {
    console.log('[collab] CONNECTED', socket.id);
    selfId = socket.id;
    initPseudoUI();
  });

  // 4) Présence
  socket.on('presence', (n) => {
    const el = document.getElementById('presence-count');
    if (el) el.textContent = n;
  });

  // 5) Liste initiale de joueurs
  socket.on('players:init', (all) => {
    Object.entries(all || {}).forEach(([id, info]) => {
      if (id === selfId) return;
      peers[id] = info;
    });
  });

  // 6) Mise à jour d'un pseudo
  socket.on('player:update', ({ id, name, color }) => {
    if (!id || id === selfId) return;
    peers[id] = { name, color };
  });

  // Helpers adaptés à ton HTML
  function findCard(cardId) {
    // tes cartes : <div class="card" data-id="...">
    return document.querySelector(`.card[data-id="${CSS.escape(cardId)}"]`);
  }

  function findFamilyZone(famKey) {
    // tes zones : <div class="dropzone" data-famille="Objet">...
    return (
      document.querySelector(`.dropzone[data-famille="${CSS.escape(famKey)}"]`) ||
      document.querySelector(`.dropzone#${CSS.escape(famKey)}`)
    );
  }

  // 7) Appliquer les moves reçus des autres joueurs (sans toucher au parent DOM)
  socket.on('moved', ({ cardId, family, posX, posY }) => {
    console.log('[collab] moved reçu', cardId, '→', family, 'at', posX, posY);

    const card  = findCard(cardId);
    const zone  = findFamilyZone(family);
    const board = document.getElementById('board');
    if (!card || !zone || !board) return;

    const boardRect = board.getBoundingClientRect();
    const cardRect  = card.getBoundingClientRect();

    let finalX = posX;
    let finalY = posY;

    // Si jamais les coords ne sont pas fournies, on retombe sur le centrage
    if (typeof finalX !== 'number' || typeof finalY !== 'number') {
      const zoneRect = zone.getBoundingClientRect();
      finalX = zoneRect.left + zoneRect.width  / 2 - boardRect.left - cardRect.width  / 2;
      finalY = zoneRect.top  + zoneRect.height / 2 - boardRect.top  - cardRect.height / 2;
    }

    card.style.left = finalX + 'px';
    card.style.top  = finalY + 'px';

    // garder la carte au-dessus
    if (typeof zTop === 'number') {
      card.style.zIndex = (++zTop).toString();
    }

    // mettre progress à jour aussi
    if (typeof progress === 'object' && typeof toPct === 'function') {
      const { xPct, yPct } = toPct(finalX, finalY, boardRect);
      progress[cardId] = {
        ...(progress[cardId] || {}),
        x: finalX,
        y: finalY,
        xPct,
        yPct,
        inDraw: false
      };
      if (typeof saveProgress === 'function') {
        saveProgress();
      }
    }

    // Mettre aussi à jour l'état de famille (bonne / mauvaise) pour les compteurs & voyant carré
    const cardData = cards.find(c => String(c.id) === String(cardId));
    if (cardData) {
      const isCorrect = (family === cardData.famille);
      const st = progress[cardId] || {};
      st.familleTrouvée = true;
      st.zone           = family;
      st.familleBonne   = isCorrect;
      progress[cardId]  = st;
      saveProgress();
      refreshFamilyIndicator(cardId);
      updateFamilyProgress();
    }
  });

  // Carte remise dans la pioche par un autre joueur
  socket.on('draw:moved', ({ cardId, posX, posY }) => {
    console.log('[collab] draw:moved reçu', cardId, 'at', posX, posY);

    const card  = findCard(cardId);
    const board = document.getElementById('board');
    const draw  = document.getElementById('drawZone');
    if (!card || !board) return;

    const boardRect = board.getBoundingClientRect();
    let finalX = posX;
    let finalY = posY;

    // fallback : si pas de coords, on recalcule comme snapToDraw
    if (typeof finalX !== 'number' || typeof finalY !== 'number') {
      if (draw) {
        const dr = draw.getBoundingClientRect();
        const xCenter = dr.left - boardRect.left + (dr.width  - card.offsetWidth)/2;
        const yCenter = dr.top  - boardRect.top  + (dr.height - card.offsetHeight)/2;
        finalX = xCenter;
        finalY = yCenter;
      } else {
        finalX = boardRect.width/2  - card.offsetWidth/2;
        finalY = boardRect.height/2 - card.offsetHeight/2;
      }
    }

    card.style.left = finalX + 'px';
    card.style.top  = finalY + 'px';

    if (typeof zTop === 'number') {
      card.style.zIndex = (++zTop).toString();
    }

    // mettre à jour le progress local + voyant famille neutre
    if (typeof progress === 'object' && typeof toPct === 'function') {
      const { xPct, yPct } = toPct(finalX, finalY, boardRect);
      progress[cardId] = {
        ...(progress[cardId] || {}),
        x: finalX,
        y: finalY,
        xPct,
        yPct,
        inDraw: true,
        familleBonne: undefined,
        familleTrouvée: false,
        zone: null
      };
      saveProgress();
      refreshFamilyIndicator(cardId);
      updateFamilyProgress();
    }
  });

  // 8) État initial (placements + infos trouvées)
  socket.on('state:init', ({ families, infosFound }) => {
    console.log('[collab] state:init', families, infosFound);

    // a) appliquer les placements de familles
    if (families) {
      Object.entries(families).forEach(([famKey, cardIds]) => {
        const zone = findFamilyZone(famKey);
        if (!zone) return;
        (cardIds || []).forEach(cardId => {
          const card = findCard(cardId);
          if (card) zone.appendChild(card);
        });
      });
    }

    // b) appliquer les infos trouvées (date/auteur/titre) au progress local
    if (infosFound) {
      Object.entries(infosFound).forEach(([cardId, fields]) => {
        const st = progress[cardId] || { date:false, auteur:false, titre:false, completed:false };
        ['date','auteur','titre'].forEach(k => {
          if (fields[k]) st[k] = true;
        });
        st.completed = !!(st.date && st.auteur && st.titre);
        progress[cardId] = st;
      });
      saveProgress();
      applyCompletionClasses();
      updateScore();
    }
  });

  // 9) Quand une info est trouvée par quelqu'un d'autre
  socket.on('info:update', ({ cardId, field }) => {
    console.log('[collab] info:update', cardId, field);
    const st = progress[cardId] || { date:false, auteur:false, titre:false, completed:false };
    st[field] = true;
    st.completed = !!(st.date && st.auteur && st.titre);
    progress[cardId] = st;
    saveProgress();

    // Met à jour les mini-dots sur la carte du board
    const cardElement = document.querySelector(`.card[data-id="${cardId}"]`);
    if (cardElement) {
      const dots = cardElement.querySelectorAll('.dot');
      ['date','auteur','titre'].forEach((k,i) => {
        if (st[k] && dots[i]) dots[i].classList.add('found');
      });
      if (st.completed) cardElement.classList.add('completed');
      else cardElement.classList.remove('completed');
    }

    // Si la carte est ouverte en zoom sur cet onglet, rafraîchir l’overlay
    if (window.currentCardId === cardId && typeof setFoundInfoFromState === 'function' && typeof renderProgressDots === 'function') {
      setFoundInfoFromState(cardId);
      renderProgressDots(cardId);
    }

    if (typeof applyCompletionClasses === 'function') applyCompletionClasses();
    if (typeof updateScore === 'function') updateScore();
  });

  // 🔁 Curseurs des autres joueurs (déplacés AU NIVEAU GLOBAL)
  socket.on('cursor:move', ({ id, x, y, color, name }) => {
    if (!id || id === selfId) return;

    const info = peers[id] || {};
    const finalColor = color || info.color || '#ffffff';
    const finalName  = name || info.name || '';
    peers[id] = { name: finalName, color: finalColor };

    const el = getOrCreateCursor(id, finalColor, finalName);
    const px = x * window.innerWidth;
    const py = y * window.innerHeight;
    el.style.left = px + 'px';
    el.style.top  = py + 'px';
    el.style.display = 'block';
  });

  socket.on('cursor:hide', ({ id }) => {
    const el = remoteCursors[id];
    if (el) el.style.display = 'none';
  });

  // 10) Demander l'état initial
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => socket.emit('client:ready'));
  } else {
    socket.emit('client:ready');
  }

  // 11) Reset partagé
  socket.on('reset', () => {
    console.log('[collab] reset reçu (depuis un autre joueur)');
    if (typeof resetGame === 'function') {
      resetGame();
    } else {
      location.reload();
    }
  });

  // 12) Envoyer nos propres mouvements de souris (throttlés)
  let hasSentCursorOnce = false;

  document.addEventListener('click', (e) => {
    if (!window.socketCollab) return;
    if (hasSentCursorOnce) return; // déjà envoyé une première fois

    hasSentCursorOnce = true;
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    window.socketCollab.emit('cursor:move', { x, y });
  });

  let lastCursorSent = 0;
  document.addEventListener('mousemove', (e) => {
    if (!window.socketCollab) return;
    const now = performance.now();
    if (now - lastCursorSent < 40) return; // ~25 fps max
    lastCursorSent = now;
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    window.socketCollab.emit('cursor:move', { x, y });
  });

  window.addEventListener('blur', () => {
    if (window.socketCollab) {
      window.socketCollab.emit('cursor:hide', {});
    }
  });
}

// --- MODE COOP (activation / désactivation) ---
document.addEventListener('DOMContentLoaded', () => {
  const coopButton = document.getElementById("coopToggle");
  if (!coopButton) return;

  let coopActive = false;

  coopButton.addEventListener("click", () => {
    if (!coopActive) {
      // 🧩 Activation
      coopActive = true;
      coopButton.classList.add("active");
      coopButton.textContent = "Quitter le mode coop";
      console.log("[coop] Activation du mode coop…");
      initCollabSimple(); // démarre la connexion Socket.io
    } else {
      // ❌ Désactivation
      coopActive = false;
      coopButton.classList.remove("active");
      coopButton.textContent = "Mode coop";
      console.log("[coop] Retour au mode solo.");

      // Fermer la connexion Socket.io
      if (window.socketCollab) {
        window.socketCollab.disconnect();
        window.socketCollab = null;
      }

      // Supprimer les curseurs distants affichés
      document.querySelectorAll(".remote-cursor").forEach(el => el.remove());

      // Optionnel : remettre le compteur à 1
      const el = document.getElementById("presence-count");
      if (el) el.textContent = "1";
    }
  });
});