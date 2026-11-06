/**
 * TrafficManager.js
 * Manages traffic signal cycles, pedestrian safety extensions, and preemption interlocks.
 */

class TrafficManager {
  constructor(analyticsService) {
    this.analytics = analyticsService;

    // Standard timing configurations (in seconds)
    this.DEFAULT_TIMINGS = {
      corridorGreen: 24,
      corridorYellow: 4,
      allRed: 2,
      crossGreen: 16,
      crossYellow: 3,
      pedestrianWalkStandard: 10,
      pedestrianWalkElderly: 24, // +14s dynamic extension for elderly/mobility-assisted
      pedestrianClearance: 4,
      emergencyPreemptHold: 30
    };

    // 4 Intersections along the arterial Hospital Corridor
    this.intersections = {
      'INT-1': this.createIntersectionConfig('INT-1', '1st Ave & Hospital Way', false, 0),
      'INT-2': this.createIntersectionConfig('INT-2', 'Central Blvd & Hospital Way', false, 350),
      'INT-3': this.createIntersectionConfig('INT-3', 'Community Center & 3rd St', true, 750), // Community Zone!
      'INT-4': this.createIntersectionConfig('INT-4', 'Civic Gate & 4th Ave', false, 1100)
    };

    // Global corridor preemption flag
    this.corridorOverrideActive = false;
    this.corridorOverrideReason = null;

    // Start 1-second state tick loop
    this.tickInterval = setInterval(() => this.tick(), 1000);
  }

  createIntersectionConfig(id, name, isCommunityZone, distanceMeters) {
    return {
      id,
      name,
      isCommunityZone,
      distanceMeters,
      // Signal cycle state:
      // 'CORRIDOR_GREEN', 'CORRIDOR_YELLOW', 'ALL_RED_1', 'CROSS_GREEN', 'CROSS_YELLOW', 'ALL_RED_2', 'PREEMPTED_GREEN', 'SAFETY_HOLD'
      currentPhase: 'CORRIDOR_GREEN',
      secondsInPhase: 0,
      phaseDuration: this.DEFAULT_TIMINGS.corridorGreen,
      
      // Actuator output states
      signals: {
        corridor: { red: false, yellow: false, green: true }, // East-West (Arterial)
        cross: { red: true, yellow: false, green: false },     // North-South (Side street)
        pedestrian: {
          state: 'DONT_WALK', // 'DONT_WALK' (Red), 'WALK' (Green), 'CLEARANCE' (Flashing Orange)
          countdown: 0,
          assistActive: false, // True if elderly or disabled extension is active
          type: 'NONE',        // 'STANDARD', 'ELDERLY_ASSIST'
          buzzerHz: 0          // 0 = off, 1 = normal, 2 = assist, 4 = urgent clearance
        }
      },

      // Sensor states
      sensors: {
        pedestrianButtonStandard: false,
        pedestrianButtonElderly: false,
        crosswalkOccupied: false,   // Ultrasonic/Radar detection of pedestrian in crosswalk
        ambulanceBeaconRSSI: null,  // dBm when beacon detected
        emergencyApproaching: false
      },

      crossingTurn: 1,
      lastCompletedTurn: 0,

      // Pending requests
      pendingPedestrianRequest: null, // { type: 'STANDARD' | 'ELDERLY_ASSIST', requestedAt: Date.now() }
      safetyHoldRemaining: 0,

      // Preemption state
      preemption: {
        active: false,
        ambulanceId: null,
        zone: null, // 'APPROACH', 'PREEMPT_LOCK', 'PASSING', 'CLEARED'
        forcedBy: null, // 'BEACON', 'DISPATCH_OVERRIDE'
        recoveryCountdown: 0
      }
    };
  }

  tick() {
    for (const id in this.intersections) {
      this.tickIntersection(this.intersections[id]);
    }
  }

