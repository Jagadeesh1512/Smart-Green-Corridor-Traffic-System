/**
 * server.js
 * Smart Green-Corridor Central Dispatch Server
 * Node.js with WebSockets for sub-second traffic controller signal synchronization
 */

const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { WebSocketServer, WebSocket } = require('ws');
const mqtt = require('mqtt');

const AnalyticsService = require('./src/AnalyticsService');
const TrafficManager = require('./src/TrafficManager');
const CorridorEngine = require('./src/CorridorEngine');
const HardwareNodeSimulator = require('./src/HardwareNodeSimulator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Initialize Core Engines
const analyticsService = new AnalyticsService();
const trafficManager = new TrafficManager(analyticsService);
const corridorEngine = new CorridorEngine(trafficManager, analyticsService);
const hardwareSimulator = new HardwareNodeSimulator(trafficManager);

// Middleware
app.use(cors());
app.use(express.json());

// Disable HTTP caching for live simulation and script assets
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));
app.use('/hardware', express.static(path.join(__dirname, 'hardware'), { etag: false, maxAge: 0 }));
app.use('/sumo', express.static(path.join(__dirname, 'sumo'), { etag: false, maxAge: 0 }));

// ---------------- REST API ---------------- //

// Comprehensive System Status
app.get('/api/status', (req, res) => {
  res.json({
    timestamp: Date.now(),
    traffic: trafficManager.getAllState(),
    corridor: corridorEngine.getState(),
    hardware: hardwareSimulator.getAllNodes(),
    analytics: analyticsService.getMetricsSummary()
  });
});

// Emergency Ambulance Dispatch
app.post('/api/emergency/dispatch', (req, res) => {
  const { ambulanceId = 'AMB-101', routeName } = req.body;
  const result = corridorEngine.dispatchAmbulance(ambulanceId, routeName);
  broadcastState();
  res.json(result);
});

// Reset Ambulance to Depot
app.post('/api/emergency/reset', (req, res) => {
  const { ambulanceId = 'AMB-101' } = req.body;
  corridorEngine.stopOrResetAmbulance(ambulanceId);
  broadcastState();
  res.json({ success: true, message: `Ambulance ${ambulanceId} reset to depot.` });
});

// Central Dispatch Manual Override (Force Green Corridor)
app.post('/api/emergency/override', (req, res) => {
  const { forceGreen = true, reason } = req.body;
  trafficManager.setCorridorOverride(forceGreen, reason);
  broadcastState();
  res.json({ success: true, overrideActive: forceGreen });
});

// Pedestrian Crosswalk Button (Standard or Elderly/Disabled Assist)
app.post('/api/pedestrian/button', (req, res) => {
  const { intersectionId = 'INT-3', type = 'STANDARD' } = req.body;
  const result = hardwareSimulator.triggerHardwareButton(intersectionId, type);
  broadcastState();
  res.json(result);
});

// Ultrasonic Crosswalk Occupancy Sensor
app.post('/api/sensors/crosswalk-occupied', (req, res) => {
  const { intersectionId = 'INT-3', occupied = true } = req.body;
  trafficManager.setCrosswalkOccupied(intersectionId, occupied);
  broadcastState();
  res.json({ success: true, intersectionId, occupied });
});

// Hardware Node Telemetry
app.get('/api/hardware', (req, res) => {
  res.json(hardwareSimulator.getAllNodes());
});

// Dedicated Fast Live State Endpoint for ESP32 / Wokwi Microcontroller Nodes
app.get('/api/hardware/:id', (req, res) => {
  const intId = (req.params.id || 'INT-3').toUpperCase();
  const int = trafficManager.intersections[intId];
  if (!int) {
    return res.status(404).json({ error: `Intersection ${intId} not found` });
  }

  res.json({
    id: int.id,
    phase: int.currentPhase,
    corridor: {
      red: int.signals.corridor.red ? 1 : 0,
      yellow: int.signals.corridor.yellow ? 1 : 0,
      green: int.signals.corridor.green ? 1 : 0
    },
    cross: {
      red: int.signals.cross.red ? 1 : 0,
      yellow: int.signals.cross.yellow ? 1 : 0,
      green: int.signals.cross.green ? 1 : 0
    },
    pedestrian: {
      dontWalkRed: int.signals.pedestrian.state === 'DONT_WALK' ? 1 : 0,
      walkGreen: (int.signals.pedestrian.state === 'WALK' || int.signals.pedestrian.state === 'CLEARANCE') ? 1 : 0,
      state: int.signals.pedestrian.state,
      countdown: int.signals.pedestrian.countdown || 0,
      buzzerHz: int.signals.pedestrian.buzzerHz || 0,
      assistActive: int.signals.pedestrian.assistActive ? 1 : 0
    },
    preemption: int.preemption.active ? 1 : 0
  });
});

// Analytics & Social Impact Metrics
app.get('/api/analytics', (req, res) => {
  res.json(analyticsService.getMetricsSummary());
});

// ---------------- WEBSOCKETS (Sub-Second Sync) ---------------- //

function getCompletePayload() {
  return JSON.stringify({
    type: 'STATE_UPDATE',
    timestamp: Date.now(),
    traffic: trafficManager.getAllState(),
    corridor: corridorEngine.getState(),
    hardware: hardwareSimulator.getAllNodes(),
    analytics: analyticsService.getMetricsSummary()
  });
}

function broadcastState() {
  const payload = getCompletePayload();
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
  publishInt3Mqtt();
}

