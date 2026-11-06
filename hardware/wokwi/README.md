# Wokwi Multi-ESP32 Traffic Light Node Simulation (Public Cloud MQTT Sync)

This folder contains the complete embedded hardware simulation for an intelligent traffic intersection node (**INT-3: Community Center & 3rd St**) featuring:
- **Two-Way Cloud Communication** with Central Dispatch Web Application (`http://localhost:3000`) via public HiveMQ broker (`broker.hivemq.com:1883`)
- **No Paid Wokwi Club / No Local Gateway required!** Runs out-of-the-box in free Wokwi in any browser.
- **Dynamic Pedestrian Safety Extension (+14s / 24s total)**: Triggering `E` in Wokwi immediately triggers the Web UI to start the 24s countdown, walk the pedestrian, and sound the rhythmic 2Hz buzzer in Wokwi.
- **Emergency Ambulance Preemption**: Triggering `A` in Wokwi immediately dispatches the ambulance on the Web dashboard and locks the green corridor.

---

## Files Included

1. `diagram.json`: Complete circuit wiring for ESP32 DevKit V4, 8 traffic/pedestrian LEDs, Piezo Buzzer, and 2 push buttons.
2. `sketch.ino`: Firmware with Wi-Fi (`Wokwi-GUEST`) and PubSubClient MQTT synchronization.
3. `libraries.txt`: Declares `PubSubClient` so Wokwi automatically links the library.

---

## Hardware Pin Connections

| Peripheral | Component | GPIO Pin | Description |
| :--- | :--- | :--- | :--- |
| **Corridor Arterial (East-West)** | Red LED | `GPIO 12` | Arterial Stop |
| | Yellow LED | `GPIO 13` | Arterial Clearance |
| | Green LED | `GPIO 14` | Arterial Green Wave |
| **Cross Street (North-South)** | Red LED | `GPIO 25` | Cross Street Stop |
| | Yellow LED | `GPIO 26` | Cross Street Clearance |
| | Green LED | `GPIO 27` | Cross Street Green |
| **Pedestrian Crosswalk** | Red LED | `GPIO 32` | Don't Walk (Stop) |
| | Green LED | `GPIO 33` | Walk (Cross Now) |
| **Acoustic Assist** | Piezo Buzzer | `GPIO 4` | 2Hz/4Hz audible assist chime |
| **Sensors & Inputs** | Green Push Button | `GPIO 18` | Standard Walk Call (10s) |
| | Blue Push Button | `GPIO 19` | Elderly / Disability Assist (+14s extension) |

---

## How to Run in Wokwi (3 Simple Steps)

1. Open your project on [https://wokwi.com](https://wokwi.com) (select **ESP32**).
2. In Wokwi:
   - Click the **`diagram.json`** tab and paste the contents of `hardware/wokwi/diagram.json`.
   - Click the **`sketch.ino`** tab and paste the contents of `hardware/wokwi/sketch.ino`.
   - In the **Library Manager** tab (or `libraries.txt`), ensure **`PubSubClient`** is added.
3. Click **Start Simulation** (Green Play button).

---

## Interactive Serial Commands

| Command | Action | Traffic Signal & Web Dashboard Behavior |
| :--- | :--- | :--- |
| `E` or `ELDERLY` | Elderly / Disabled Walk Assist (+14s) | Instantly triggers the Web App: INT-3 switches to Yellow $\rightarrow$ Walk Green with **24s countdown**. Wokwi LEDs match the web and the buzzer sounds the 2Hz acoustic chime during the crossing! |
| `S` or `STD` | Standard Walk Call | Triggers standard 10s pedestrian crossing on the Web and in Wokwi. |
| `A` or `AMB` | Code 3 Ambulance Dispatch | Dispatches Ambulance 101 on the Web dashboard at 75 km/h. Corridor locks Solid Green, cross street turns Red in Wokwi. |
| `C` or `CLEAR` | Ambulance Clearance | Releases preemption on the Web and restores normal signal cycles. |
