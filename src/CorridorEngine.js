/**
 * CorridorEngine.js
 * Simulates emergency vehicle movement along the urban corridor,
 * broadcasts simulated BLE/RFID beacon pings, and coordinates staged preemption.
 */

class CorridorEngine {
  constructor(trafficManager, analyticsService) {
    this.trafficManager = trafficManager;
    this.analytics = analyticsService;

    // Corridor geometry (in meters from depot 0m to Hospital 1350m)
    this.corridorLength = 1350;
    this.intersectionPositions = {
      'INT-1': 150,
      'INT-2': 500,
      'INT-3': 850,  // Community Zone (St. Mary Senior Living)
      'INT-4': 1150
    };

    // Preemption Geofence Zones (in meters relative to intersection)
    this.ZONES = {
      APPROACH_RADIUS: 420,    // Zone 1: Early warning & queue clearance (extended for high-speed response)
      PREEMPT_RADIUS: 260,     // Zone 2: Hard preemption trigger (Force Green)
      CLEARANCE_PAST: 45       // Zone 4: Clear & release intersection
    };

    // Active fleet of ambulances
    this.ambulances = {
      'AMB-101': {
        id: 'AMB-101',
        name: 'Medic Alpha (Code 3)',
        driver: 'Capt. R. Miller',
        status: 'IDLE', // 'IDLE', 'EN_ROUTE', 'ARRIVED'
        position: 0,
        speedKmh: 0,
        targetSpeedKmh: 115,
        startTime: null,
        elapsedSeconds: 0,
        baselineSeconds: 145,
        intersectionsPassed: [],
        beaconUUID: 'BLE-AMB-101-00FA',
        strobeActive: false,
        patientVitals: { heartRate: 118, spO2: 93, condition: 'Critical / STEMI' }
      },
      'AMB-204': {
        id: 'AMB-204',
        name: 'Paramedic Rapid-4',
        driver: 'Lt. S. Chen',
        status: 'IDLE',
        position: 0,
        speedKmh: 0,
        targetSpeedKmh: 120,
        startTime: null,
        elapsedSeconds: 0,
        baselineSeconds: 140,
        intersectionsPassed: [],
        beaconUUID: 'BLE-AMB-204-88C1',
        strobeActive: false,
        patientVitals: { heartRate: 92, spO2: 96, condition: 'Trauma / Priority 1' }
      }
    };

    // Fast simulation loop (20 Hz = 50ms interval) for buttery smooth vehicle tracking
    this.simInterval = setInterval(() => this.tickSimulation(0.05), 50);
  }

  dispatchAmbulance(id = 'AMB-101', routeName = 'St. Jude Depot -> Memorial Trauma Center') {
    const amb = this.ambulances[id];
    if (!amb) return { success: false, message: 'Ambulance not found' };

    amb.status = 'EN_ROUTE';
    amb.position = 0;
    amb.speedKmh = 35;
    amb.targetSpeedKmh = amb.targetSpeedKmh || 115;
    amb.startTime = Date.now();
    amb.elapsedSeconds = 0;
    amb.intersectionsPassed = [];
    amb.strobeActive = true;
    amb.routeName = routeName;

    this.analytics.logEvent(
      'EMERGENCY',
      `DISPATCH: ${amb.name}`,
      `Code 3 Emergency! Destination: Memorial Hospital. Smart Green-Corridor preemption initialized.`,
      'danger'
    );

    return { success: true, ambulance: amb };
  }

  stopOrResetAmbulance(id = 'AMB-101') {
    const amb = this.ambulances[id];
    if (!amb) return;

    amb.status = 'IDLE';
    amb.position = 0;
    amb.speedKmh = 0;
    amb.strobeActive = false;

    // Release any locked intersections
    for (const intId in this.intersectionPositions) {
      if (this.trafficManager.intersections[intId].preemption.ambulanceId === id) {
        this.trafficManager.releasePreemption(intId);
      }
      this.trafficManager.intersections[intId].sensors.ambulanceBeaconRSSI = null;
      this.trafficManager.intersections[intId].sensors.emergencyApproaching = false;
    }
  }

