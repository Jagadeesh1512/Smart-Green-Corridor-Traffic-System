/**
 * HardwareNodeSimulator.js
 * Simulates 4 physical ESP32 Microcontroller Nodes with GPIO pin maps,
 * Ultrasonic sensors, RFID/BLE receivers, push-button interrupts, and sub-second telemetry.
 */

class HardwareNodeSimulator {
  constructor(trafficManager) {
    this.trafficManager = trafficManager;

    this.nodes = {
      'INT-1': this.createVirtualNode('INT-1', 'ESP32-NODE-01', '1st Ave & Hospital Way'),
      'INT-2': this.createVirtualNode('INT-2', 'ESP32-NODE-02', 'Central Blvd & Hospital Way'),
      'INT-3': this.createVirtualNode('INT-3', 'ESP32-NODE-03', 'Community Center & 3rd St [Community Zone]'),
      'INT-4': this.createVirtualNode('INT-4', 'ESP32-NODE-04', 'Civic Gate & 4th Ave')
    };

    // Telemetry tick (every 250ms for sub-second updates)
    this.interval = setInterval(() => this.updateTelemetry(), 250);
  }

  createVirtualNode(id, mac, location) {
    return {
      id,
      mac,
      location,
      status: 'ONLINE',
      firmwareVersion: 'v2.4.1-corridor-esp32',
      ip: `192.168.1.${100 + parseInt(id.split('-')[1])}`,
      wifiRssi: -55 - Math.floor(Math.random() * 15),
      freeHeap: 218400 + Math.floor(Math.random() * 5000),
      pingMs: 14 + Math.floor(Math.random() * 8),
      lastSeen: Date.now(),
      
      // ESP32 GPIO Pin Map (Wokwi-Compatible)
      gpio: {
        // Corridor (East-West) Traffic Lights
        PIN_12_EW_RED: false,
        PIN_13_EW_YELLOW: false,
        PIN_14_EW_GREEN: true,

        // Cross (North-South) Traffic Lights
        PIN_25_NS_RED: true,
        PIN_26_NS_YELLOW: false,
        PIN_27_NS_GREEN: false,

        // Pedestrian Crosswalk Signals
        PIN_32_PED_RED: true,      // Don't Walk
        PIN_33_PED_GREEN: false,   // Walk

        // Actuators
        PIN_04_BUZZER_PWM: 0,      // Hz

        // Inputs / Sensors
        PIN_18_BTN_STANDARD: 0,    // Standard push button (0 = unpressed, 1 = pressed)
        PIN_19_BTN_ELDERLY: 0,     // Elderly / Wheelchair Assist button (1 = pressed)
        PIN_21_ULTRASONIC_CM: 280, // Crosswalk distance (280cm = clear, < 80cm = pedestrian in crosswalk)
        
        // Simulated BLE / RFID Module (MFRC522 / ESP32 BLE)
        RFID_TAG_DETECTED: null,
        BLE_AMBULANCE_RSSI: null
      }
    };
  }

  updateTelemetry() {
    for (const id in this.nodes) {
      const node = this.nodes[id];
      const int = this.trafficManager.intersections[id];
      if (!int) continue;

      // Sync virtual GPIOs with Traffic Manager state
      node.gpio.PIN_12_EW_RED = int.signals.corridor.red;
      node.gpio.PIN_13_EW_YELLOW = int.signals.corridor.yellow;
      node.gpio.PIN_14_EW_GREEN = int.signals.corridor.green;

      node.gpio.PIN_25_NS_RED = int.signals.cross.red;
      node.gpio.PIN_26_NS_YELLOW = int.signals.cross.yellow;
      node.gpio.PIN_27_NS_GREEN = int.signals.cross.green;

      node.gpio.PIN_32_PED_RED = (int.signals.pedestrian.state === 'DONT_WALK');
      node.gpio.PIN_33_PED_GREEN = (int.signals.pedestrian.state === 'WALK' || int.signals.pedestrian.state === 'CLEARANCE');

      // Buzzer frequency
      node.gpio.PIN_04_BUZZER_PWM = int.signals.pedestrian.buzzerHz;

      // Push button simulation inputs
      node.gpio.PIN_18_BTN_STANDARD = int.sensors.pedestrianButtonStandard ? 1 : 0;
      node.gpio.PIN_19_BTN_ELDERLY = int.sensors.pedestrianButtonElderly ? 1 : 0;

      // Ultrasonic sensor distance
      node.gpio.PIN_21_ULTRASONIC_CM = int.sensors.crosswalkOccupied ? 48 : 280;

      // RFID/BLE Beacon
      node.gpio.BLE_AMBULANCE_RSSI = int.sensors.ambulanceBeaconRSSI;
      if (int.preemption.active) {
        node.gpio.RFID_TAG_DETECTED = int.preemption.ambulanceId || 'AMB-RFID-MATCH';
      } else {
        node.gpio.RFID_TAG_DETECTED = null;
      }

      // Small jitter for realism
      node.pingMs = Math.max(8, Math.min(32, node.pingMs + (Math.random() > 0.5 ? 1 : -1)));
      node.lastSeen = Date.now();
    }
  }

  triggerHardwareButton(nodeId, buttonType) {
    const node = this.nodes[nodeId];
    if (!node) return { success: false, error: 'Node not found' };

    if (buttonType === 'ELDERLY' || buttonType === 'ELDERLY_ASSIST') {
      node.gpio.PIN_19_BTN_ELDERLY = 1;
      setTimeout(() => { node.gpio.PIN_19_BTN_ELDERLY = 0; }, 1200);
      return this.trafficManager.requestPedestrianCrossing(nodeId, 'ELDERLY_ASSIST');
    } else {
      node.gpio.PIN_18_BTN_STANDARD = 1;
      setTimeout(() => { node.gpio.PIN_18_BTN_STANDARD = 0; }, 1200);
      return this.trafficManager.requestPedestrianCrossing(nodeId, 'STANDARD');
    }
  }

  getAllNodes() {
    return this.nodes;
  }
}

module.exports = HardwareNodeSimulator;