// High-frequency state broadcast (10 Hz = 100ms) for smooth ambulance positioning & signal countdowns
setInterval(() => {
  if (wss.clients.size > 0) {
    broadcastState();
  }
}, 100);

wss.on('connection', (ws) => {
  // Send immediate state on connection
  ws.send(getCompletePayload());

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      switch (data.type) {
        case 'DISPATCH_AMBULANCE':
          corridorEngine.dispatchAmbulance(data.id || 'AMB-101', data.routeName);
          break;
        case 'RESET_AMBULANCE':
          corridorEngine.stopOrResetAmbulance(data.id || 'AMB-101');
          break;
        case 'CORRIDOR_OVERRIDE':
          trafficManager.setCorridorOverride(data.forceGreen, data.reason);
          break;
        case 'PEDESTRIAN_BUTTON':
          hardwareSimulator.triggerHardwareButton(data.intersectionId, data.assistType || 'STANDARD');
          break;
        case 'SET_OCCUPIED':
          trafficManager.setCrosswalkOccupied(data.intersectionId, data.occupied);
          break;
        case 'PING':
          ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
          break;
      }
      broadcastState();
    } catch (err) {
      console.error('WebSocket message parsing error:', err.message);
    }
  });
});

// ---------------- MQTT CLOUD BROKER SYNC (Wokwi & Hardware) ---------------- //
const MQTT_BROKER = 'mqtt://broker.hivemq.com:1883';
const mqttClient = mqtt.connect(MQTT_BROKER, {
  clientId: 'smartcorridor-srv-' + Math.random().toString(16).substring(2, 8),
  reconnectPeriod: 2500
});

mqttClient.on('connect', () => {
  console.log('✅ Connected to HiveMQ Public MQTT Cloud Broker for Wokwi Sync');
  mqttClient.subscribe('smartcorridor/vinay/pedestrian', (err) => {
    if (!err) console.log('📡 Subscribed to Wokwi topic: smartcorridor/vinay/pedestrian');
  });
  mqttClient.subscribe('smartcorridor/vinay/emergency', (err) => {
    if (!err) console.log('📡 Subscribed to Wokwi topic: smartcorridor/vinay/emergency');
  });
});

mqttClient.on('message', (topic, message) => {
  try {
    const raw = message.toString();
    console.log(`[MQTT IN] ${topic} -> ${raw}`);
    const data = JSON.parse(raw);

    if (topic === 'smartcorridor/vinay/pedestrian') {
      const type = data.type || 'STANDARD';
      const intId = data.intersectionId || 'INT-3';
      console.log(`[MQTT TRIGGER] Pedestrian Request: ${type} at ${intId}`);
      hardwareSimulator.triggerHardwareButton(intId, type);
      broadcastState();
      publishInt3Mqtt();
    } else if (topic === 'smartcorridor/vinay/emergency') {
      console.log(`[MQTT TRIGGER] Emergency Command:`, data);
      if (data.action === 'DISPATCH' || data.cmd === 'A') {
        corridorEngine.dispatchAmbulance(data.ambulanceId || 'AMB-101');
      } else if (data.action === 'RESET' || data.action === 'CLEAR' || data.cmd === 'C') {
        corridorEngine.stopOrResetAmbulance(data.ambulanceId || 'AMB-101');
      }
      broadcastState();
      publishInt3Mqtt();
    }
  } catch (err) {
    console.error('Error handling MQTT message:', err.message);
  }
});

let lastPublishedPayload = '';
function publishInt3Mqtt() {
  if (!mqttClient || !mqttClient.connected) return;
  const int = trafficManager.intersections['INT-3'];
  if (!int) return;

  const payload = JSON.stringify({
    phase: int.currentPhase,
    ew: {
      r: int.signals.corridor.red ? 1 : 0,
      y: int.signals.corridor.yellow ? 1 : 0,
      g: int.signals.corridor.green ? 1 : 0
    },
    ns: {
      r: int.signals.cross.red ? 1 : 0,
      y: int.signals.cross.yellow ? 1 : 0,
      g: int.signals.cross.green ? 1 : 0
    },
    ped: {
      r: (int.signals.pedestrian.state === 'DONT_WALK') ? 1 : 0,
      g: (int.signals.pedestrian.state === 'WALK' || int.signals.pedestrian.state === 'CLEARANCE') ? 1 : 0,
      buzz: int.signals.pedestrian.buzzerHz || 0,
      cd: int.signals.pedestrian.countdown || 0,
      assist: int.signals.pedestrian.assistActive ? 1 : 0
    },
    preempt: int.preemption.active ? 1 : 0
  });

  const now = Date.now();
  if (payload !== lastPublishedPayload || (now - lastMqttHeartbeat > 400)) {
    lastPublishedPayload = payload;
    lastMqttHeartbeat = now;
    mqttClient.publish('smartcorridor/vinay/int3/signals', payload, { qos: 0, retain: true });
  }
}

let lastMqttHeartbeat = 0;

// High-frequency INT-3 MQTT heartbeat (every 250ms)
setInterval(() => {
  publishInt3Mqtt();
}, 250);

// Start Server
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚦 SMART GREEN-CORRIDOR & PEDESTRIAN SAFETY SERVER`);
  console.log(`📡 Central Dispatch UI: http://localhost:${PORT}`);
  console.log(`⚡ WebSocket sync running at sub-second rate (100ms)`);
  console.log(`🚑 4-Node Arterial Corridor: INT-1, INT-2, INT-3 (Community Zone), INT-4`);
  console.log(`=======================================================`);
});
