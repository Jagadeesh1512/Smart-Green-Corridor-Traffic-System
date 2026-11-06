/**
 * sketch.ino
 * ESP32 Smart Traffic Controller Node Firmware (INT-3: Community Zone)
 * Multi-Intersection Green Corridor & Dynamic Pedestrian Safety Controller
 * 
 * 100% Free Public Cloud MQTT Communication with Central Dispatch Web App:
 *  - Broker: broker.hivemq.com (Port 1883)
 *  - Outbound Topic: smartcorridor/vinay/pedestrian (Triggers Walk & Elderly +14s on Web)
 *  - Outbound Topic: smartcorridor/vinay/emergency  (Dispatches & Clears Ambulance on Web)
 *  - Inbound Topic:  smartcorridor/vinay/int3/signals (Syncs LEDs & Buzzer from Web)
 * 
 * Works out-of-the-box in Wokwi without paid Wokwi Club or local gateway!
 */

#include <WiFi.h>
#include <PubSubClient.h>

// ---------------- GPIO PIN DEFINITIONS (Matches diagram.json) ---------------- //
// Corridor Arterial (East-West) Traffic Lights
#define PIN_EW_RED     12
#define PIN_EW_YELLOW  13
#define PIN_EW_GREEN   14

// Cross Street (North-South) Traffic Lights
#define PIN_NS_RED     25
#define PIN_NS_YELLOW  26
#define PIN_NS_GREEN   27

// Pedestrian Crosswalk Signals
#define PIN_PED_RED    32   // Don't Walk (Red)
#define PIN_PED_GREEN  33   // Walk (Green)

// Audio Actuator
#define PIN_BUZZER     4    // Piezo Buzzer for Visually Impaired / Assist Audio Chime

// Push Button Inputs (Active LOW with internal pull-up)
#define PIN_BTN_STD    18   // Standard Crosswalk Request (10s)
#define PIN_BTN_ELD    19   // Elderly / Disability Dynamic Assist (+14s, total 24s)

// ---------------- NETWORK & MQTT CONFIGURATION ---------------- //
const char* NODE_ID     = "INT-3";
const char* WIFI_SSID   = "Wokwi-GUEST";
const char* WIFI_PASS   = "";

// Public HiveMQ Broker accessible from Wokwi free tier and local Node.js server
const char* MQTT_SERVER = "broker.hivemq.com";
const int   MQTT_PORT   = 1883;

const char* TOPIC_PED_PUB    = "smartcorridor/vinay/pedestrian";
const char* TOPIC_EMERG_PUB  = "smartcorridor/vinay/emergency";
const char* TOPIC_SIGNALS_SUB= "smartcorridor/vinay/int3/signals";

WiFiClient espClient;
PubSubClient mqttClient(espClient);

// State Variables
int currentBuzzerHz = 0;
bool isEmergencyPreempted = false;
bool isElderlyAssistActive = false;
unsigned long lastMqttReconnectAttempt = 0;

// Button Debounce and Flags
volatile bool standardButtonPressed = false;
volatile bool elderlyButtonPressed  = false;
unsigned long lastDebounceStd = 0;
unsigned long lastDebounceEld = 0;

// Buzzer Timing
unsigned long lastBuzzerChime = 0;

// Local Fallback State Variables (Runs if MQTT is reconnecting)
enum SignalPhase {
  CORRIDOR_GREEN,
  CORRIDOR_YELLOW,
  ALL_RED_1,
  CROSS_GREEN,
  CROSS_YELLOW,
  ALL_RED_2
};
SignalPhase localPhase = CORRIDOR_GREEN;
unsigned long localPhaseStartTime = 0;
unsigned long localPhaseDurationMs = 20000;

// ---------------- INTERRUPT SERVICE ROUTINES ---------------- //
void IRAM_ATTR handleStandardButton() {
  unsigned long now = millis();
  if (now - lastDebounceStd > 350) {
    standardButtonPressed = true;
    lastDebounceStd = now;
  }
}

void IRAM_ATTR handleElderlyButton() {
  unsigned long now = millis();
  if (now - lastDebounceEld > 350) {
    elderlyButtonPressed = true;
    lastDebounceEld = now;
  }
}