  tickIntersection(int) {
    int.secondsInPhase++;

    // Handle Active Preemption (Green Corridor Lock)
    if (int.preemption.active) {
      int.currentPhase = 'PREEMPTED_GREEN';
      int.signals.corridor = { red: false, yellow: false, green: true };
      int.signals.cross = { red: true, yellow: false, green: false };
      int.signals.pedestrian.state = 'DONT_WALK';
      int.signals.pedestrian.countdown = 0;
      int.signals.pedestrian.buzzerHz = 0;
      return;
    }

    // Handle Safety Hold (Pedestrian radar detected person still crossing at zero seconds)
    if (int.safetyHoldRemaining > 0) {
      int.safetyHoldRemaining--;
      int.signals.corridor = { red: true, yellow: false, green: false };
      int.signals.cross = { red: true, yellow: false, green: false };
      int.signals.pedestrian.state = 'CLEARANCE';
      int.signals.pedestrian.countdown = int.safetyHoldRemaining;
      int.signals.pedestrian.buzzerHz = 4; // High frequency audio alert

      if (int.safetyHoldRemaining === 0) {
        // Log safe completion after radar safety hold
        if (int.signals.pedestrian.assistActive) {
          int.lastCompletedTurn = int.crossingTurn || 1;
          this.analytics.recordPedestrianCrossingCompleted(int.id, 'ELDERLY_ASSIST', int.lastCompletedTurn);
          int.crossingTurn = (int.crossingTurn || 1) + 1;
        }
        // Crosswalk is now clear, reset sensor
        int.sensors.crosswalkOccupied = false;
        // Safety hold finished, transition to corridor green
        int.currentPhase = 'ALL_RED_2';
        int.secondsInPhase = int.phaseDuration; // Force immediate progression
      }
      return;
    }

    // Normal Cycle State Machine
    const remaining = int.phaseDuration - int.secondsInPhase;

    // Update pedestrian countdown ONLY if an active pedestrian walk phase was requested
    if (int.currentPhase === 'CROSS_GREEN') {
      if (int.signals.pedestrian.state === 'WALK' || int.signals.pedestrian.state === 'CLEARANCE') {
        int.signals.pedestrian.countdown = Math.max(0, remaining);
        if (remaining <= this.DEFAULT_TIMINGS.pedestrianClearance && remaining > 0) {
          int.signals.pedestrian.state = 'CLEARANCE';
          int.signals.pedestrian.buzzerHz = 4;
        }
      } else {
        int.signals.pedestrian.countdown = 0;
        int.signals.pedestrian.state = 'DONT_WALK';
        int.signals.pedestrian.buzzerHz = 0;
      }
    } else {
      int.signals.pedestrian.countdown = 0;
      int.signals.pedestrian.state = 'DONT_WALK';
      int.signals.pedestrian.buzzerHz = 0;
    }

    if (int.secondsInPhase >= int.phaseDuration) {
      // Arterial Corridor Demand-Actuation:
      // Keep corridor GREEN unless an actual request (pedestrian call or preemption) is active for this intersection!
      if (int.currentPhase === 'CORRIDOR_GREEN' && !int.pendingPedestrianRequest) {
        int.secondsInPhase = 0;
        return;
      }
      this.advancePhase(int);
    }
  }

