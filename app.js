(() => {
  "use strict";

  const APP_PREFIX = "BNAV_P2P_V1:";
  const BOARD_SIZE = 10;
  const ROWS = "ABCDEFGHIJ".split("");
  const STORAGE_KEY = "bnav_p2p_state_v1";
  const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

  const SHIP_DEFS = [
    { id: "carrier", name: "Portaerei", size: 5 },
    { id: "battleship", name: "Corazzata", size: 4 },
    { id: "cruiser", name: "Incrociatore", size: 3 },
    { id: "submarine", name: "Sottomarino", size: 3 },
    { id: "destroyer", name: "Cacciatorpediniere", size: 2 }
  ];

  const state = {
    role: null,
    gameId: null,
    playerId: makeId("p"),
    peerPlayerId: null,
    connectionStatus: "idle",
    pc: null,
    channel: null,
    selectedShipId: SHIP_DEFS[0].id,
    orientation: "horizontal",
    ownShips: [],
    shotsReceived: [],
    opponentShots: {},
    fleetReadyLocal: false,
    fleetReadyRemote: false,
    gameStatus: "idle",
    currentTurnRole: null,
    pendingShot: null,
    processedMessageIds: new Set(),
    log: []
  };

  const els = {
    resetAppBtn: document.getElementById("resetAppBtn"),
    statusTitle: document.getElementById("statusTitle"),
    statusText: document.getElementById("statusText"),
    connectionDot: document.getElementById("connectionDot"),
    tabs: Array.from(document.querySelectorAll(".step-tab")),
    panels: {
      connect: document.getElementById("connectStep"),
      place: document.getElementById("placeStep"),
      play: document.getElementById("playStep")
    },
    hostBtn: document.getElementById("hostBtn"),
    guestModeBtn: document.getElementById("guestModeBtn"),
    hostPanel: document.getElementById("hostPanel"),
    guestPanel: document.getElementById("guestPanel"),
    offerText: document.getElementById("offerText"),
    copyOfferBtn: document.getElementById("copyOfferBtn"),
    shareOfferBtn: document.getElementById("shareOfferBtn"),
    answerInput: document.getElementById("answerInput"),
    acceptAnswerBtn: document.getElementById("acceptAnswerBtn"),
    offerInput: document.getElementById("offerInput"),
    createAnswerBtn: document.getElementById("createAnswerBtn"),
    guestAnswerBox: document.getElementById("guestAnswerBox"),
    guestAnswerText: document.getElementById("guestAnswerText"),
    copyAnswerBtn: document.getElementById("copyAnswerBtn"),
    shareAnswerBtn: document.getElementById("shareAnswerBtn"),
    orientationBtn: document.getElementById("orientationBtn"),
    autoPlaceBtn: document.getElementById("autoPlaceBtn"),
    clearFleetBtn: document.getElementById("clearFleetBtn"),
    shipList: document.getElementById("shipList"),
    fleetCounter: document.getElementById("fleetCounter"),
    placementBoard: document.getElementById("placementBoard"),
    readyBtn: document.getElementById("readyBtn"),
    turnTitle: document.getElementById("turnTitle"),
    turnText: document.getElementById("turnText"),
    attackCounter: document.getElementById("attackCounter"),
    damageCounter: document.getElementById("damageCounter"),
    attackBoard: document.getElementById("attackBoard"),
    ownBoard: document.getElementById("ownBoard"),
    gameLog: document.getElementById("gameLog")
  };

  init();

  function init() {
    bindEvents();
    registerServiceWorker();
    restoreLocalState();
    renderAll();
  }

  function bindEvents() {
    els.tabs.forEach((tab) => {
      tab.addEventListener("click", () => setStep(tab.dataset.step));
    });

    els.resetAppBtn.addEventListener("click", () => {
      if (!confirm("Vuoi azzerare questa partita su questo telefono?")) return;
      tryClosePeer();
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });

    els.hostBtn.addEventListener("click", createHostGame);
    els.guestModeBtn.addEventListener("click", () => {
      els.hostPanel.classList.add("hidden");
      els.guestPanel.classList.remove("hidden");
      setStatus("pairing", "Modalità guest", "Incolla l’offerta generata dal primo telefono.");
    });

    els.copyOfferBtn.addEventListener("click", () => copyText(els.offerText.value));
    els.shareOfferBtn.addEventListener("click", () => shareText("Battaglia Navale - codice host", els.offerText.value));
    els.acceptAnswerBtn.addEventListener("click", acceptGuestAnswer);
    els.createAnswerBtn.addEventListener("click", createGuestAnswer);
    els.copyAnswerBtn.addEventListener("click", () => copyText(els.guestAnswerText.value));
    els.shareAnswerBtn.addEventListener("click", () => shareText("Battaglia Navale - codice risposta", els.guestAnswerText.value));

    els.orientationBtn.addEventListener("click", () => {
      state.orientation = state.orientation === "horizontal" ? "vertical" : "horizontal";
      renderPlacement();
      saveLocalState();
    });

    els.autoPlaceBtn.addEventListener("click", () => {
      if (state.fleetReadyLocal) return toast("Flotta già confermata.");
      state.ownShips = autoPlaceFleet();
      selectFirstUnplacedShip();
      log("Flotta piazzata automaticamente.");
      renderPlacement();
      renderOwnBoard();
      saveLocalState();
    });

    els.clearFleetBtn.addEventListener("click", () => {
      if (state.fleetReadyLocal) return toast("Flotta già confermata.");
      state.ownShips = [];
      state.selectedShipId = SHIP_DEFS[0].id;
      renderPlacement();
      renderOwnBoard();
      saveLocalState();
    });

    els.readyBtn.addEventListener("click", confirmFleetReady);
  }

  async function createHostGame() {
    try {
      resetRuntimePeerOnly();
      state.role = "host";
      state.gameId = makeId("g");
      state.gameStatus = "placing";
      state.connectionStatus = "pairing";
      els.hostPanel.classList.remove("hidden");
      els.guestPanel.classList.add("hidden");
      setStatus("pairing", "Creo la partita", "Genero il codice offerta. Potrebbero servire alcuni secondi.");
      saveLocalState();

      const pc = createPeerConnection();
      state.pc = pc;
      const channel = pc.createDataChannel("battaglia-navale", { ordered: true });
      setupDataChannel(channel);

      await pc.setLocalDescription(await pc.createOffer());
      await waitForIceGatheringComplete(pc);

      const signal = encodeSignal({
        kind: "offer",
        gameId: state.gameId,
        playerId: state.playerId,
        sdp: pc.localDescription.toJSON()
      });

      els.offerText.value = signal;
      setStatus("pairing", "Offerta pronta", "Inviala al secondo telefono e poi incolla qui la risposta.");
      toast("Codice host generato.");
      renderAll();
    } catch (error) {
      console.error(error);
      setStatus("error", "Errore collegamento", getErrorMessage(error));
      toast("Non riesco a creare la partita.");
    }
  }

  async function createGuestAnswer() {
    try {
      const rawOffer = els.offerInput.value.trim();
      if (!rawOffer) return toast("Incolla prima il codice host.");

      const offer = decodeSignal(rawOffer);
      if (offer.kind !== "offer") throw new Error("Il codice non è un’offerta host valida.");

      resetRuntimePeerOnly();
      state.role = "guest";
      state.gameId = offer.gameId;
      state.peerPlayerId = offer.playerId;
      state.gameStatus = "placing";
      state.connectionStatus = "pairing";
      setStatus("pairing", "Genero risposta", "Attendi la risposta WebRTC da inviare all’host.");
      saveLocalState();

      const pc = createPeerConnection();
      state.pc = pc;
      pc.ondatachannel = (event) => setupDataChannel(event.channel);

      await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));
      await pc.setLocalDescription(await pc.createAnswer());
      await waitForIceGatheringComplete(pc);

      const answer = encodeSignal({
        kind: "answer",
        gameId: state.gameId,
        playerId: state.playerId,
        sdp: pc.localDescription.toJSON()
      });

      els.guestAnswerText.value = answer;
      els.guestAnswerBox.classList.remove("hidden");
      setStatus("pairing", "Risposta pronta", "Invia questo codice all’host. Il collegamento si aprirà quando l’host lo importa.");
      toast("Risposta generata.");
      renderAll();
    } catch (error) {
      console.error(error);
      setStatus("error", "Offerta non valida", getErrorMessage(error));
      toast("Non riesco a generare la risposta.");
    }
  }

  async function acceptGuestAnswer() {
    try {
      if (!state.pc || state.role !== "host") return toast("Crea prima una partita host.");
      const rawAnswer = els.answerInput.value.trim();
      if (!rawAnswer) return toast("Incolla prima la risposta del guest.");

      const answer = decodeSignal(rawAnswer);
      if (answer.kind !== "answer") throw new Error("Il codice non è una risposta guest valida.");
      if (answer.gameId !== state.gameId) throw new Error("La risposta appartiene a un’altra partita.");

      state.peerPlayerId = answer.playerId;
      await state.pc.setRemoteDescription(new RTCSessionDescription(answer.sdp));
      setStatus("pairing", "Risposta importata", "Attendo apertura del canale dati.");
      saveLocalState();
    } catch (error) {
      console.error(error);
      setStatus("error", "Risposta non valida", getErrorMessage(error));
      toast("Non riesco a completare il collegamento.");
    }
  }

  function createPeerConnection() {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onconnectionstatechange = () => {
      const status = pc.connectionState;
      if (status === "connected") {
        state.connectionStatus = "connected";
        setStatus("connected", "Telefoni collegati", "Ora potete posizionare le flotte.");
        setStep("place");
      } else if (["failed", "closed", "disconnected"].includes(status)) {
        state.connectionStatus = status === "closed" ? "idle" : "error";
        setStatus("error", "Connessione persa", "Ricollega i telefoni creando una nuova partita.");
      } else if (status === "connecting") {
        state.connectionStatus = "pairing";
        setStatus("pairing", "Collegamento in corso", "Sto aprendo il canale tra i due telefoni.");
      }
      renderAll();
      saveLocalState();
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        setStatus("error", "ICE fallito", "La rete blocca il collegamento diretto. Prova stessa Wi‑Fi o hotspot.");
      }
    };

    return pc;
  }

  function setupDataChannel(channel) {
    state.channel = channel;

    channel.onopen = () => {
      state.connectionStatus = "connected";
      setStatus("connected", "Telefoni collegati", "Canale dati aperto. Posizionate le flotte.");
      sendPeerMessage({ type: "HELLO", playerId: state.playerId, role: state.role, gameId: state.gameId });
      setStep("place");
      renderAll();
      saveLocalState();
    };

    channel.onclose = () => {
      state.connectionStatus = "error";
      setStatus("error", "Canale chiuso", "La partita non può continuare senza ricollegamento.");
      renderAll();
      saveLocalState();
    };

    channel.onerror = () => {
      setStatus("error", "Errore canale", "Errore nel canale peer-to-peer.");
    };

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handlePeerMessage(message);
      } catch (error) {
        console.error(error);
        toast("Messaggio ricevuto non valido.");
      }
    };
  }

  function handlePeerMessage(message) {
    if (!message || typeof message.type !== "string") return;

    if (message.messageId) {
      if (state.processedMessageIds.has(message.messageId)) return;
      state.processedMessageIds.add(message.messageId);
    }

    switch (message.type) {
      case "HELLO": {
        state.peerPlayerId = message.playerId;
        log("Avversario collegato.");
        break;
      }
      case "FLEET_READY": {
        state.fleetReadyRemote = true;
        log("L’avversario ha confermato la flotta.");
        maybeStartGame();
        break;
      }
      case "SHOT": {
        receiveShot(message);
        break;
      }
      case "SHOT_RESULT": {
        receiveShotResult(message);
        break;
      }
      case "GAME_OVER": {
        state.gameStatus = "finished";
        log(message.winnerRole === state.role ? "Hai vinto." : "Hai perso.");
        break;
      }
      default:
        console.warn("Tipo messaggio sconosciuto", message);
    }

    renderAll();
    saveLocalState();
  }

  function confirmFleetReady() {
    if (!validateFleet(state.ownShips)) return toast("Devi piazzare tutte le navi.");
    if (!isChannelOpen()) return toast("Collega prima i due telefoni.");
    if (state.fleetReadyLocal) return toast("Flotta già confermata.");

    state.fleetReadyLocal = true;
    log("Hai confermato la flotta.");
    sendPeerMessage({ type: "FLEET_READY", messageId: makeId("m"), playerId: state.playerId });
    maybeStartGame();
    renderAll();
    saveLocalState();
  }

  function maybeStartGame() {
    if (!state.fleetReadyLocal || !state.fleetReadyRemote) return;
    if (state.gameStatus === "finished") return;

    state.gameStatus = "playing";
    state.currentTurnRole = "host";
    log(state.currentTurnRole === state.role ? "Partita iniziata. Tocca a te." : "Partita iniziata. Tocca all’avversario.");
    setStep("play");
  }

  function localAttack(cell) {
    if (state.gameStatus !== "playing") return toast("La partita non è attiva.");
    if (state.currentTurnRole !== state.role) return toast("Non è il tuo turno.");
    if (state.opponentShots[cell]) return toast("Hai già sparato qui.");
    if (!isChannelOpen()) return toast("Connessione non attiva.");

    const messageId = makeId("shot");
    state.pendingShot = { messageId, cell };
    state.currentTurnRole = null;
    log(`Hai sparato su ${cell}. Attendo risposta.`);
    sendPeerMessage({ type: "SHOT", messageId, fromRole: state.role, cell });
    renderAll();
    saveLocalState();
  }

  function receiveShot(message) {
    if (!message.cell || !isValidCell(message.cell)) return;

    const shotResult = resolveShot(message.cell);
    state.shotsReceived.push({ cell: message.cell, result: shotResult.result, shipId: shotResult.shipId || null });

    const reply = {
      type: "SHOT_RESULT",
      messageId: makeId("res"),
      originalMessageId: message.messageId,
      cell: message.cell,
      result: shotResult.result,
      sunkShipName: shotResult.sunkShipName || null,
      gameOver: shotResult.gameOver
    };

    sendPeerMessage(reply);

    if (shotResult.gameOver) {
      state.gameStatus = "finished";
      state.currentTurnRole = null;
      log(`L’avversario ha sparato su ${message.cell}: ${formatResult(shotResult)}. Hai perso.`);
      sendPeerMessage({ type: "GAME_OVER", messageId: makeId("over"), winnerRole: remoteRole() });
      return;
    }

    state.gameStatus = "playing";
    state.currentTurnRole = state.role;
    log(`L’avversario ha sparato su ${message.cell}: ${formatResult(shotResult)}. Ora tocca a te.`);
  }

  function receiveShotResult(message) {
    if (!message.cell || !isValidCell(message.cell)) return;
    if (state.pendingShot && message.originalMessageId && state.pendingShot.messageId !== message.originalMessageId) {
      log("Ricevuta una risposta non corrispondente allo sparo in attesa. Ignorata.");
      return;
    }

    state.opponentShots[message.cell] = {
      result: message.result,
      sunkShipName: message.sunkShipName || null
    };
    state.pendingShot = null;

    if (message.gameOver) {
      state.gameStatus = "finished";
      state.currentTurnRole = null;
      log(`Risultato su ${message.cell}: ${formatResult(message)}. Hai vinto.`);
      return;
    }

    state.gameStatus = "playing";
    state.currentTurnRole = remoteRole();
    log(`Risultato su ${message.cell}: ${formatResult(message)}. Tocca all’avversario.`);
  }

  function resolveShot(cell) {
    const existing = state.shotsReceived.find((shot) => shot.cell === cell);
    if (existing) return { result: existing.result, shipId: existing.shipId, gameOver: false };

    const ship = state.ownShips.find((item) => item.cells.includes(cell));
    if (!ship) {
      return { result: "miss", gameOver: false };
    }

    const futureHits = new Set(state.shotsReceived.filter((shot) => shot.result !== "miss").map((shot) => shot.cell));
    futureHits.add(cell);
    const isSunk = ship.cells.every((shipCell) => futureHits.has(shipCell));

    const allSunk = state.ownShips.every((candidate) => {
      if (candidate.id === ship.id) {
        return candidate.cells.every((shipCell) => futureHits.has(shipCell));
      }
      return candidate.cells.every((shipCell) => futureHits.has(shipCell));
    });

    return {
      result: isSunk ? "sunk" : "hit",
      shipId: ship.id,
      sunkShipName: isSunk ? ship.name : null,
      gameOver: allSunk
    };
  }

  function renderAll() {
    renderStatus();
    renderPlacement();
    renderAttackBoard();
    renderOwnBoard();
    renderTurn();
    renderLog();
  }

  function renderStatus() {
    if (state.connectionStatus === "connected") {
      setStatus("connected", "Telefoni collegati", state.role === "host" ? "Sei Host. L’host inizia la partita." : "Sei Guest. L’host inizia la partita.");
    } else if (state.connectionStatus === "idle") {
      setStatus("idle", "Non collegato", "Crea una partita oppure unisciti con un codice offerta.");
    }
  }

  function renderPlacement() {
    els.orientationBtn.textContent = `Orientamento: ${state.orientation === "horizontal" ? "orizzontale" : "verticale"}`;
    els.shipList.innerHTML = "";

    SHIP_DEFS.forEach((ship) => {
      const placed = state.ownShips.some((item) => item.id === ship.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `ship-item ${state.selectedShipId === ship.id ? "selected" : ""} ${placed ? "placed" : ""}`;
      btn.innerHTML = `<span><strong>${ship.name}</strong><br><span class="ship-meta">${ship.size} celle</span></span><span>${placed ? "✓" : "Da piazzare"}</span>`;
      btn.addEventListener("click", () => {
        if (state.fleetReadyLocal) return;
        state.selectedShipId = ship.id;
        renderPlacement();
      });
      els.shipList.appendChild(btn);
    });

    const placedCount = state.ownShips.length;
    els.fleetCounter.textContent = `${placedCount}/${SHIP_DEFS.length}`;
    els.readyBtn.disabled = !validateFleet(state.ownShips) || state.fleetReadyLocal || state.connectionStatus !== "connected";
    els.readyBtn.textContent = state.fleetReadyLocal ? "Flotta confermata" : "Conferma flotta";

    renderGrid(els.placementBoard, (cell) => {
      const cellBtn = makeCellButton(cell);
      const hasShip = state.ownShips.some((ship) => ship.cells.includes(cell));
      if (hasShip) cellBtn.classList.add("ship");
      cellBtn.disabled = state.fleetReadyLocal;
      cellBtn.addEventListener("click", () => placeSelectedShip(cell));
      return cellBtn;
    });
  }

  function renderAttackBoard() {
    const shots = Object.entries(state.opponentShots);
    els.attackCounter.textContent = `${shots.length} colpi`;

    renderGrid(els.attackBoard, (cell) => {
      const cellBtn = makeCellButton(cell);
      const shot = state.opponentShots[cell];
      if (shot) {
        cellBtn.classList.add(shot.result === "miss" ? "miss" : shot.result === "sunk" ? "sunk" : "hit");
        cellBtn.textContent = shot.result === "miss" ? "•" : shot.result === "sunk" ? "◆" : "×";
      }

      const canAttack = state.gameStatus === "playing" && state.currentTurnRole === state.role && !shot;
      cellBtn.disabled = !canAttack;
      if (canAttack) cellBtn.classList.add("targetable");
      cellBtn.addEventListener("click", () => localAttack(cell));
      return cellBtn;
    });
  }

  function renderOwnBoard() {
    const damageCount = state.shotsReceived.filter((shot) => shot.result !== "miss").length;
    els.damageCounter.textContent = `${damageCount} danni`;

    renderGrid(els.ownBoard, (cell) => {
      const cellBtn = makeCellButton(cell);
      cellBtn.disabled = true;
      const hasShip = state.ownShips.some((ship) => ship.cells.includes(cell));
      if (hasShip) cellBtn.classList.add("ship");
      const shot = state.shotsReceived.find((item) => item.cell === cell);
      if (shot) {
        cellBtn.classList.add(shot.result === "miss" ? "miss" : shot.result === "sunk" ? "sunk" : "hit");
        cellBtn.textContent = shot.result === "miss" ? "•" : shot.result === "sunk" ? "◆" : "×";
      }
      return cellBtn;
    });
  }

  function renderTurn() {
    if (state.gameStatus === "finished") {
      const won = Object.values(state.opponentShots).some((shot) => shot.gameOver);
      els.turnTitle.textContent = "Partita conclusa";
      els.turnText.textContent = state.log[0] || "La partita è terminata.";
      return;
    }

    if (state.gameStatus !== "playing") {
      els.turnTitle.textContent = "Partita non iniziata";
      if (!state.fleetReadyLocal) {
        els.turnText.textContent = "Posiziona e conferma la tua flotta.";
      } else if (!state.fleetReadyRemote) {
        els.turnText.textContent = "Aspetto che l’avversario confermi la flotta.";
      } else {
        els.turnText.textContent = "In attesa dell’inizio partita.";
      }
      return;
    }

    if (state.currentTurnRole === state.role) {
      els.turnTitle.textContent = "È il tuo turno";
      els.turnText.textContent = "Tocca una cella nella griglia Attacca.";
    } else if (state.currentTurnRole === remoteRole()) {
      els.turnTitle.textContent = "Turno dell’avversario";
      els.turnText.textContent = "Attendi lo sparo dell’altro telefono.";
    } else {
      els.turnTitle.textContent = "Attendo risposta";
      els.turnText.textContent = "Lo sparo è stato inviato. Aspetto acqua, colpito o affondato.";
    }
  }

  function renderLog() {
    els.gameLog.innerHTML = "";
    state.log.slice(0, 12).forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      els.gameLog.appendChild(li);
    });
  }

  function renderGrid(container, makeButton) {
    container.innerHTML = "";
    allCells().forEach((cell) => container.appendChild(makeButton(cell)));
  }

  function makeCellButton(cell) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cell";
    btn.dataset.cell = cell;
    btn.setAttribute("aria-label", `Cella ${cell}`);
    return btn;
  }

  function placeSelectedShip(startCell) {
    if (state.fleetReadyLocal) return toast("Flotta già confermata.");
    const shipDef = SHIP_DEFS.find((ship) => ship.id === state.selectedShipId);
    if (!shipDef) return;

    const candidateCells = buildShipCells(startCell, shipDef.size, state.orientation);
    if (!candidateCells) return toast("La nave uscirebbe dalla griglia.");

    const otherShips = state.ownShips.filter((ship) => ship.id !== shipDef.id);
    const occupied = new Set(otherShips.flatMap((ship) => ship.cells));
    if (candidateCells.some((cell) => occupied.has(cell))) return toast("Le navi non possono sovrapporsi.");

    state.ownShips = [
      ...otherShips,
      { ...shipDef, cells: candidateCells }
    ].sort((a, b) => SHIP_DEFS.findIndex((ship) => ship.id === a.id) - SHIP_DEFS.findIndex((ship) => ship.id === b.id));

    selectFirstUnplacedShip();
    renderPlacement();
    renderOwnBoard();
    saveLocalState();
  }

  function selectFirstUnplacedShip() {
    const next = SHIP_DEFS.find((ship) => !state.ownShips.some((placed) => placed.id === ship.id));
    state.selectedShipId = next ? next.id : SHIP_DEFS[SHIP_DEFS.length - 1].id;
  }

  function autoPlaceFleet() {
    const ships = [];
    for (const shipDef of SHIP_DEFS) {
      let placed = false;
      for (let attempt = 0; attempt < 800 && !placed; attempt++) {
        const orientation = Math.random() > 0.5 ? "horizontal" : "vertical";
        const row = Math.floor(Math.random() * BOARD_SIZE);
        const col = Math.floor(Math.random() * BOARD_SIZE);
        const startCell = coordToCell(row, col);
        const cells = buildShipCells(startCell, shipDef.size, orientation);
        if (!cells) continue;
        const occupied = new Set(ships.flatMap((ship) => ship.cells));
        if (cells.some((cell) => occupied.has(cell))) continue;
        ships.push({ ...shipDef, cells });
        placed = true;
      }
      if (!placed) throw new Error("Auto piazzamento fallito.");
    }
    return ships;
  }

  function buildShipCells(startCell, size, orientation) {
    const coord = cellToCoord(startCell);
    if (!coord) return null;
    const cells = [];
    for (let i = 0; i < size; i++) {
      const row = coord.row + (orientation === "vertical" ? i : 0);
      const col = coord.col + (orientation === "horizontal" ? i : 0);
      if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
      cells.push(coordToCell(row, col));
    }
    return cells;
  }

  function validateFleet(ships) {
    if (ships.length !== SHIP_DEFS.length) return false;
    return SHIP_DEFS.every((def) => {
      const placed = ships.find((ship) => ship.id === def.id);
      return placed && placed.cells.length === def.size;
    });
  }

  function allCells() {
    const cells = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        cells.push(coordToCell(row, col));
      }
    }
    return cells;
  }

  function cellToCoord(cell) {
    if (!isValidCell(cell)) return null;
    return {
      row: ROWS.indexOf(cell[0]),
      col: Number(cell.slice(1)) - 1
    };
  }

  function coordToCell(row, col) {
    return `${ROWS[row]}${col + 1}`;
  }

  function isValidCell(cell) {
    if (typeof cell !== "string") return false;
    const row = cell[0];
    const col = Number(cell.slice(1));
    return ROWS.includes(row) && Number.isInteger(col) && col >= 1 && col <= BOARD_SIZE;
  }

  function sendPeerMessage(message) {
    if (!isChannelOpen()) {
      toast("Canale non ancora aperto.");
      return;
    }
    state.channel.send(JSON.stringify({ ...message, gameId: state.gameId, sentAt: new Date().toISOString() }));
  }

  function isChannelOpen() {
    return state.channel && state.channel.readyState === "open";
  }

  function waitForIceGatheringComplete(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(done, 4500);
      function done() {
        window.clearTimeout(timeout);
        pc.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }
      function onChange() {
        if (pc.iceGatheringState === "complete") done();
      }
      pc.addEventListener("icegatheringstatechange", onChange);
    });
  }

  function encodeSignal(payload) {
    return APP_PREFIX + base64UrlEncode(JSON.stringify(payload));
  }

  function decodeSignal(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith(APP_PREFIX)) throw new Error("Prefisso codice mancante.");
    return JSON.parse(base64UrlDecode(trimmed.slice(APP_PREFIX.length)));
  }

  function base64UrlEncode(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlDecode(value) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function copyText(text) {
    if (!text) return toast("Non c’è nulla da copiare.");
    try {
      await navigator.clipboard.writeText(text);
      toast("Copiato negli appunti.");
    } catch {
      toast("Copia manualmente il testo.");
    }
  }

  async function shareText(title, text) {
    if (!text) return toast("Non c’è nulla da condividere.");
    if (navigator.share) {
      try {
        await navigator.share({ title, text });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }
    await copyText(text);
  }

  function setStep(step) {
    Object.entries(els.panels).forEach(([key, panel]) => panel.classList.toggle("active", key === step));
    els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.step === step));
  }

  function setStatus(kind, title, text) {
    els.statusTitle.textContent = title;
    els.statusText.textContent = text;
    els.connectionDot.className = `dot ${kind}`;
  }

  function log(text) {
    state.log.unshift(text);
    state.log = state.log.slice(0, 40);
  }

  function toast(text) {
    const old = document.querySelector(".toast");
    if (old) old.remove();
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = text;
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), 2600);
  }

  function remoteRole() {
    return state.role === "host" ? "guest" : "host";
  }

  function formatResult(resultLike) {
    const result = resultLike.result;
    if (result === "miss") return "acqua";
    if (result === "hit") return "colpito";
    if (result === "sunk") return resultLike.sunkShipName ? `affondato (${resultLike.sunkShipName})` : "affondato";
    return "sconosciuto";
  }

  function makeId(prefix) {
    const random = crypto.getRandomValues(new Uint32Array(2));
    return `${prefix}_${Date.now().toString(36)}_${Array.from(random).map((n) => n.toString(36)).join("")}`;
  }

  function tryClosePeer() {
    try { if (state.channel) state.channel.close(); } catch {}
    try { if (state.pc) state.pc.close(); } catch {}
  }

  function resetRuntimePeerOnly() {
    tryClosePeer();
    state.pc = null;
    state.channel = null;
    state.connectionStatus = "idle";
  }

  function saveLocalState() {
    const serializable = {
      role: state.role,
      gameId: state.gameId,
      playerId: state.playerId,
      peerPlayerId: state.peerPlayerId,
      selectedShipId: state.selectedShipId,
      orientation: state.orientation,
      ownShips: state.ownShips,
      shotsReceived: state.shotsReceived,
      opponentShots: state.opponentShots,
      fleetReadyLocal: state.fleetReadyLocal,
      fleetReadyRemote: state.fleetReadyRemote,
      gameStatus: state.gameStatus,
      currentTurnRole: state.currentTurnRole,
      pendingShot: state.pendingShot,
      processedMessageIds: Array.from(state.processedMessageIds),
      log: state.log
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  }

  function restoreLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      Object.assign(state, {
        ...saved,
        pc: null,
        channel: null,
        connectionStatus: "idle",
        processedMessageIds: new Set(saved.processedMessageIds || [])
      });
      if (state.gameId) {
        log("Stato locale recuperato. La connessione WebRTC va ricreata.");
      }
    } catch (error) {
      console.warn("Impossibile recuperare stato", error);
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function getErrorMessage(error) {
    return error && error.message ? error.message : "Errore sconosciuto.";
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("SW non registrato", error));
    });
  }
})();