// ---------------- LIGHTWEIGHT JSON PARSER (Zero Dependencies) ---------------- //
int extractVal(const String& str, const char* section, const char* key) {
  int secIdx = (section != NULL) ? str.indexOf(section) : 0;
  if (secIdx < 0) return 0;
  int keyIdx = str.indexOf(key, secIdx);
  if (keyIdx < 0) return 0;
  int colonIdx = str.indexOf(':', keyIdx);
  if (colonIdx < 0) return 0;
  int start = colonIdx + 1;
  while (start < (int)str.length() && (str[start] == ' ' || str[start] == '\"')) start++;
  int end = start;
  while (end < (int)str.length() && (isDigit(str[end]) || str[end] == '-')) end++;
  return str.substring(start, end).toInt();
}

// ---------------- HARDWARE OUTPUT HELPERS ---------------- //
void setCorridorLights(bool r, bool y, bool g) {
  digitalWrite(PIN_EW_RED,    r ? HIGH : LOW);
  digitalWrite(PIN_EW_YELLOW, y ? HIGH : LOW);
  digitalWrite(PIN_EW_GREEN,  g ? HIGH : LOW);
}

void setCrossLights(bool r, bool y, bool g) {
  digitalWrite(PIN_NS_RED,    r ? HIGH : LOW);
  digitalWrite(PIN_NS_YELLOW, y ? HIGH : LOW);
  digitalWrite(PIN_NS_GREEN,  g ? HIGH : LOW);
}

void setPedestrianLights(bool dontWalkRed, bool walkGreen) {
  digitalWrite(PIN_PED_RED,   dontWalkRed ? HIGH : LOW);
  digitalWrite(PIN_PED_GREEN, walkGreen   ? HIGH : LOW);
}

// ---------------- MQTT MESSAGE CALLBACK ---------------- //
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  char message[256];
  if (length >= sizeof(message)) length = sizeof(message) - 1;
  memcpy(message, payload, length);
  message[length] = '\0';

  String json = String(message);

  // Parse Corridor Signals
  int ewR = extractVal(json, "ew", "r");
  int ewY = extractVal(json, "ew", "y");
  int ewG = extractVal(json, "ew", "g");
  setCorridorLights(ewR == 1, ewY == 1, ewG == 1);

  // Parse Cross Signals
  int nsR = extractVal(json, "ns", "r");
  int nsY = extractVal(json, "ns", "y");
  int nsG = extractVal(json, "ns", "g");
  setCrossLights(nsR == 1, nsY == 1, nsG == 1);

  // Parse Pedestrian Signals
  int pedR = extractVal(json, "ped", "r");
  int pedG = extractVal(json, "ped", "g");
  setPedestrianLights(pedR == 1, pedG == 1);

  // Parse Audio Buzzer & Countdown
  currentBuzzerHz       = extractVal(json, "ped", "buzz");
  int countdown         = extractVal(json, "ped", "cd");
  isElderlyAssistActive = (extractVal(json, "ped", "assist") == 1);
  isEmergencyPreempted  = (extractVal(json, NULL, "preempt") == 1);

  static int lastCountdown = -1;
  if (pedG == 1 && countdown != lastCountdown && countdown > 0) {
    lastCountdown = countdown;
    Serial.printf("[CENTRAL SYNC] WALK ACTIVE on Web | Countdown: %ds | Buzzer: %dHz | Assist: %s\n",
                  countdown, currentBuzzerHz, isElderlyAssistActive ? "+14s ACTIVE" : "NO");
  } else if (pedG == 0) {
    lastCountdown = -1;
  }
}

// ---------------- MQTT RECONNECT ---------------- //
bool reconnectMQTT() {
  if (mqttClient.connected()) return true;

  String clientId = "Wokwi-ESP32-INT3-";
  clientId += String(random(0xffff), HEX);

  Serial.print("[MQTT] Connecting to HiveMQ Cloud Broker...");
  if (mqttClient.connect(clientId.c_str())) {
    Serial.println(" CONNECTED!");
    mqttClient.subscribe(TOPIC_SIGNALS_SUB);
    Serial.printf("[MQTT] Subscribed to Live Signals Topic: %s\n", TOPIC_SIGNALS_SUB);
    return true;
  } else {
    Serial.printf(" FAILED (rc=%d). Will retry.\n", mqttClient.state());
    return false;
  }
}

