/**
 * corridorSimulator.js
 * High-performance 2D Canvas simulator for the Smart Green-Corridor.
 * Renders microscopic traffic, pedestrian movements, emergency vehicle progression,
 * and real-time signal heads with sub-second synchronization.
 */

class CorridorCanvasSimulator {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    // Corridor dimensions & mapping
    this.totalCorridorMeters = 1350;
    this.intersections = [
      { id: 'INT-1', name: '1st Ave', meters: 150, isCommunityZone: false },
      { id: 'INT-2', name: 'Central Blvd', meters: 500, isCommunityZone: false },
      { id: 'INT-3', name: 'Community Center (Senior Living)', meters: 850, isCommunityZone: true },
      { id: 'INT-4', name: 'Civic Gate', meters: 1150, isCommunityZone: false }
    ];

    // State cache from WebSocket
    this.latestTrafficState = null;
    this.latestAmbulanceState = null;

    // Background vehicles
    this.backgroundCars = [];
    this.initBackgroundCars();

    // Pedestrians
    this.pedestrians = [];
    this.initPedestrians();

    // Resize handler
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Animation loop
    this.lastTime = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = 360 * window.devicePixelRatio;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `360px`;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.width = rect.width;
    this.height = 360;
  }

  updateState(trafficState, corridorState) {
    this.latestTrafficState = trafficState;
    if (corridorState && corridorState.ambulances) {
      this.latestAmbulanceState = corridorState.ambulances['AMB-101'];
    }
  }

  initBackgroundCars() {
    this.backgroundCars = [
      { id: 'c1', x: 40, yOffset: -18, currentSpeed: 1.3, baseSpeed: 1.3, color: '#38bdf8', dir: 1, stopped: false },
      { id: 'c2', x: 260, yOffset: -18, currentSpeed: 1.1, baseSpeed: 1.1, color: '#94a3b8', dir: 1, stopped: false },
      { id: 'c3', x: 740, yOffset: 18, currentSpeed: 1.3, baseSpeed: -1.3, color: '#cbd5e1', dir: -1, stopped: false },
      { id: 'c4', x: 1100, yOffset: 18, currentSpeed: 1.1, baseSpeed: -1.1, color: '#f59e0b', dir: -1, stopped: false }
    ];
  }

  initPedestrians() {
    // Pedestrians placed safely at the sidewalk curb across all 4 corridor intersections
    this.pedestrians = [
      {
        intId: 'INT-1',
        progress: 0.0,
        isElderly: false,
        name: 'Student',
        color: '#38bdf8'
      },
      {
        intId: 'INT-2',
        progress: 0.0,
        isElderly: false,
        name: 'Commuter',
        color: '#a78bfa'
      },
      {
        intId: 'INT-3',
        progress: 0.0,
        isElderly: true,
        name: 'Elderly Resident',
        color: '#f59e0b'
      },
      {
        intId: 'INT-4',
        progress: 0.0,
        isElderly: false,
        name: 'Shopper',
        color: '#34d399'
      }
    ];
  }

  metersToX(meters) {
    const margin = 80;
    const usableWidth = this.width - margin * 2;
    return margin + (meters / this.totalCorridorMeters) * usableWidth;
  }

  loop(currentTime) {
    this.currentTime = currentTime || performance.now();
    const dt = (this.currentTime - this.lastTime) / 1000;
    this.lastTime = this.currentTime;

    this.draw(dt, this.currentTime);
    requestAnimationFrame(this.loop);
  }

  draw(dt, currentTime = performance.now()) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // 1. Clear background (Dark modern city grid)
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, w, h);

    // City turf / grass zones
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, 110);
    ctx.fillRect(0, 250, w, 110);

    // Sidewalks
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 110, w, 15);
    ctx.fillRect(0, 235, w, 15);

    // Main Corridor Arterial Asphalt (Hospital Way)
    const roadTop = 125;
    const roadHeight = 110;
    const roadMidY = roadTop + roadHeight / 2;

    ctx.fillStyle = '#1e2430';
    ctx.fillRect(0, roadTop, w, roadHeight);

    // Dashed Center Divider Line (Double Yellow)
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, roadMidY - 2);
    ctx.lineTo(w, roadMidY - 2);
    ctx.moveTo(0, roadMidY + 2);
    ctx.lineTo(w, roadMidY + 2);
    ctx.stroke();

    // White dashed lane dividers
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([12, 16]);
    ctx.beginPath();
    ctx.moveTo(0, roadTop + 28);
    ctx.lineTo(w, roadTop + 28);
    ctx.moveTo(0, roadTop + 82);
    ctx.lineTo(w, roadTop + 82);
    ctx.stroke();
    ctx.setLineDash([]); // Reset line dash

    // Depot marker on left
    ctx.fillStyle = '#334155';
    ctx.fillRect(10, 130, 50, 100);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText('EMS DEPOT', 12, 122);

    // Hospital Trauma marker on right
    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(w - 65, 125, 55, 110);
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 16px Inter, sans-serif';
    ctx.fillText('+', w - 42, 150);
    ctx.fillStyle = '#38bdf8';
    ctx.font = '9px Inter, sans-serif';
    ctx.fillText('TRAUMA CTR', w - 63, 175);

    // 2. Draw Cross Streets and Intersections
    this.intersections.forEach((intDef) => {
      const intX = this.metersToX(intDef.meters);
      const intLive = this.latestTrafficState ? this.latestTrafficState.intersections[intDef.id] : null;
      const streetWidth = 70;

      // Cross street asphalt
      ctx.fillStyle = '#1e2430';
      ctx.fillRect(intX - streetWidth / 2, 0, streetWidth, h);

      // Cross street dashed center line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 10]);
      ctx.beginPath();
      ctx.moveTo(intX, 0);
      ctx.lineTo(intX, roadTop);
      ctx.moveTo(intX, roadTop + roadHeight);
      ctx.lineTo(intX, h);
      ctx.stroke();
      ctx.setLineDash([]);

      // Zebra Crosswalks (North and South)
      this.drawCrosswalk(ctx, intX - streetWidth / 2 + 5, roadTop - 12, streetWidth - 10, 10);
      this.drawCrosswalk(ctx, intX - streetWidth / 2 + 5, roadTop + roadHeight + 2, streetWidth - 10, 10);

      // Community Zone highlight (INT-3)
      if (intDef.isCommunityZone) {
        ctx.fillStyle = 'rgba(6, 182, 212, 0.12)';
        ctx.fillRect(intX - streetWidth / 2 - 20, 0, streetWidth + 40, h);
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(intX - streetWidth / 2 - 20, 0, streetWidth + 40, h);
        ctx.setLineDash([]);

        // Community zone badge
        ctx.fillStyle = '#06b6d4';
        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.fillText('♿ COMMUNITY ZONE', intX - 52, 25);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '8px Inter, sans-serif';
        ctx.fillText('St. Mary Senior Living', intX - 44, 37);

        // Ultrasonic Radar Visualizer & Scanning Waves
        if (intLive && intLive.sensors && intLive.sensors.crosswalkOccupied) {
          ctx.save();
          const wavePulse = (performance.now() % 1200) / 1200;
          ctx.strokeStyle = `rgba(244, 63, 94, ${0.9 - wavePulse * 0.7})`;
          ctx.lineWidth = 1.5;
          for (let r = 1; r <= 3; r++) {
            const rad = (r * 16 + wavePulse * 16);
            ctx.beginPath();
            ctx.arc(intX, roadTop + roadHeight, rad, Math.PI, Math.PI * 2);
            ctx.stroke();
          }

          // Sensor detection label
          ctx.fillStyle = '#f43f5e';
          ctx.font = 'bold 8px Inter, sans-serif';
          ctx.fillText('📡 RADAR: 48cm (OCCUPIED)', intX - 52, roadTop + roadHeight + 24);
          ctx.restore();
        } else {
          ctx.save();
          ctx.fillStyle = '#10b981';
          ctx.font = '8px Inter, sans-serif';
          ctx.fillText('📡 RADAR: 280cm (CLEAR)', intX - 50, roadTop + roadHeight + 24);
          ctx.restore();
        }

        // Radar safety hold prominent alert banner
        if (intLive && intLive.safetyHoldRemaining > 0) {
          // Highlight entire crosswalk area in pulsing emergency red warning
          ctx.save();
          const pulse = 0.25 + 0.15 * Math.sin(performance.now() / 150);
          ctx.fillStyle = `rgba(239, 68, 68, ${pulse})`;
          ctx.fillRect(intX - streetWidth / 2 + 5, roadTop, streetWidth - 10, roadHeight);
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(intX - streetWidth / 2 + 5, roadTop, streetWidth - 10, roadHeight);
          ctx.restore();

          // Banner above intersection
          ctx.save();
          ctx.fillStyle = 'rgba(225, 29, 72, 0.95)';
          ctx.fillRect(intX - 95, roadTop - 48, 190, 22);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(intX - 95, roadTop - 48, 190, 22);

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9px Inter, sans-serif';
          ctx.fillText(`🚨 RADAR HOLD: CARS RED (+${intLive.safetyHoldRemaining}s)`, intX - 88, roadTop - 34);
          ctx.restore();
        }
      }

      // Intersection Labels
      ctx.fillStyle = '#cbd5e1';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillText(intDef.id, intX - 16, roadTop - 24);
      ctx.fillStyle = '#64748b';
      ctx.font = '9px Inter, sans-serif';
      ctx.fillText(intDef.name.substring(0, 12), intX - 25, roadTop - 14);

      // Real-time Traffic Signal Heads per Lane and Direction:
      // 1. Eastbound Arterial Signal (Top lane, before the stop line)
      this.drawSignalHead(ctx, intX - 44, roadTop + 6, intLive, 'CORRIDOR', 'EB');

      // 2. Westbound Arterial Signal (Downward bottom lane, before the stop line)
      this.drawSignalHead(ctx, intX + 32, roadTop + 66, intLive, 'CORRIDOR', 'WB');

      // 3. Cross-Street Signal (North-South cross street)
      this.drawSignalHead(ctx, intX - 22, roadTop - 48, intLive, 'CROSS', 'NS');

      // 4. Pedestrian Signals (North sidewalk & Downward South sidewalk next to yellow person)
      this.drawPedestrianSignal(ctx, intX + 22, roadTop - 26, intLive, 'NORTH');
      this.drawPedestrianSignal(ctx, intX + 22, roadTop + roadHeight + 4, intLive, 'SOUTH');
    });

    // 3. Draw Pedestrians: Demand-Activated Only (Moves ONLY on button click, NEVER on its own)
    this.pedestrians.forEach((p) => {
      const intDef = this.intersections.find(i => i.id === p.intId);
      if (!intDef) return;
      const intX = this.metersToX(intDef.meters);
      const intLive = this.latestTrafficState ? this.latestTrafficState.intersections[p.intId] : null;

      const pedState = intLive ? intLive.signals.pedestrian.state : 'DONT_WALK';
      const isWalking = (pedState === 'WALK' || pedState === 'CLEARANCE');
      const countdown = intLive ? (intLive.signals.pedestrian.countdown || 0) : 0;
      const isAssistActive = intLive ? intLive.signals.pedestrian.assistActive : false;

      if (p.currentSide === undefined) {
        p.currentSide = 'NORTH'; // Starts at North sidewalk (progress = 0.0)
      }

      // ONLY move when an active pedestrian walk phase is active!
      const isHoldActive = (intLive && intLive.safetyHoldRemaining > 0);
      if ((isWalking || isHoldActive) && (countdown > 0 || isHoldActive)) {
        const isRadarDemo = p.isElderly && ((intLive && intLive.sensors && intLive.sensors.crosswalkOccupied) || isHoldActive);

        let rawProgress;
        if (isRadarDemo) {
          // RADAR DEMO MODE (INT-3):
          // Resident walks more slowly so that at 24s they are still in the lane (progress ~0.85).
          // During the +5s hold, they finish crossing safely onto the sidewalk!
          let elapsedSec;
          if (isHoldActive) {
            elapsedSec = 24 + (5 - intLive.safetyHoldRemaining); // seconds 24 to 29
          } else {
            elapsedSec = Math.max(0, 24 - countdown); // seconds 0 to 24
          }
          rawProgress = Math.min(1.0, elapsedSec / 28.0);
        } else {
          // STANDARD / ASSIST CROSSING (any intersection):
          const totalDuration = isAssistActive ? 24 : 10;
          const walkTimeNeeded = isAssistActive ? 20 : 8; // reaches sidewalk safely before clearance
          const elapsedSec = Math.max(0, totalDuration - countdown);
          rawProgress = Math.min(1.0, elapsedSec / walkTimeNeeded);
        }

        if (p.currentSide === 'NORTH') {
          // Walking from North (0.0) to South (1.0)
          p.progress = rawProgress;
          if (rawProgress >= 1.0) {
            p.pendingNewSide = 'SOUTH';
          }
        } else {
          // Walking from South (1.0) to North (0.0)
          p.progress = 1.0 - rawProgress;
          if (rawProgress >= 1.0) {
            p.pendingNewSide = 'NORTH';
          }
        }
      } else {
        // NORMAL TRAFFIC / NO BUTTON PRESSED:
        // Person MUST REMAIN 100% MOTIONLESS on the sidewalk they reached!
        if (p.pendingNewSide) {
          p.currentSide = p.pendingNewSide;
          p.pendingNewSide = null;
        }
        p.progress = (p.currentSide === 'SOUTH') ? 1.0 : 0.0;
      }

      // Exact vertical coordinates:
      // roadTop is 125, roadHeight is 110.
      // Progress 0.0 = North sidewalk curb (y = roadTop - 8)
      // Progress 1.0 = South sidewalk curb (y = roadTop + roadHeight + 8)
      const curbNorthY = roadTop - 8;
      const curbSouthY = roadTop + roadHeight + 8;
      const pedY = curbNorthY + p.progress * (curbSouthY - curbNorthY);
      const pedX = intX + (p.isElderly ? 14 : -14);

      // Draw pedestrian marker
      ctx.save();
      ctx.beginPath();
      ctx.arc(pedX, pedY, p.isElderly ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = p.color || (p.isElderly ? '#f59e0b' : '#38bdf8');
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Walking cane visual indicator for elderly resident
      if (p.isElderly) {
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pedX + 5, pedY);
        ctx.lineTo(pedX + 9, pedY + 9);
        ctx.stroke();
      }

      // Visual badge above pedestrian
      ctx.font = 'bold 8px Inter, sans-serif';
      if (p.isElderly && intLive && intLive.safetyHoldRemaining > 0) {
        // Ultrasonic Radar Hold in progress - bright animated red target over pedestrian trapped in roadway
        const pulse = 16 + 3 * Math.sin(performance.now() / 120);
        ctx.beginPath();
        ctx.arc(pedX, pedY, pulse, 0, Math.PI * 2);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.fillStyle = '#f43f5e';
        ctx.fillText(`🚨 IN ROAD - RADAR HOLD (+${intLive.safetyHoldRemaining}s)`, pedX - 58, pedY - 18);
      } else if (isWalking && countdown > 2) {
        ctx.beginPath();
        ctx.arc(pedX, pedY, 14, 0, Math.PI * 2);
        ctx.strokeStyle = p.color || 'rgba(56, 189, 248, 0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = p.color || '#38bdf8';
        ctx.fillText(`${p.name.toUpperCase()} CROSSING (${countdown}s)`, pedX - 44, pedY - 14);
      } else if (isWalking && countdown <= 2) {
        ctx.fillStyle = '#22c55e';
        ctx.fillText(`SAFE ON SIDEWALK`, pedX - 34, pedY - 14);
      } else {
        ctx.fillStyle = '#10b981';
        ctx.fillText('SAFE ON SIDEWALK', pedX - 34, pedY - 14);
      }
      ctx.restore();
    });

    // 4. Natural Car Movement & Deceleration Physics (Coasting gently to a stop)
    this.backgroundCars.forEach((car) => {
      let mustStop = false;
      let targetStopX = null;

      // Check upcoming intersections in front of this car
      this.intersections.forEach((intDef) => {
        const intX = this.metersToX(intDef.meters);
        const intLive = this.latestTrafficState ? this.latestTrafficState.intersections[intDef.id] : null;
        const isCorridorRed = intLive ? !intLive.signals.corridor.green : false;

        // Check if ANY pedestrian is currently on this crosswalk (between progress 0.05 and 0.95)
        const hasPedInRoad = this.pedestrians.some(p => p.intId === intDef.id && p.progress > 0.04 && p.progress < 0.96);
        const isRadarHolding = intLive ? (intLive.safetyHoldRemaining > 0) : false;
        const mustStopAtThisIntersection = isCorridorRed || hasPedInRoad || isRadarHolding;

        if (car.dir === 1) { // Eastbound
          const stopLineX = intX - 44;
          const distToStopLine = stopLineX - car.x;
          // Only stop if the car is in front of the stop line approaching it
          if (mustStopAtThisIntersection && distToStopLine >= -2 && distToStopLine <= 85) {
            mustStop = true;
            targetStopX = stopLineX;
          }
        } else { // Westbound
          const stopLineX = intX + 44;
          const distToStopLine = car.x - stopLineX;
          if (mustStopAtThisIntersection && distToStopLine >= -2 && distToStopLine <= 85) {
            mustStop = true;
            targetStopX = stopLineX;
          }
        }
      });

      // Car-following: Check if car ahead in same lane is stopped
      this.backgroundCars.forEach((other) => {
        if (other.id !== car.id && other.yOffset === car.yOffset) {
          if (car.dir === 1 && other.x > car.x && (other.x - car.x) < 36) {
            mustStop = true;
            targetStopX = other.x - 32;
          } else if (car.dir === -1 && other.x < car.x && (car.x - other.x) < 36) {
            mustStop = true;
            targetStopX = other.x + 32;
          }
        }
      });

      // Natural decelerate and accelerate physics:
      const maxSpeed = Math.abs(car.baseSpeed);
      if (car.currentSpeed === undefined) car.currentSpeed = maxSpeed;

      if (mustStop) {
        const dist = car.dir === 1 ? (targetStopX - car.x) : (car.x - targetStopX);

        if (dist <= 1.5) {
          // Came to a full stop at the line
          car.currentSpeed = 0;
          car.stopped = true;
          car.x = targetStopX;
        } else {
          // Smooth, natural braking curve:
          // The car gently coasts down as it nears the stop line, NEVER speeding up!
          const naturalBrakeSpeed = Math.min(maxSpeed, Math.max(0.2, (dist / 85) * maxSpeed));
          car.currentSpeed = Math.max(0.15, Math.min(car.currentSpeed, naturalBrakeSpeed));
          
          if (car.dir === 1) {
            car.x = Math.min(targetStopX, car.x + car.currentSpeed);
          } else {
            car.x = Math.max(targetStopX, car.x - car.currentSpeed);
          }
          car.stopped = (dist < 3);
        }
      } else {
        // Signal is Green: Smooth gentle acceleration away from stop line
        car.stopped = false;
        if (car.currentSpeed < maxSpeed) {
          car.currentSpeed = Math.min(maxSpeed, car.currentSpeed + 0.035); // smooth gentle gas pedal
        }
        car.x += (car.dir === 1 ? car.currentSpeed : -car.currentSpeed);
      }

      // Wrap around road edges cleanly
      if (car.dir === 1 && car.x > w + 40) {
        car.x = -30;
        car.currentSpeed = maxSpeed;
      }
      if (car.dir === -1 && car.x < -40) {
        car.x = w + 30;
        car.currentSpeed = maxSpeed;
      }

      const carY = roadMidY + car.yOffset;

      // Draw Car Body
      ctx.save();
      ctx.fillStyle = car.color;
      ctx.fillRect(car.x - 14, carY - 6, 28, 12);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(car.x - 8, carY - 4, 16, 8); // Windshield

      // Draw Headlights & Brake Lights
      if (car.dir === 1) {
        // Front headlights (Eastbound)
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(car.x + 13, carY - 5, 2, 3);
        ctx.fillRect(car.x + 13, carY + 2, 2, 3);

        // Rear Brake lights
        ctx.fillStyle = car.stopped ? '#ef4444' : '#7f1d1d';
        ctx.fillRect(car.x - 15, carY - 5, 2, 3);
        ctx.fillRect(car.x - 15, carY + 2, 2, 3);
        if (car.stopped) {
          ctx.shadowColor = '#ef4444';
          ctx.shadowBlur = 6;
          ctx.fillRect(car.x - 15, carY - 5, 2, 3);
          ctx.fillRect(car.x - 15, carY + 2, 2, 3);
          ctx.shadowBlur = 0;
        }
      } else {
        // Front headlights (Westbound)
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(car.x - 15, carY - 5, 2, 3);
        ctx.fillRect(car.x - 15, carY + 2, 2, 3);

        // Rear Brake lights
        ctx.fillStyle = car.stopped ? '#ef4444' : '#7f1d1d';
        ctx.fillRect(car.x + 13, carY - 5, 2, 3);
        ctx.fillRect(car.x + 13, carY + 2, 2, 3);
        if (car.stopped) {
          ctx.shadowColor = '#ef4444';
          ctx.shadowBlur = 6;
          ctx.fillRect(car.x + 13, carY - 5, 2, 3);
          ctx.fillRect(car.x + 13, carY + 2, 2, 3);
          ctx.shadowBlur = 0;
        }
      }
      ctx.restore();
    });

    // 5. Draw Emergency Ambulance (High-speed animated Code 3 response)
    if (this.latestAmbulanceState && this.latestAmbulanceState.status === 'EN_ROUTE') {
      const serverPos = this.latestAmbulanceState.position || 0;
      if (this.displayAmbPos === undefined || Math.abs(this.displayAmbPos - serverPos) > 100) {
        this.displayAmbPos = serverPos;
      } else {
        // Frame-rate smooth local extrapolation
        const speedMps = ((this.latestAmbulanceState.speedKmh || 115) / 3.6) * 3.8;
        this.displayAmbPos = Math.min(1350, Math.max(this.displayAmbPos, this.displayAmbPos + speedMps * dt));
        // Soft sync to server position
        this.displayAmbPos += (serverPos - this.displayAmbPos) * 0.18;
      }

      const ambX = this.metersToX(this.displayAmbPos);
      const ambY = roadTop + 28; // Upper Eastbound lane

      // High-speed emergency motion-blur light trail behind speeding ambulance
      ctx.save();
      const trailGrad = ctx.createLinearGradient(ambX - 50, ambY, ambX - 10, ambY);
      trailGrad.addColorStop(0, 'rgba(239, 68, 68, 0)');
      trailGrad.addColorStop(0.5, 'rgba(59, 130, 246, 0.35)');
      trailGrad.addColorStop(1, 'rgba(239, 68, 68, 0.6)');
      ctx.fillStyle = trailGrad;
      ctx.fillRect(ambX - 50, ambY - 6, 40, 12);
      ctx.restore();

      // Fast Pulsing BLE Beacon Radius Waves
      ctx.save();
      const wavePhase = (currentTime / 350) % 1;
      ctx.beginPath();
      ctx.arc(ambX, ambY, 35 + wavePhase * 65, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(59, 130, 246, ${0.9 - wavePhase * 0.8})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Zone 2 Preemption Ring (~260m scaled)
      ctx.beginPath();
      ctx.arc(ambX, ambY, 95, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Ambulance Body
      ctx.save();
      // Drop shadow
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(ambX - 22, ambY - 9, 44, 18);
      ctx.shadowBlur = 0;

      // Red Stripe
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(ambX - 22, ambY - 2, 44, 4);

      // Red Cross on Roof
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(ambX - 5, ambY - 7, 10, 3);
      ctx.fillRect(ambX - 2, ambY - 9, 4, 7);

      // Rapid Flashing Emergency Strobe (14Hz rapid strobe)
      const flashRed = Math.floor(currentTime / 70) % 2 === 0;
      ctx.fillStyle = flashRed ? '#ef4444' : '#3b82f6';
      ctx.beginPath();
      ctx.arc(ambX + 6, ambY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Beacon halo
      ctx.beginPath();
      ctx.arc(ambX + 6, ambY, 16, 0, Math.PI * 2);
      ctx.fillStyle = flashRed ? 'rgba(239, 68, 68, 0.55)' : 'rgba(59, 130, 246, 0.55)';
      ctx.fill();

      // Speed & Tag label
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px Inter, sans-serif';
      ctx.fillText(`${this.latestAmbulanceState.id} (${Math.round(this.latestAmbulanceState.speedKmh)} km/h)`, ambX - 35, ambY - 14);
      ctx.restore();
    } else {
      this.displayAmbPos = 0;
    }
  }

  drawCrosswalk(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    const barWidth = 4;
    const gap = 4;
    for (let curX = x; curX < x + w; curX += barWidth + gap) {
      ctx.fillRect(curX, y, barWidth, h);
    }
  }

  drawSignalHead(ctx, x, y, intLive, signalType, laneLabel) {
    // Mini vehicular traffic light housing
    ctx.save();
    ctx.fillStyle = '#18181b';
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, 13, 36, 5);
    ctx.fill();
    ctx.stroke();

    const isCorridor = (signalType === 'CORRIDOR');
    const sig = intLive ? (isCorridor ? intLive.signals.corridor : intLive.signals.cross) : { red: true, yellow: false, green: false };

    // Red Bulb
    ctx.beginPath();
    ctx.arc(x + 6.5, y + 7.5, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = sig.red ? '#ef4444' : '#3f3f46';
    ctx.fill();
    if (sig.red) {
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Yellow Bulb
    ctx.beginPath();
    ctx.arc(x + 6.5, y + 18, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = sig.yellow ? '#eab308' : '#3f3f46';
    ctx.fill();
    if (sig.yellow) {
      ctx.shadowColor = '#eab308';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Green Bulb
    ctx.beginPath();
    ctx.arc(x + 6.5, y + 28.5, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = sig.green ? '#22c55e' : '#3f3f46';
    ctx.fill();
    if (sig.green) {
      ctx.shadowColor = '#22c55e';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Lane Label (EB for Eastbound, WB for Westbound, NS for Cross)
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 7px Inter, sans-serif';
    ctx.fillText(laneLabel || (isCorridor ? 'CORR' : 'CROSS'), x - 1, y + 45);
    ctx.restore();
  }

  drawPedestrianSignal(ctx, x, y, intLive, side) {
    // Dedicated Pedestrian Crosswalk Signal Head
    ctx.save();
    const ped = intLive ? intLive.signals.pedestrian : { state: 'DONT_WALK', countdown: 0 };
    const isWalk = (ped.state === 'WALK');
    const isClearance = (ped.state === 'CLEARANCE');

    // Pedestrian Signal Housing Box
    ctx.fillStyle = '#111827';
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, 16, 20, 3);
    ctx.fill();
    ctx.stroke();

    // Upper icon: Don't Walk (Red)
    ctx.beginPath();
    ctx.arc(x + 8, y + 5.5, 3, 0, Math.PI * 2);
    if (!isWalk && !isClearance) {
      ctx.fillStyle = '#ef4444';
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = '#374151';
      ctx.fill();
    }

    // Lower icon: Walk (Green / Yellow clearance)
    ctx.beginPath();
    ctx.arc(x + 8, y + 14.5, 3, 0, Math.PI * 2);
    if (isWalk) {
      ctx.fillStyle = '#22c55e';
      ctx.shadowColor = '#22c55e';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (isClearance) {
      ctx.fillStyle = '#eab308';
      ctx.shadowColor = '#eab308';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = '#374151';
      ctx.fill();
    }

    // Status label beside the signal box
    ctx.fillStyle = isWalk ? '#22c55e' : (isClearance ? '#eab308' : '#ef4444');
    ctx.font = 'bold 7px Inter, sans-serif';
    if ((isWalk || isClearance) && ped.countdown > 0) {
      ctx.fillText(`${ped.countdown}s`, x + 19, y + 13);
    } else {
      ctx.fillText('STOP', x + 19, y + 13);
    }
    ctx.restore();
  }
}

window.CorridorCanvasSimulator = CorridorCanvasSimulator;