  advancePhase(int) {
    int.secondsInPhase = 0;

    switch (int.currentPhase) {
      case 'CORRIDOR_GREEN':
        int.currentPhase = 'CORRIDOR_YELLOW';
        int.phaseDuration = this.DEFAULT_TIMINGS.corridorYellow;
        int.signals.corridor = { red: false, yellow: true, green: false };
        int.signals.cross = { red: true, yellow: false, green: false };
        break;

      case 'CORRIDOR_YELLOW':
        int.currentPhase = 'ALL_RED_1';
        int.phaseDuration = int.pendingPedestrianRequest ? 1 : this.DEFAULT_TIMINGS.allRed;
        int.signals.corridor = { red: true, yellow: false, green: false };
        int.signals.cross = { red: true, yellow: false, green: false };
        break;

      case 'ALL_RED_1':
        // Switching to Cross street green + Pedestrian walk
        int.currentPhase = 'CROSS_GREEN';
        
        // Only activate walk and buzzer if there was an actual pedestrian request
        let walkDuration = this.DEFAULT_TIMINGS.crossGreen;
        let isElderly = false;
        let hadRequest = false;

        if (int.pendingPedestrianRequest) {
          hadRequest = true;
          if (int.pendingPedestrianRequest.type === 'ELDERLY_ASSIST') {
            walkDuration = this.DEFAULT_TIMINGS.pedestrianWalkElderly; // 24s extended walk!
            isElderly = true;
          } else {
            walkDuration = this.DEFAULT_TIMINGS.pedestrianWalkStandard; // 10s walk
          }
          int.pendingPedestrianRequest = null;
        }

        int.phaseDuration = walkDuration;
        int.signals.corridor = { red: true, yellow: false, green: false };
        int.signals.cross = { red: false, yellow: false, green: true };
        int.signals.pedestrian = {
          state: hadRequest ? 'WALK' : 'DONT_WALK',
          countdown: hadRequest ? walkDuration : 0,
          assistActive: isElderly,
          type: isElderly ? 'ELDERLY_ASSIST' : (hadRequest ? 'STANDARD' : 'NONE'),
          buzzerHz: isElderly ? 2 : (hadRequest ? 1 : 0) // Only sounds when requested!
        };
        break;

      case 'CROSS_GREEN':
        // Check if ultrasonic sensor still detects pedestrian in crosswalk (dynamic radar hold)
        if (int.sensors.crosswalkOccupied) {
          const extraSafetySeconds = 5;
          int.safetyHoldRemaining = extraSafetySeconds;
          int.signals.pedestrian.assistActive = true;
          this.analytics.recordSafetyHold(int.id, extraSafetySeconds);
          return;
        }

        // Log completion when assist phase successfully finishes
        if (int.signals.pedestrian.assistActive) {
          int.lastCompletedTurn = int.crossingTurn || 1;
          this.analytics.recordPedestrianCrossingCompleted(int.id, 'ELDERLY_ASSIST', int.lastCompletedTurn);
          int.crossingTurn = (int.crossingTurn || 1) + 1;
        }

        int.currentPhase = 'CROSS_YELLOW';
        int.phaseDuration = this.DEFAULT_TIMINGS.crossYellow;
        int.signals.corridor = { red: true, yellow: false, green: false };
        int.signals.cross = { red: false, yellow: true, green: false };
        int.signals.pedestrian = {
          state: 'DONT_WALK',
          countdown: 0,
          assistActive: false,
          type: 'NONE',
          buzzerHz: 0
        };
        break;

      case 'CROSS_YELLOW':
        int.currentPhase = 'ALL_RED_2';
        int.phaseDuration = this.DEFAULT_TIMINGS.allRed;
        int.signals.corridor = { red: true, yellow: false, green: false };
        int.signals.cross = { red: true, yellow: false, green: false };
        int.signals.pedestrian.state = 'DONT_WALK';
        break;

      case 'ALL_RED_2':
      default:
        // Back to Corridor Green
        int.currentPhase = 'CORRIDOR_GREEN';
        int.phaseDuration = this.DEFAULT_TIMINGS.corridorGreen;
        int.signals.corridor = { red: false, yellow: false, green: true };
        int.signals.cross = { red: true, yellow: false, green: false };
        int.signals.pedestrian.state = 'DONT_WALK';
        int.signals.pedestrian.assistActive = false;
        break;
    }
  }

  /**
   * Pedestrian crosswalk button trigger (Standard or Elderly / Mobility Assist)
   */
  requestPedestrianCrossing(intersectionId, type = 'STANDARD') {
    const int = this.intersections[intersectionId];
    if (!int) return { success: false, message: 'Invalid intersection ID' };

    const extraSeconds = type === 'ELDERLY_ASSIST' 
      ? (this.DEFAULT_TIMINGS.pedestrianWalkElderly - this.DEFAULT_TIMINGS.pedestrianWalkStandard) 
      : 0;
    const duration = type === 'ELDERLY_ASSIST' 
      ? this.DEFAULT_TIMINGS.pedestrianWalkElderly 
      : this.DEFAULT_TIMINGS.pedestrianWalkStandard;

    int.pendingPedestrianRequest = { type, requestedAt: Date.now() };

    // If already in CROSS_GREEN, immediately reset countdown to 24s and walk state
    if (int.currentPhase === 'CROSS_GREEN') {
      int.secondsInPhase = 0;
      int.phaseDuration = duration;
      int.signals.pedestrian.state = 'WALK';
      int.signals.pedestrian.countdown = duration;
      int.signals.pedestrian.assistActive = (type === 'ELDERLY_ASSIST');
      int.signals.pedestrian.type = type;
      int.signals.pedestrian.buzzerHz = (type === 'ELDERLY_ASSIST') ? 2 : 1;
    } else if (int.currentPhase === 'CORRIDOR_GREEN') {
      // Fast responsive transition: change Corridor to Yellow (1s) so walk starts right away!
      int.currentPhase = 'CORRIDOR_YELLOW';
      int.phaseDuration = 1;
      int.secondsInPhase = 0;
      int.signals.corridor = { red: false, yellow: true, green: false };
      int.signals.cross = { red: true, yellow: false, green: false };
    }

    // Set sensor flag
    if (type === 'ELDERLY_ASSIST') {
      int.sensors.pedestrianButtonElderly = true;
      setTimeout(() => { int.sensors.pedestrianButtonElderly = false; }, 3000);
    } else {
      int.sensors.pedestrianButtonStandard = true;
      setTimeout(() => { int.sensors.pedestrianButtonStandard = false; }, 3000);
    }

    this.analytics.recordPedestrianRequest(int.id, type, duration, extraSeconds);

    return {
      success: true,
      intersectionId,
      type,
      durationSeconds: duration,
      extraSecondsGranted: extraSeconds,
      currentPhase: int.currentPhase
    };
  }

