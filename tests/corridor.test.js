/**
 * corridor.test.js
 * Automated unit and integration tests for Smart Green-Corridor & Pedestrian Safety
 */

const assert = require('assert');
const AnalyticsService = require('../src/AnalyticsService');
const TrafficManager = require('../src/TrafficManager');
const CorridorEngine = require('../src/CorridorEngine');
const HardwareNodeSimulator = require('../src/HardwareNodeSimulator');

console.log('🧪 Starting Smart Green-Corridor Test Suite...\n');

// 1. Test Analytics Service
console.log('Test 1: Analytics Service calculation of response time reduction...');
const analytics = new AnalyticsService();
const tripRecord = analytics.recordEmergencyTripCompleted({
  ambulanceId: 'AMB-TEST-1',
  routeName: 'Test Corridor',
  elapsedSeconds: 58,
  baselineSeconds: 145,
  intersectionsCleared: 4
});

assert.strictEqual(tripRecord.savedSeconds, 87, 'Saved seconds should be 145 - 58 = 87');
assert.ok(tripRecord.reductionPercent > 50, 'Reduction percent should be > 50%');
console.log(`  ✓ Passed: Response time reduction = ${tripRecord.reductionPercent}% (${tripRecord.savedSeconds}s saved)`);

// 2. Test Traffic Manager - Pedestrian Dynamic Extension
console.log('\nTest 2: Pedestrian Safety - Elderly / Disability dynamic crossing extension...');
const traffic = new TrafficManager(analytics);
const int3 = traffic.intersections['INT-3']; // Community Zone

// Request standard crossing
const stdResult = traffic.requestPedestrianCrossing('INT-3', 'STANDARD');
assert.strictEqual(stdResult.type, 'STANDARD');
assert.strictEqual(stdResult.durationSeconds, 10);
console.log('  ✓ Standard crossing requests standard 10s walk duration.');

// Request elderly assist crossing
const eldResult = traffic.requestPedestrianCrossing('INT-3', 'ELDERLY_ASSIST');
assert.strictEqual(eldResult.type, 'ELDERLY_ASSIST');
assert.strictEqual(eldResult.durationSeconds, 24);
assert.strictEqual(eldResult.extraSecondsGranted, 14);
console.log(`  ✓ Passed: Elderly assist dynamically allocated +${eldResult.extraSecondsGranted}s extra time (Total: ${eldResult.durationSeconds}s)`);

// 3. Test Ultrasonic Safety Hold Radar
console.log('\nTest 3: Ultrasonic radar crosswalk occupancy hold...');
traffic.setCrosswalkOccupied('INT-3', true);
assert.strictEqual(int3.sensors.crosswalkOccupied, true);
int3.currentPhase = 'CROSS_GREEN';
int3.secondsInPhase = int3.phaseDuration;
traffic.tickIntersection(int3);
assert.ok(int3.safetyHoldRemaining > 0, 'Safety hold should be triggered when crosswalk is occupied at end of phase');
console.log(`  ✓ Passed: Dynamic safety hold activated for +${int3.safetyHoldRemaining}s holding vehicle red.`);

// 4. Test Emergency Ambulance Preemption (Green Corridor)
console.log('\nTest 4: Green Corridor Emergency Preemption...');
traffic.preemptIntersection('INT-1', 'AMB-101', 'ZONE_2_PREEMPT');
const int1 = traffic.intersections['INT-1'];
assert.strictEqual(int1.preemption.active, true);
assert.strictEqual(int1.signals.corridor.green, true);
assert.strictEqual(int1.signals.cross.red, true);
assert.strictEqual(int1.signals.pedestrian.state, 'DONT_WALK');
console.log('  ✓ Passed: Preemption engaged - Corridor signal locked GREEN, cross-traffic locked RED, pedestrian locked DONT_WALK.');

// Release preemption
traffic.releasePreemption('INT-1');
assert.strictEqual(int1.preemption.active, false);
console.log('  ✓ Passed: Preemption released - graceful cycle restoration engaged.');

// 5. Test Hardware Simulator & GPIO Mapping
console.log('\nTest 5: Hardware Node Simulator (ESP32 GPIO Sync)...');
const hardware = new HardwareNodeSimulator(traffic);
hardware.updateTelemetry();
const hwNode3 = hardware.nodes['INT-3'];
assert.ok(hwNode3.gpio, 'ESP32 GPIO map should be present');
assert.strictEqual(typeof hwNode3.gpio.PIN_14_EW_GREEN, 'boolean');
assert.strictEqual(typeof hwNode3.gpio.PIN_18_BTN_STANDARD, 'number');
assert.strictEqual(typeof hwNode3.gpio.PIN_19_BTN_ELDERLY, 'number');
assert.ok(hwNode3.pingMs < 100, 'Sub-second latency');
console.log(`  ✓ Passed: Virtual ESP32 node running with telemetry latency ${hwNode3.pingMs}ms and valid GPIO mapping.`);

// 6. Test Corridor Engine Simulation Progression
console.log('\nTest 6: Corridor Engine Ambulance Movement & Geofencing...');
const corridor = new CorridorEngine(traffic, analytics);
const dispatchResult = corridor.dispatchAmbulance('AMB-101');
assert.strictEqual(dispatchResult.success, true);
assert.strictEqual(corridor.ambulances['AMB-101'].status, 'EN_ROUTE');

// Advance simulation by 15 seconds (dt = 0.5s x 30)
for (let i = 0; i < 30; i++) {
  corridor.tickSimulation(0.5);
}
assert.ok(corridor.ambulances['AMB-101'].position > 100, 'Ambulance should have advanced along corridor');
console.log(`  ✓ Passed: Ambulance progressed to ${corridor.ambulances['AMB-101'].position.toFixed(1)}m along corridor at ${corridor.ambulances['AMB-101'].speedKmh.toFixed(1)} km/h.`);

// Clean up timers
clearInterval(traffic.tickInterval);
clearInterval(hardware.interval);
clearInterval(corridor.simInterval);

console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! (6/6 tests passing)\n');
process.exit(0);
