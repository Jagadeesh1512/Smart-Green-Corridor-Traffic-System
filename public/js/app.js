/**
 * app.js
 * Central Dispatch Application Logic & WebSocket Manager
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Canvas Simulator
  const canvasSim = new CorridorCanvasSimulator('corridorCanvas');
  const analyticsDash = new AnalyticsDashboard();

  let ws = null;
  let isConnected = false;
  let lastServerState = null;

  // Web Audio Pedestrian Buzzer Sound Synthesizer
  class PedestrianBuzzerAudio {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.lastBeepTime = 0;
    }

    init() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    playBeep(freq = 880, duration = 0.08) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch (e) {
        console.warn('Audio playback error:', e);
      }
    }

    tick(buzzerHz) {
      if (!buzzerHz || buzzerHz <= 0 || !this.enabled) return;
      const now = performance.now();
      const intervalMs = 1000 / buzzerHz;
      if (now - this.lastBeepTime >= intervalMs) {
        this.lastBeepTime = now;
        // Pitch: 800Hz (1Hz standard), 980Hz (2Hz elderly assist), 1200Hz (4Hz clearance)
        const freq = buzzerHz >= 4 ? 1200 : (buzzerHz >= 2 ? 980 : 800);
        this.playBeep(freq, 0.08);
      }
    }
  }

  const buzzerAudio = new PedestrianBuzzerAudio();

  // Unlock AudioContext on first user interaction anywhere
  window.addEventListener('click', () => buzzerAudio.init(), { once: false });

  // Sound Toggle Button
  const btnToggleSound = document.getElementById('btnToggleSound');
  const soundText = document.getElementById('soundText');
  if (btnToggleSound) {
    btnToggleSound.addEventListener('click', () => {
      buzzerAudio.init();
      buzzerAudio.enabled = !buzzerAudio.enabled;
      if (soundText) {
        soundText.textContent = buzzerAudio.enabled ? 'Audio: ON' : 'Audio: OFF';
      }
      btnToggleSound.className = buzzerAudio.enabled
        ? 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-cyan-300 text-xs font-semibold border border-cyan-500/40 transition'
        : 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-500 text-xs font-semibold border border-gray-700 transition';
    });
  }

  // UI Element References
  const wsStatusPill = document.getElementById('wsStatusPill');
  const wsPingText = document.getElementById('wsPingText');
  const btnDispatchAmbulance = document.getElementById('btnDispatchAmbulance');
  const btnResetAmbulance = document.getElementById('btnResetAmbulance');
  const btnForceGreen = document.getElementById('btnForceGreen');
  const btnResetOverride = document.getElementById('btnResetOverride');
  const intersectionsContainer = document.getElementById('intersectionsContainer');
  const hardwareTableBody = document.getElementById('hardwareTableBody');
  const ambProgressBar = document.getElementById('ambProgressBar');
  const ambProgressPct = document.getElementById('ambProgressPct');
  const ambSpeedText = document.getElementById('ambSpeedText');
  const ambStatusBadge = document.getElementById('ambStatusBadge');
  const ambBeaconRssi = document.getElementById('ambBeaconRssi');

  // Community Zone interactive buttons
  const btnElderlyAssist = document.getElementById('btnElderlyAssist');
  const btnStandardPed = document.getElementById('btnStandardPed');
  const toggleUltrasonic = document.getElementById('toggleUltrasonic');

  // WebSocket Connection Setup
  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      isConnected = true;
      if (wsStatusPill) {
        wsStatusPill.className = 'flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
        wsStatusPill.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> SUB-SECOND SYNC ONLINE';
      }
    };

    ws.onclose = () => {
      isConnected = false;
      if (wsStatusPill) {
        wsStatusPill.className = 'flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30';
        wsStatusPill.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-400"></span> RECONNECTING...';
      }
      setTimeout(connectWebSocket, 1500);
    };

    ws.onerror = (err) => {
      console.error('WebSocket Error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'STATE_UPDATE') {
          lastServerState = data;
          handleStateUpdate(data);
        }
      } catch (e) {
        console.error('Error parsing state update:', e);
      }
    };
  }

  connectWebSocket();

  // Send action via WebSocket or fallback to fetch
  function sendAction(actionObj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(actionObj));
    } else {
      // Fallback to REST
      if (actionObj.type === 'DISPATCH_AMBULANCE') {
        fetch('/api/emergency/dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ambulanceId: actionObj.id }) });
      } else if (actionObj.type === 'CORRIDOR_OVERRIDE') {
        fetch('/api/emergency/override', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forceGreen: actionObj.forceGreen }) });
      }
    }
  }

  // Handle Full Sub-Second State Update
  function handleStateUpdate(state) {
    // 1. Update Canvas Simulator
    if (canvasSim) {
      canvasSim.updateState(state.traffic, state.corridor);
    }

    // 2. Update Analytics
    if (analyticsDash && state.analytics) {
      analyticsDash.updateMetrics(state.analytics);
    }

    // 3. Update Ambulance Tracking Widget
    updateAmbulanceWidget(state.corridor);

    // 4. Update Intersection Cards
    updateIntersectionsUI(state.traffic);

    // 5. Update Hardware Telemetry Table
    updateHardwareTable(state.hardware);

    // 6. Audio Synthesizer: Play real pedestrian beeps for Community Zone (INT-3) only when active
    const int3 = (state.traffic && state.traffic.intersections) ? state.traffic.intersections['INT-3'] : null;
    const buzzerHz = (int3 && int3.signals.pedestrian) ? (int3.signals.pedestrian.buzzerHz || 0) : 0;
    buzzerAudio.tick(buzzerHz);

    // 7. Update Crosswalk Status Pill & Button Text for Community Zone
    const turnStatusBadge = document.getElementById('turnStatusBadge');
    const btnElderlyText = document.getElementById('btnElderlyText');
    const radarStatusPill = document.getElementById('radarStatusPill');

    if (int3) {
      if (toggleUltrasonic && !int3.sensors.crosswalkOccupied && int3.safetyHoldRemaining === 0 && int3.signals.pedestrian.state === 'DONT_WALK') {
        toggleUltrasonic.checked = false;
      }

      if (radarStatusPill) {
        if (int3.sensors && int3.sensors.crosswalkOccupied) {
          radarStatusPill.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse font-bold';
          radarStatusPill.textContent = 'DETECTED (48cm)';
        } else {
          radarStatusPill.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
          radarStatusPill.textContent = 'CLEAR (280cm)';
        }
      }

      if (turnStatusBadge && btnElderlyText) {
        const isWalking = (int3.signals.pedestrian.state === 'WALK' || int3.signals.pedestrian.state === 'CLEARANCE');
        const countdown = int3.signals.pedestrian.countdown || 0;

        if (int3.safetyHoldRemaining > 0) {
          turnStatusBadge.className = 'font-bold text-rose-400 animate-pulse';
          turnStatusBadge.textContent = `🚨 Radar Hold Active (+${int3.safetyHoldRemaining}s)`;
          btnElderlyText.textContent = `🚨 Radar Hold (+${int3.safetyHoldRemaining}s)`;
        } else if (isWalking && countdown > 4) {
          turnStatusBadge.className = 'font-bold text-amber-300 animate-pulse';
          turnStatusBadge.textContent = `Walk Active (${countdown - 4}s left)`;
          btnElderlyText.textContent = `Walking (${countdown}s)`;
        } else if (isWalking && countdown <= 4 && countdown > 0) {
          turnStatusBadge.className = 'font-bold text-emerald-400';
          turnStatusBadge.textContent = `Safe on Sidewalk (+${countdown}s buffer)`;
          btnElderlyText.textContent = `Safe on Sidewalk`;
        } else if (int3.lastCompletedTurn > 0) {
          turnStatusBadge.className = 'font-bold text-emerald-400';
          turnStatusBadge.textContent = `Safe on Sidewalk`;
          btnElderlyText.textContent = `♿ Timed Walk Assist`;
        } else {
          turnStatusBadge.className = 'font-bold text-amber-300';
          turnStatusBadge.textContent = 'Ready';
          btnElderlyText.textContent = '♿ Timed Walk Assist';
        }
      }
    }
  }

  function updateAmbulanceWidget(corridor) {
    if (!corridor || !corridor.ambulances) return;
    const amb = corridor.ambulances['AMB-101'];
    if (!amb) return;

    const totalLen = corridor.corridorLength || 1350;
    const pct = Math.min(100, Math.round((amb.position / totalLen) * 100));

    if (ambProgressBar) ambProgressBar.style.width = `${pct}%`;
    if (ambProgressPct) ambProgressPct.textContent = `${pct}% (${Math.round(amb.position)}m / ${totalLen}m)`;
    if (ambSpeedText) ambSpeedText.textContent = `${Math.round(amb.speedKmh)} km/h`;

    if (ambStatusBadge) {
      if (amb.status === 'EN_ROUTE') {
        ambStatusBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse';
        ambStatusBadge.textContent = 'CODE 3 EN ROUTE';
      } else if (amb.status === 'ARRIVED') {
        ambStatusBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
        ambStatusBadge.textContent = 'ARRIVED AT HOSPITAL';
      } else {
        ambStatusBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-gray-700/50 text-gray-300 border border-gray-600';
        ambStatusBadge.textContent = 'STANDBY AT DEPOT';
      }
    }

    // Beacon RSSI
    let maxRssi = null;
    if (lastServerState && lastServerState.traffic) {
      for (const id in lastServerState.traffic.intersections) {
        const rssi = lastServerState.traffic.intersections[id].sensors.ambulanceBeaconRSSI;
        if (rssi !== null && (maxRssi === null || rssi > maxRssi)) {
          maxRssi = rssi;
        }
      }
    }
    if (ambBeaconRssi) {
      ambBeaconRssi.textContent = maxRssi !== null ? `${maxRssi} dBm (Locked)` : 'No Signal (Standby)';
    }
  }

  let lastIntersectionsHtml = '';
  function updateIntersectionsUI(traffic) {
    if (!traffic || !traffic.intersections || !intersectionsContainer) return;

    const ids = ['INT-1', 'INT-2', 'INT-3', 'INT-4'];
    const newHtml = ids.map(id => {
      const int = traffic.intersections[id];
      if (!int) return '';

      const isPreempted = int.preemption && int.preemption.active;
      const isCommunity = int.isCommunityZone;
      const isElderlyActive = int.signals.pedestrian.assistActive;
      const pedCount = int.signals.pedestrian.countdown;
      const pedState = int.signals.pedestrian.state;
      const isPending = Boolean(int.pendingPedestrianRequest);

      // Glow borders
      let cardBorder = 'border-gray-800';
      if (isPreempted) cardBorder = 'border-rose-500 siren-active';
      else if (isCommunity && isElderlyActive) cardBorder = 'border-amber-500 shadow-amber-500/20';
      else if (isPending) cardBorder = 'border-cyan-500/50 shadow-cyan-500/10';

      return `
        <div class="glass-panel p-4 rounded-xl border ${cardBorder} flex flex-col justify-between transition-all">
          <!-- Card Header -->
          <div class="flex items-start justify-between mb-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="font-bold text-sm tracking-wide text-white">${int.id}</span>
                ${isCommunity ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">♿ COMMUNITY ZONE</span>' : ''}
              </div>
              <div class="text-[11px] text-gray-400 truncate max-w-[170px]">${int.name}</div>
            </div>
            ${isPreempted ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse">PREEMPTION</span>' : ''}
          </div>

          <!-- Signal Lights Visual Grid -->
          <div class="grid grid-cols-2 gap-3 bg-black/30 p-3 rounded-lg border border-white/5 mb-3">
            <!-- Corridor Arterial Lights -->
            <div class="flex flex-col items-center">
              <span class="text-[10px] uppercase font-semibold text-gray-400 mb-1.5">Corridor (EW)</span>
              <div class="traffic-housing">
                <div class="traffic-bulb red ${int.signals.corridor.red ? 'active' : ''}"></div>
                <div class="traffic-bulb yellow ${int.signals.corridor.yellow ? 'active' : ''}"></div>
                <div class="traffic-bulb green ${int.signals.corridor.green ? 'active' : ''}"></div>
              </div>
            </div>

            <!-- Cross Street Lights -->
            <div class="flex flex-col items-center">
              <span class="text-[10px] uppercase font-semibold text-gray-400 mb-1.5">Cross (NS)</span>
              <div class="traffic-housing">
                <div class="traffic-bulb red ${int.signals.cross.red ? 'active' : ''}"></div>
                <div class="traffic-bulb yellow ${int.signals.cross.yellow ? 'active' : ''}"></div>
                <div class="traffic-bulb green ${int.signals.cross.green ? 'active' : ''}"></div>
              </div>
            </div>
          </div>

          <!-- Pedestrian Signal & Assist Status -->
          <div class="bg-gray-900/60 p-2.5 rounded-lg border border-white/5 mb-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="ped-icon ${pedState === 'WALK' ? 'walk' : (pedState === 'CLEARANCE' ? 'clearance' : 'dont-walk')}">
                  ${pedState === 'WALK' ? '🚶 WALK' : (pedState === 'CLEARANCE' ? '⚠️ FLASH' : '🛑 STOP')}
                </div>
              </div>
              <div class="font-mono text-sm font-bold ${pedState === 'WALK' ? 'text-emerald-400' : 'text-gray-500'}">
                ${pedCount > 0 ? `${pedCount}s` : '--'}
              </div>
            </div>

            ${isPending ? `
              <div class="mt-2 text-[10px] font-semibold text-cyan-300 bg-cyan-500/10 px-2 py-1 rounded border border-cyan-500/20 flex items-center justify-between animate-pulse">
                <span>⏳ Walk Call Registered</span>
                <span class="font-mono">Stopping Traffic...</span>
              </div>
            ` : ''}

            ${isElderlyActive ? `
              <div class="mt-2 text-[10px] font-semibold text-amber-300 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20 flex items-center justify-between">
                <span>♿ Dynamic Extension Active</span>
                <span class="font-mono">+14s</span>
              </div>
            ` : ''}

            ${int.safetyHoldRemaining > 0 ? `
              <div class="mt-2 text-[10px] font-semibold text-rose-400 bg-rose-500/10 px-2 py-1 rounded border border-rose-500/20 animate-pulse">
                🚨 Ultrasonic Radar Hold: Pedestrian in Crosswalk (+${int.safetyHoldRemaining}s)
              </div>
            ` : ''}
          </div>

          <!-- Quick Interactive Pedestrian Trigger Buttons -->
          <div class="flex gap-2">
            <button data-ped-trigger data-int-id="${int.id}" data-type="STANDARD" class="flex-1 py-1.5 px-2 rounded bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-gray-200 text-[10px] font-bold border border-gray-600 transition flex items-center justify-center gap-1 cursor-pointer">
              <span>🚶</span> Call Walk
            </button>
            <button data-ped-trigger data-int-id="${int.id}" data-type="ELDERLY_ASSIST" class="flex-1 py-1.5 px-2 rounded bg-amber-500/20 hover:bg-amber-500/30 active:bg-amber-500/40 text-amber-300 text-[10px] font-bold border border-amber-500/40 transition flex items-center justify-center gap-1 cursor-pointer">
              <span>♿</span> Assist (+14s)
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (newHtml !== lastIntersectionsHtml) {
      intersectionsContainer.innerHTML = newHtml;
      lastIntersectionsHtml = newHtml;
    }
  }

  function updateHardwareTable(hardware) {
    if (!hardware || !hardwareTableBody) return;

    hardwareTableBody.innerHTML = Object.keys(hardware).map(id => {
      const node = hardware[id];
      return `
        <tr class="border-b border-gray-800/60 hover:bg-white/[0.02] text-xs">
          <td class="py-2.5 px-3 font-semibold text-white flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            ${node.id}
          </td>
          <td class="py-2.5 px-3 font-mono text-gray-400">${node.mac}</td>
          <td class="py-2.5 px-3 text-gray-300">${node.location}</td>
          <td class="py-2.5 px-3 font-mono text-emerald-400">${node.pingMs}ms</td>
          <td class="py-2.5 px-3 font-mono text-gray-400">${node.wifiRssi} dBm</td>
          <td class="py-2.5 px-3">
            <div class="flex gap-1 items-center">
              <span class="px-1.5 py-0.5 rounded text-[9px] ${node.gpio.PIN_14_EW_GREEN ? 'bg-emerald-500/30 text-emerald-300' : 'bg-gray-800 text-gray-500'}">EW:G</span>
              <span class="px-1.5 py-0.5 rounded text-[9px] ${node.gpio.PIN_27_NS_GREEN ? 'bg-emerald-500/30 text-emerald-300' : 'bg-gray-800 text-gray-500'}">NS:G</span>
              <span class="px-1.5 py-0.5 rounded text-[9px] ${node.gpio.PIN_33_PED_GREEN ? 'bg-cyan-500/30 text-cyan-300' : 'bg-gray-800 text-gray-500'}">PED:W</span>
              ${node.id === 'INT-3' ? `
                <span class="px-1.5 py-0.5 rounded text-[9px] font-mono ${node.gpio.PIN_21_ULTRASONIC_CM < 100 ? 'bg-rose-500/30 text-rose-300 font-bold animate-pulse' : 'bg-gray-800 text-gray-400'}">
                  RADAR:${node.gpio.PIN_21_ULTRASONIC_CM}cm
                </span>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Delegated event listener for intersection card buttons
  if (intersectionsContainer) {
    intersectionsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ped-trigger]');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const intId = btn.getAttribute('data-int-id');
        const type = btn.getAttribute('data-type');
        window.triggerPed(intId, type);
      }
    });
  }

  // Global button handlers
  window.triggerPed = (intId, type) => {
    sendAction({
      type: 'PEDESTRIAN_BUTTON',
      intersectionId: intId,
      assistType: type
    });
  };

  if (btnDispatchAmbulance) {
    btnDispatchAmbulance.addEventListener('click', () => {
      sendAction({ type: 'DISPATCH_AMBULANCE', id: 'AMB-101' });
    });
  }

  if (btnResetAmbulance) {
    btnResetAmbulance.addEventListener('click', () => {
      sendAction({ type: 'RESET_AMBULANCE', id: 'AMB-101' });
    });
  }

  if (btnForceGreen) {
    btnForceGreen.addEventListener('click', () => {
      sendAction({ type: 'CORRIDOR_OVERRIDE', forceGreen: true });
    });
  }

  if (btnResetOverride) {
    btnResetOverride.addEventListener('click', () => {
      sendAction({ type: 'CORRIDOR_OVERRIDE', forceGreen: false });
    });
  }

  if (btnElderlyAssist) {
    btnElderlyAssist.addEventListener('click', () => {
      sendAction({ type: 'PEDESTRIAN_BUTTON', intersectionId: 'INT-3', assistType: 'ELDERLY_ASSIST' });
    });
  }

  if (btnStandardPed) {
    btnStandardPed.addEventListener('click', () => {
      sendAction({ type: 'PEDESTRIAN_BUTTON', intersectionId: 'INT-3', assistType: 'STANDARD' });
    });
  }

  const btnDemoRadarHold = document.getElementById('btnDemoRadarHold');
  if (btnDemoRadarHold) {
    btnDemoRadarHold.addEventListener('click', () => {
      if (toggleUltrasonic) toggleUltrasonic.checked = true;
      sendAction({ type: 'SET_OCCUPIED', intersectionId: 'INT-3', occupied: true });
      sendAction({ type: 'PEDESTRIAN_BUTTON', intersectionId: 'INT-3', assistType: 'ELDERLY_ASSIST' });
    });
  }

  if (toggleUltrasonic) {
    toggleUltrasonic.addEventListener('change', (e) => {
      sendAction({ type: 'SET_OCCUPIED', intersectionId: 'INT-3', occupied: e.target.checked });
    });
  }
});