  /**
   * Set simulated ultrasonic/radar crosswalk presence sensor
   */
  setCrosswalkOccupied(intersectionId, occupied) {
    const int = this.intersections[intersectionId];
    if (!int) return;
    int.sensors.crosswalkOccupied = Boolean(occupied);
  }

  /**
   * Emergency Preemption: Set corridor GREEN immediately for approaching vehicle
   */
  preemptIntersection(intersectionId, ambulanceId, zone = 'PREEMPT_LOCK') {
    const int = this.intersections[intersectionId];
    if (!int) return;

    if (!int.preemption.active) {
      this.analytics.recordPreemptionEvent(intersectionId, ambulanceId, zone);
    }

    int.preemption.active = true;
    int.preemption.ambulanceId = ambulanceId;
    int.preemption.zone = zone;
    int.currentPhase = 'PREEMPTED_GREEN';

    // Safely lock signals: corridor is green, cross is red, pedestrian is don't walk
    int.signals.corridor = { red: false, yellow: false, green: true };
    int.signals.cross = { red: true, yellow: false, green: false };
    int.signals.pedestrian = {
      state: 'DONT_WALK',
      countdown: 0,
      assistActive: false,
      type: 'NONE',
      buzzerHz: 0
    };
    int.safetyHoldRemaining = 0;
  }

  /**
   * Release preemption when emergency vehicle has cleared the intersection
   */
  releasePreemption(intersectionId) {
    const int = this.intersections[intersectionId];
    if (!int || !int.preemption.active) return;

    int.preemption.active = false;
    int.preemption.ambulanceId = null;
    int.preemption.zone = 'CLEARED';

    // Transition smoothly back: give cross traffic compensatory green (+4s) to discharge queue
    int.currentPhase = 'CORRIDOR_YELLOW';
    int.secondsInPhase = 0;
    int.phaseDuration = this.DEFAULT_TIMINGS.corridorYellow;
    int.signals.corridor = { red: false, yellow: true, green: false };
    int.signals.cross = { red: true, yellow: false, green: false };

    this.analytics.logEvent(
      'SIGNAL',
      `Corridor Released: ${int.id}`,
      `Emergency vehicle cleared. Restoring synchronized cycle with graceful queue clearance.`,
      'info'
    );
  }

  /**
   * Manual Central Dispatch Corridor Override (Force all intersections green or reset)
   */
  setCorridorOverride(forceGreen, reason = 'Central Dispatch Manual Command') {
    this.corridorOverrideActive = forceGreen;
    this.corridorOverrideReason = reason;

    for (const id in this.intersections) {
      if (forceGreen) {
        this.preemptIntersection(id, 'MANUAL_DISPATCH', 'MANUAL_OVERRIDE');
      } else {
        this.releasePreemption(id);
      }
    }

    this.analytics.logEvent(
      'SIGNAL',
      forceGreen ? 'MANUAL GREEN-CORRIDOR ACTIVE' : 'MANUAL OVERRIDE RELEASED',
      `All 4 corridor signals ${forceGreen ? 'LOCKED to GREEN' : 'RESTORED to Auto-Cycling'}. Initiated by Central Dispatch.`,
      forceGreen ? 'warning' : 'info'
    );
  }

  getAllState() {
    return {
      corridorOverrideActive: this.corridorOverrideActive,
      corridorOverrideReason: this.corridorOverrideReason,
      intersections: this.intersections
    };
  }
}

module.exports = TrafficManager;
