# SUMO (Simulation of Urban MObility) Integration

This folder contains SUMO files for microscopic urban traffic simulation along the Hospital Green-Corridor.

## Files
- `corridor.nod.xml`: Node network topology (intersections and entry/exit points).
- `corridor.edg.xml`: Multi-lane arterial roadway and cross streets with speed limits.
- `corridor.rou.xml`: Traffic demand, passenger car flows, and emergency ambulance routes.
- `corridor.sumocfg`: Main SUMO simulation configuration.
- `runner.py`: Python TraCI bridge connecting SUMO to the Central Dispatch WebSocket server.

## How to Run with SUMO
1. Build the network:
   ```bash
   netconvert --node-files=corridor.nod.xml --edge-files=corridor.edg.xml --output-file=corridor.net.xml
   ```
2. Launch SUMO GUI:
   ```bash
   sumo-gui -c corridor.sumocfg
   ```
3. Run the TraCI WebSocket sync bridge:
   ```bash
   python runner.py
   ```
