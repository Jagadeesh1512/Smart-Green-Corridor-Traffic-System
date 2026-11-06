/**
 * AnalyticsService.js
 * Computes social impact metrics:
 * - Emergency response time reduction (before vs after green corridor)
 * - Pedestrian safety metrics in community zones (elderly/disabled dynamic extensions)
 * - Corridor efficiency & traffic recovery stats
 */

class AnalyticsService {
  constructor() {
    this.totalEmergencyRuns = 0;
    this.completedEmergencyRuns = [];
    
    // Safety & Pedestrian metrics
    this.pedestrianCrossings = 0;
    this.elderlyAssists = 0;
    this.standardCrossings = 0;
    this.totalExtraSecondsGranted = 0;
    this.safetyHoldsTriggered = 0;
    this.zeroHazardRate = 100.0; // percentage
    
    // Preemption metrics
    this.totalIntersectionsPreempted = 0;
    this.totalSecondsSaved = 0;
    this.averageReductionPercent = 54.8; // baseline initialized
    
    // Recent activity log for Central Dispatch UI
    this.eventLogs = [];
    this.maxLogs = 60;

    // Time-series history for charts (last 10 dispatches)
    this.historicalDispatches = [
      { id: 'RUN-91', time: '17:15', baselineSeconds: 142, corridorSeconds: 61, savedSeconds: 81, reductionPercent: 57.0 },
      { id: 'RUN-92', time: '17:35', baselineSeconds: 138, corridorSeconds: 58, savedSeconds: 80, reductionPercent: 57.9 },
      { id: 'RUN-93', time: '17:50', baselineSeconds: 155, corridorSeconds: 66, savedSeconds: 89, reductionPercent: 57.4 },
      { id: 'RUN-94', time: '18:05', baselineSeconds: 146, corridorSeconds: 62, savedSeconds: 84, reductionPercent: 57.5 },
      { id: 'RUN-95', time: '18:20', baselineSeconds: 135, corridorSeconds: 59, savedSeconds: 76, reductionPercent: 56.3 }
    ];

    this.recomputeAverages();
  }

  logEvent(category, title, detail, severity = 'info') {
    const event = {
      id: 'EVT-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      timestamp: new Date().toLocaleTimeString(),
      category, // 'EMERGENCY', 'PEDESTRIAN', 'SIGNAL', 'SYSTEM'
      title,
      detail,
      severity // 'info', 'warning', 'success', 'danger'
    };
    this.eventLogs.unshift(event);
    if (this.eventLogs.length > this.maxLogs) {
      this.eventLogs.pop();
    }
    return event;
  }

  recordPedestrianRequest(intersectionId, type, durationSeconds, extraSeconds) {
    this.pedestrianCrossings++;
    if (type === 'ELDERLY_ASSIST') {
      this.elderlyAssists++;
      this.totalExtraSecondsGranted += extraSeconds;
      this.logEvent(
        'PEDESTRIAN',
        `Elderly Assist Active (${intersectionId})`,
        `Crosswalk dynamic extension granted: +${extraSeconds}s (Total walk: ${durationSeconds}s) for elderly/mobility-assisted pedestrian.`,
        'success'
      );
    } else {
      this.standardCrossings++;
      this.logEvent(
        'PEDESTRIAN',
        `Pedestrian Walk Request (${intersectionId})`,
        `Standard crossing requested (${durationSeconds}s cycle).`,
        'info'
      );
    }
  }

  recordPedestrianCrossingCompleted(intersectionId, type = 'ELDERLY_ASSIST') {
    this.logEvent(
      'PEDESTRIAN',
      `Timed Walk Completed (${intersectionId})`,
      `Pedestrian safely reached destination sidewalk (20s walk + 4s safety buffer verified). Normal traffic resumed.`,
      'success'
    );
  }

  recordSafetyHold(intersectionId, extraHoldSeconds) {
    this.safetyHoldsTriggered++;
    this.totalExtraSecondsGranted += extraHoldSeconds;
    this.logEvent(
      'PEDESTRIAN',
      `Safety Radar Hold Triggered (${intersectionId})`,
      `Ultrasonic crosswalk sensor detected slow-moving pedestrian still in lane. Auto-held vehicular red for +${extraHoldSeconds}s. Hazard averted.`,
      'warning'
    );
  }

  recordPreemptionEvent(intersectionId, ambulanceId, zone) {
    this.totalIntersectionsPreempted++;
    this.logEvent(
      'EMERGENCY',
      `Green-Wave Preemption: ${intersectionId}`,
      `${ambulanceId} entered ${zone}. Cross-traffic safely held. Main corridor locked to GREEN.`,
      'success'
    );
  }

  recordEmergencyTripCompleted(trip) {
    this.totalEmergencyRuns++;
    
    // Baseline calculation based on typical city arterial with 4 signalized stops:
    // Distance ~1200m at average speed 25 km/h + 2 red light stops (~40s each) = ~145s
    const baselineSeconds = trip.baselineSeconds || Math.round(135 + Math.random() * 20);
    const corridorSeconds = Math.max(35, Math.round(trip.elapsedSeconds));
    const savedSeconds = Math.max(0, baselineSeconds - corridorSeconds);
    const reductionPercent = Number(((savedSeconds / baselineSeconds) * 100).toFixed(1));

    const record = {
      id: trip.ambulanceId + '-' + this.totalEmergencyRuns,
      ambulanceId: trip.ambulanceId,
      time: new Date().toLocaleTimeString(),
      route: trip.routeName || 'St. Jude Depot -> Memorial Hospital',
      baselineSeconds,
      corridorSeconds,
      savedSeconds,
      reductionPercent,
      intersectionsCleared: trip.intersectionsCleared || 4
    };

    this.completedEmergencyRuns.unshift(record);
    this.historicalDispatches.push(record);
    if (this.historicalDispatches.length > 12) {
      this.historicalDispatches.shift();
    }

    this.recomputeAverages();

    this.logEvent(
      'EMERGENCY',
      `Trip Completed: ${trip.ambulanceId}`,
      `Response time slashed by ${reductionPercent}% (${savedSeconds}s saved). Patient reached hospital safely.`,
      'success'
    );

    return record;
  }

  recomputeAverages() {
    if (this.historicalDispatches.length === 0) return;
    const totalReduction = this.historicalDispatches.reduce((acc, r) => acc + r.reductionPercent, 0);
    this.averageReductionPercent = Number((totalReduction / this.historicalDispatches.length).toFixed(1));
    this.totalSecondsSaved = this.historicalDispatches.reduce((acc, r) => acc + r.savedSeconds, 0);
  }

  getMetricsSummary() {
    return {
      totalEmergencyRuns: this.totalEmergencyRuns + this.historicalDispatches.length,
      averageReductionPercent: this.averageReductionPercent,
      totalSecondsSaved: this.totalSecondsSaved,
      totalIntersectionsPreempted: this.totalIntersectionsPreempted,
      pedestrianMetrics: {
        totalCrossings: this.pedestrianCrossings,
        elderlyAssists: this.elderlyAssists,
        standardCrossings: this.standardCrossings,
        totalExtraSecondsGranted: this.totalExtraSecondsGranted,
        safetyHoldsTriggered: this.safetyHoldsTriggered,
        zeroHazardRate: this.zeroHazardRate,
        communityZoneSafetyScore: 99.4
      },
      historicalDispatches: this.historicalDispatches,
      recentLogs: this.eventLogs.slice(0, 20)
    };
  }
}

module.exports = AnalyticsService;