  tickSimulation(dtSeconds) {
    for (const id in this.ambulances) {
      const amb = this.ambulances[id];
      if (amb.status !== 'EN_ROUTE') continue;

      amb.elapsedSeconds += dtSeconds;

      // Swift Code 3 acceleration curve
      if (amb.speedKmh < amb.targetSpeedKmh) {
        amb.speedKmh = Math.min(amb.targetSpeedKmh, amb.speedKmh + 65 * dtSeconds);
      }

      // Move vehicle (km/h to m/s: / 3.6) with fast animation speed multiplier (Code 3 high-speed transit ~9-11s)
      const metersPerSec = amb.speedKmh / 3.6;
      const animationSpeedMultiplier = 3.8;
      amb.position += metersPerSec * dtSeconds * animationSpeedMultiplier;

      // Geofence & Beacon Processing across all intersections
      for (const intId in this.intersectionPositions) {
        const intPos = this.intersectionPositions[intId];
        const distToInt = intPos - amb.position; // Positive if approaching, negative if past
        const intersection = this.trafficManager.intersections[intId];

        // 1. Calculate simulated BLE Beacon RSSI (-95 dBm to -30 dBm)
        const absDist = Math.abs(distToInt);
        if (absDist < 400) {
          const rssi = Math.round(-35 - (absDist / 400) * 55);
          intersection.sensors.ambulanceBeaconRSSI = rssi;
        } else {
          if (intersection.preemption.ambulanceId === amb.id) {
            intersection.sensors.ambulanceBeaconRSSI = null;
          }
        }

        // 2. Zone 1: Approaching (~300m out)
        if (distToInt > this.ZONES.PREEMPT_RADIUS && distToInt <= this.ZONES.APPROACH_RADIUS) {
          intersection.sensors.emergencyApproaching = true;
        }

        // 3. Zone 2: Preemption Trigger (~180m out)
        if (distToInt > 0 && distToInt <= this.ZONES.PREEMPT_RADIUS) {
          this.trafficManager.preemptIntersection(intId, amb.id, 'ZONE_2_PREEMPT');
        }

        // 4. Zone 3: Inside intersection
        if (distToInt <= 0 && distToInt >= -this.ZONES.CLEARANCE_PAST) {
          if (!amb.intersectionsPassed.includes(intId)) {
            amb.intersectionsPassed.push(intId);
          }
        }

        // 5. Zone 4: Cleared intersection (> 35m past)
        if (distToInt < -this.ZONES.CLEARANCE_PAST && distToInt > -80) {
          if (intersection.preemption.ambulanceId === amb.id && intersection.preemption.active) {
            this.trafficManager.releasePreemption(intId);
            intersection.sensors.emergencyApproaching = false;
          }
        }
      }

      // Destination reached!
      if (amb.position >= this.corridorLength) {
        amb.position = this.corridorLength;
        amb.speedKmh = 0;
        amb.status = 'ARRIVED';
        amb.strobeActive = false;

        // Release any remaining intersections
        for (const intId in this.intersectionPositions) {
          if (this.trafficManager.intersections[intId].preemption.ambulanceId === amb.id) {
            this.trafficManager.releasePreemption(intId);
          }
          this.trafficManager.intersections[intId].sensors.ambulanceBeaconRSSI = null;
          this.trafficManager.intersections[intId].sensors.emergencyApproaching = false;
        }

        // Record completed emergency run
        this.analytics.recordEmergencyTripCompleted({
          ambulanceId: amb.id,
          routeName: amb.routeName,
          elapsedSeconds: amb.elapsedSeconds,
          baselineSeconds: amb.baselineSeconds,
          intersectionsCleared: amb.intersectionsPassed.length
        });
      }
    }
  }

  getState() {
    return {
      corridorLength: this.corridorLength,
      intersectionPositions: this.intersectionPositions,
      ambulances: this.ambulances
    };
  }
}

module.exports = CorridorEngine;