// ---------------- SETUP ---------------- //
void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println("\n=======================================================");
  Serial.println("🚦 SMART GREEN-CORRIDOR: ESP32 TRAFFIC NODE (INT-3)");
  Serial.println("   Community Zone Dynamic Pedestrian Assist Controller");
  Serial.println("=======================================================");

  // Output Pins Setup
  pinMode(PIN_EW_RED,    OUTPUT);
  pinMode(PIN_EW_YELLOW, OUTPUT);
  pinMode(PIN_EW_GREEN,  OUTPUT);
  pinMode(PIN_NS_RED,    OUTPUT);
  pinMode(PIN_NS_YELLOW, OUTPUT);
  pinMode(PIN_NS_GREEN,  OUTPUT);
  pinMode(PIN_PED_RED,   OUTPUT);
  pinMode(PIN_PED_GREEN, OUTPUT);
  pinMode(PIN_BUZZER,    OUTPUT);

  // Input Pins Setup (Internal Pull-Up)
  pinMode(PIN_BTN_STD, INPUT_PULLUP);
  pinMode(PIN_BTN_ELD, INPUT_PULLUP);

  attachInterrupt(digitalPinToInterrupt(PIN_BTN_STD), handleStandardButton, FALLING);
  attachInterrupt(digitalPinToInterrupt(PIN_BTN_ELD), handleElderlyButton,  FALLING);

  // Initial State: Corridor Green, Cross Red, Ped Don't Walk
  setCorridorLights(false, false, true);
  setCrossLights(true, false, false);
  setPedestrianLights(true, false);
  noTone(PIN_BUZZER);
  localPhaseStartTime = millis();

  // Fast Wi-Fi Connection (Channel 6 skips scanning)
  Serial.printf("[WIFI] Connecting to '%s' ...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS, 6);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 15) {
    delay(200);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected! IP Address: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WIFI] Reconnecting in background...");
  }

  // Setup MQTT
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  reconnectMQTT();

  Serial.println("\n[COMMANDS] Interactive Testing (Type in Serial or Click Push Buttons):");
  Serial.println("  'E' or 'ELDERLY' -> Trigger Elderly Walk Assist (+14s) on Web & Wokwi");
  Serial.println("  'S' or 'STD'     -> Trigger Standard Walk Call (10s)");
  Serial.println("  'A' or 'AMB'     -> Dispatch Code 3 Ambulance on Web & Lock Green Corridor");
  Serial.println("  'C' or 'CLEAR'   -> Release Ambulance Preemption");
  Serial.println("-------------------------------------------------------\n");
}

