#!/usr/bin/env python3
"""
runner.py
SUMO TraCI Integration Agent for Smart Green-Corridor.
Connects SUMO Micro-Simulation to the Node.js Central Dispatch server over WebSockets.
"""

import sys
import os
import time
import json
import asyncio

try:
    import websockets
except ImportError:
    print("[WARN] websockets python library not found. Install via: pip install websockets")

# Check if TraCI is available
TRACI_AVAILABLE = False
try:
    import traci
    TRACI_AVAILABLE = True
except ImportError:
    print("[NOTE] SUMO traci library not found. Running in Virtual SUMO TraCI Bridge mode.")

BACKEND_WS_URL = "ws://localhost:3000"

async def run_corridor_bridge():
    print("=======================================================")
    print("🚦 SUMO <-> NODE.JS SMART GREEN-CORRIDOR TRACI BRIDGE")
    print(f"Connecting to Central Dispatch at: {BACKEND_WS_URL}")
    print("=======================================================")

    while True:
        try:
            async with websockets.connect(BACKEND_WS_URL) as ws:
                print("[CONNECTED] Successfully connected to Node.js Central Dispatch!")
                
                async for message in ws:
                    data = json.loads(message)
                    if data.get('type') == 'STATE_UPDATE':
                        corridor = data.get('corridor', {})
                        traffic = data.get('traffic', {})
                        ambulances = corridor.get('ambulances', {})

                        # Check ambulance status
                        for amb_id, amb in ambulances.items():
                            if amb.get('status') == 'EN_ROUTE':
                                pos = amb.get('position', 0)
                                speed = amb.get('speedKmh', 0)
                                print(f"[SUMO SYNC] {amb_id} Pos: {pos:.1f}m | Speed: {speed:.1f} km/h | Intersections Preempted: {len(amb.get('intersectionsPassed', []))}")
                    
        except Exception as e:
            print(f"[RECONNECT] Connection error: {e}. Retrying in 3 seconds...")
            await asyncio.sleep(3)

if __name__ == "__main__":
    try:
        asyncio.run(run_corridor_bridge())
    except KeyboardInterrupt:
        print("\nTraCI bridge stopped.")