// ---------------- MAIN LOOP ---------------- //
void loop() {
  unsigned long now = millis();

  // 1. Maintain Wi-Fi and MQTT Connection
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) {
      if (now - lastMqttReconnectAttempt > 3000) {
        lastMqttReconnectAttempt = now;
        reconnectMQTT();
      }
    } else {
      mqttClient.loop();
    }
  }

  // 2. Process Hardware Push Buttons
  if (standardButtonPressed) {
    standardButtonPressed = false;
    Serial.println("\n[HARDWARE BUTTON] Pin 18 Pressed: Standard Walk Request.");
    if (mqttClient.connected()) {
      mqttClient.publish(TOPIC_PED_PUB, "{\"intersectionId\":\"INT-3\",\"type\":\"STANDARD\"}");
      Serial.println("[MQTT] >> Published STANDARD to Central Dispatch Web Server <<");
    }
  }

  if (elderlyButtonPressed) {
    elderlyButtonPressed = false;
    Serial.println("\n[HARDWARE BUTTON] Pin 19 Pressed: >>> ELDERLY / DISABILITY ASSIST (+14s) <<<");
    if (mqttClient.connected()) {
      mqttClient.publish(TOPIC_PED_PUB, "{\"intersectionId\":\"INT-3\",\"type\":\"ELDERLY_ASSIST\"}");
      Serial.println("[MQTT] >> Published ELDERLY_ASSIST (+14s) to Central Dispatch Web Server <<");
    }
  }

  // 3. Process Serial Monitor Commands
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toUpperCase();

    if (cmd == "E" || cmd == "ELDERLY") {
      Serial.println("\n[SERIAL COMMAND] >>> ELDERLY / DISABILITY ASSIST ('E') RECEIVED <<<");
      if (mqttClient.connected()) {
        mqttClient.publish(TOPIC_PED_PUB, "{\"intersectionId\":\"INT-3\",\"type\":\"ELDERLY_ASSIST\"}");
        Serial.println("[MQTT] >> Sent ELDERLY_ASSIST (+14s) to Web App! Web Page Action Triggered! <<");
      } else {
        Serial.println("[WARNING] MQTT reconnecting, retrying message...");
      }
    } else if (cmd == "S" || cmd == "STD") {
      Serial.println("\n[SERIAL COMMAND] Standard Crosswalk Call Received.");
      if (mqttClient.connected()) {
        mqttClient.publish(TOPIC_PED_PUB, "{\"intersectionId\":\"INT-3\",\"type\":\"STANDARD\"}");
        Serial.println("[MQTT] Sent STANDARD Walk Call to Web App.");
      }
    } else if (cmd == "A" || cmd == "AMB") {
      Serial.println("\n[SERIAL COMMAND] >>> EMERGENCY AMBULANCE BEACON ('A') DETECTED <<<");
      if (mqttClient.connected()) {
        mqttClient.publish(TOPIC_EMERG_PUB, "{\"action\":\"DISPATCH\",\"ambulanceId\":\"AMB-101\"}");
        Serial.println("[MQTT] >> Sent CODE 3 DISPATCH to Web App! Ambulance Moving & Corridor Locked! <<");
      }
    } else if (cmd == "C" || cmd == "CLEAR") {
      Serial.println("\n[SERIAL COMMAND] Ambulance Cleared Intersection ('C').");
      if (mqttClient.connected()) {
        mqttClient.publish(TOPIC_EMERG_PUB, "{\"action\":\"CLEAR\",\"ambulanceId\":\"AMB-101\"}");
        Serial.println("[MQTT] Sent AMBULANCE CLEAR to Web App. Restoring Normal Cycle.");
      }
    }
  }

  // 4. Audio Beeper Cadence for Pedestrian Safety in Wokwi
  // Buzzer ONLY sounds when walk assist or safety hold is active on the Web App!
  if (currentBuzzerHz > 0) {
    unsigned long interval = (currentBuzzerHz == 4) ? 250 : ((currentBuzzerHz == 2) ? 500 : 1000);
    unsigned long toneDuration = (currentBuzzerHz == 4) ? 50 : 80;

    if (now - lastBuzzerChime >= interval) {
      lastBuzzerChime = now;
      tone(PIN_BUZZER, 880, toneDuration); // Crisp 880Hz acoustic assist chime
    }
  } else {
    noTone(PIN_BUZZER);
  }

  // 5. Autonomous Fallback Engine (Runs only if disconnected from MQTT)
  if (!mqttClient.connected()) {
    unsigned long elapsed = now - localPhaseStartTime;
    if (elapsed >= localPhaseDurationMs) {
      localPhaseStartTime = now;
      switch (localPhase) {
        case CORRIDOR_GREEN:
          localPhase = CORRIDOR_YELLOW;
          localPhaseDurationMs = 2500;
          setCorridorLights(false, true, false);
          break;
        case CORRIDOR_YELLOW:
          localPhase = ALL_RED_1;
          localPhaseDurationMs = 1200;
          setCorridorLights(true, false, false);
          break;
        case ALL_RED_1:
          localPhase = CROSS_GREEN;
          localPhaseDurationMs = 10000;
          setCorridorLights(true, false, false);
          setCrossLights(false, false, true);
          setPedestrianLights(false, true);
          currentBuzzerHz = 1;
          break;
        case CROSS_GREEN:
          localPhase = CROSS_YELLOW;
          localPhaseDurationMs = 2500;
          currentBuzzerHz = 0;
          noTone(PIN_BUZZER);
          setCrossLights(false, true, false);
          setPedestrianLights(true, false);
          break;
        case CROSS_YELLOW:
          localPhase = ALL_RED_2;
          localPhaseDurationMs = 1200;
          setCrossLights(true, false, false);
          break;
        case ALL_RED_2:
        default:
          localPhase = CORRIDOR_GREEN;
          localPhaseDurationMs = 18000;
          setCorridorLights(false, false, true);
          setCrossLights(true, false, false);
          setPedestrianLights(true, false);
          break;
      }
    }
  }

  delay(15);
}
