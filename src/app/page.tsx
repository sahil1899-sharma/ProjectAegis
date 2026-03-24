/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import {
  ShieldAlert, Radio, Cpu, MapPin,
  Terminal, Navigation, Flame, CheckCircle2,
  AlertTriangle, Target, Activity, Send, Cloud
} from 'lucide-react';
const FIREBASE_URL = "https://projectaegis-54992-default-rtdb.asia-southeast1.firebasedatabase.app/command.json";

type LogEntry = {
  id?: string;
  time: string;
  message: string;
  type?: 'info' | 'warn' | 'error' | 'success';
};

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2
    }
  }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 30, filter: 'blur(10px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      duration: 0.8
    }
  }
};

const navVariants: Variants = {
  hidden: { y: -100, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: 'spring', stiffness: 100, damping: 20, duration: 0.8 }
  }
};

export default function AegisDashboard() {
  const [isCriticalAlert, setIsCriticalAlert] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [destination, setDestination] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [droneTelemetry, setDroneTelemetry] = useState({ battery: 100, altitude: 0, status: 'STNDBY' });
  const [isBleConnected, setIsBleConnected] = useState(false);
  const [bleError, setBleError] = useState<string | null>(null);
  const telemetryIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const consoleEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const addLog = useCallback((message: string, type: any = 'info') => {
    setLogs(prev => {
      const newLogs = [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        time: new Date().toLocaleTimeString(),
        message,
        type
      }];
      return newLogs.slice(-50); // Keep console clean (max 50 items)
    });
  }, []);

  // --- Initialize Console (Client Side Only) ---
  useEffect(() => {
    // Only run once on mount
    addLog("Aegis System Initialized...");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isCloudLinked, setIsCloudLinked] = useState(false);

  // --- Auto-scroll Console ---
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // --- Audio Alarm Logic (Web Audio API) ---
  useEffect(() => {
    if (isCriticalAlert) {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      // Implement a harsher dual-tone klaxon alarm
      const beepInterval = setInterval(() => {
        if (ctx.state === 'running') {
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const masterGain = ctx.createGain();

          osc1.type = 'sawtooth';
          osc1.frequency.value = 850; // Pitch 1

          osc2.type = 'square';
          osc2.frequency.value = 900; // Pitch 2 (dissonant)

          masterGain.gain.setValueAtTime(0.15, ctx.currentTime);
          masterGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

          osc1.connect(masterGain);
          osc2.connect(masterGain);
          masterGain.connect(ctx.destination);

          osc1.start(ctx.currentTime);
          osc2.start(ctx.currentTime);
          osc1.stop(ctx.currentTime + 0.4);
          osc2.stop(ctx.currentTime + 0.4);
        }
      }, 600); // Beep every 600ms

      return () => {
        clearInterval(beepInterval);
      };
    } else {
      // Suspend context when not alarming to save resources
      if (audioContextRef.current?.state === 'running') {
        audioContextRef.current.suspend();
      }
    }
  }, [isCriticalAlert]);

  const handleConnectCloud = async () => {
    addLog('Requesting Secure Cloud Uplink...', 'info');
    setIsCloudLinked(true);
    addLog('Cloud Uplink Established.', 'success');
  };

  const connectWearable = async () => {
    try {
      setBleError(null);
      addLog("Scanning for BLE Wearable Nodes...");

      const nav: any = navigator;
      // 1. Request the specific Bluetooth device
      const device = await nav.bluetooth.requestDevice({
        filters: [{ name: 'AEGIS_WEARABLE' }],
        optionalServices: ['4fafc201-1fb5-459e-8fcc-c5c9c331914b']
      });

      // Handle raw disconnections seamlessly
      device.addEventListener('gattserverdisconnected', () => {
        setIsBleConnected(false);
        setBleError("Wearable Node Disconnected.");
        addLog("WARNING: Wearable Node BLE connection lost or sleeping.", "warn");
      });

      addLog(`Connecting to GATT Server on ${device.name}...`);
      const server = await device.gatt?.connect();

      if (!server) throw new Error("Failed to connect to GATT server");

      // Give the ESP32 a moment to stabilize its GATT registry before asking for services
      addLog("Authenticating node firmware...");
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 2. Connect to the Service and Characteristic
      addLog("Discovering primary security service...");
      const service = await server.getPrimaryService('4fafc201-1fb5-459e-8fcc-c5c9c331914b');

      addLog("Retrieving SOS Characteristic stream...");
      const characteristic = await service.getCharacteristic('beb5483e-36e1-4688-b7f5-ea07361b26a8');

      // 3. Start listening for the microphone triggers
      await characteristic.startNotifications();

      characteristic.addEventListener('characteristicvaluechanged', (event: any) => {
        const dataView = event.target.value;
        const byteLength = dataView.byteLength;

        // Log raw hex bytes for hardware-level debugging
        const hexArray = [];
        for (let i = 0; i < byteLength; i++) {
          hexArray.push(dataView.getUint8(i).toString(16).padStart(2, '0'));
        }
        console.log(`[BLE RAW HEX] Length: ${byteLength} | Hex: ${hexArray.join(' ')}`);

        // Attempt text decoding
        const rawValue = new TextDecoder().decode(dataView);
        console.log("[BLE TEXT CHUNK]:", rawValue);

        // Aggressive normalization
        const normalized = rawValue.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase();

        // If we get *any* valid signal or trigger word from the ESP32 on this specific UUID, consider it a positive ping.
        // Some ESP32s send trailing null bytes (\x00) or weird encodings when triggering.
        if (
          normalized.includes("SOS") ||
          normalized.includes("TRIGGER") ||
          hexArray.length > 0 // FALLBACK: If the loud noise triggers *any* BLE transmission on this characteristic, trigger the alarm.
        ) {
          addLog("⚠️ CRITICAL: ACOUSTIC THREAT DETECTED FROM WEARABLE!", "error");

          // Trigger the emergency protocol
          handleSOSOverride();
        }
      });

      // 4. Update the UI
      setIsBleConnected(true);
      addLog(`SUCCESS: Wearable Node [${device.name}] Linked & Armed`);

    } catch (error: any) {
      console.error(error);
      setBleError("BLE Connection Failed or Cancelled. Check if device is powered on.");
      addLog("ERROR: BLE Connection Failed or Cancelled. Check if device is powered on.", "error");
    }
  };

  // --- Simulated Drone Telemetry Effect ---
  const launchTelemetrySimulation = () => {
    setDroneTelemetry(prev => ({ ...prev, status: 'DEPLOYED' }));
    let alt = 0;
    telemetryIntervalRef.current = setInterval(() => {
      setDroneTelemetry(prev => {
        if (prev.battery <= 5) return prev; // Avoid going negative blindly
        alt = alt < 120 ? alt + 15 : alt;
        return {
          ...prev,
          altitude: alt + Math.floor(Math.random() * 5),
          battery: prev.battery - 0.1,
          status: 'IN TRANSIT'
        };
      });
    }, 2000);
  };

  const handleSOSOverride = async () => {
    setIsCriticalAlert(true);
    addLog("CRITICAL: Manual SOS Override Initiated!");

    if (isCloudLinked) {
      addLog('Transmitting SOS to Cloud Uplink...', 'warn');
      try {
        const response = await fetch(FIREBASE_URL, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify("LAUNCH")
        });
        if (response.ok) {
          addLog("CRITICAL: SOS Triggered! Cloud command sent to Drone.", "success");
        } else {
          addLog("ERROR: Cloud uplink failed to transmit launch command.", "error");
        }
      } catch (error: any) {
        addLog(`ERROR: Network failure communicating with Cloud. ${error.message || ''}`, "error");
      }
    } else {
      addLog('Cloud Uplink not connected. Simulating virtual LAUNCH command.', 'error');
    }

    launchTelemetrySimulation();

    // Fire SMS Dispatch Immediately (do not block waiting for location)
    addLog("Transmitting coordinates to emergency dispatch via SMS...");

    // Attempt to get accurate position, but send default coordinates if it fails/times out
    let lat = 0;
    let lon = 0;

    const dispatchSMS = async (latitude: number, longitude: number) => {
      try {
        const res = await fetch('/api/sos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude, longitude, messageType: 'SOS' })
        });
        const data = await res.json();
        if (data.success) {
          addLog("SUCCESS: SMS Dispatch Confirmed.");
        } else {
          addLog(`ERROR: SMS Dispatch Failed - ${data.error || 'Unknown Backend Error'}`, "error");
        }
      } catch (err: any) {
        addLog(`ERROR: Failed to reach SMS uplink. (${err.message || 'Network error'})`, 'error');
      }
    };

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          lat = position.coords.latitude;
          lon = position.coords.longitude;
          addLog(`Target Locked - Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`);
          dispatchSMS(lat, lon);
        },
        () => {
          addLog("WARNING: GPS Denied or Timeout. Sending last known fallback location.", "warn");
          dispatchSMS(lat, lon); // Send 0,0 if location fails to ensure help still comes
        },
        { timeout: 5000 } // Don't hang forever
      );
    } else {
      addLog("WARNING: Geolocation not supported. Sending null location.", "warn");
      dispatchSMS(lat, lon);
    }
  };

  const resetAlert = () => {
    setIsCriticalAlert(false);
    if (telemetryIntervalRef.current) clearInterval(telemetryIntervalRef.current);
    setDroneTelemetry({ battery: 100, altitude: 0, status: 'STNDBY' });
    addLog('System alert state manually reset. Returning to standard monitoring.', 'info');
  };

  const handleAeroEscort = async () => {
    if (!destination.trim()) {
      addLog('Escort deployment failed: Destination is required.', 'error');
      return;
    }

    setIsDeploying(true);
    addLog(`Initiating PRE-EMPTIVE AERO-ESCORT sequence to: ${destination}`, 'info');

    if (isCloudLinked) {
      try {
        await fetch(FIREBASE_URL, { method: "PUT", body: JSON.stringify("LAUNCH") });
        addLog(`Drone deployed via Cloud for illuminated escort to [${destination}].`, 'success');
      } catch (e: any) {
        addLog(`Failed to trigger Drone via Cloud Uplink. ${e.message || ''}`, 'error');
      }
    } else {
      addLog('Cloud Uplink not connected! Simulation mode: Escort deployed virtually.', 'warn');
    }

    launchTelemetrySimulation();
    setDestination('');
    setIsDeploying(false);
  };

  const clearConsole = () => {
    setLogs([]);
    addLog('System operations console cleared.', 'success');
  };

  return (
    <div className={`min-h-screen transition-colors duration-1000 overflow-hidden relative ${isCriticalAlert ? 'pulse-border-red bg-pulse-red' : ''}`}>

      {/* Background Patrolling Drone */}
      <FlyingDroneSequence />

      {/* Navbar */}
      <motion.nav
        variants={navVariants}
        initial="hidden"
        animate="visible"
        className="glass-panel border-t-0 border-x-0 border-b border-white/5 bg-[#020617]/80 backdrop-blur-3xl px-8 py-5 flex items-center justify-between sticky top-0 z-50 shadow-2xl"
      >
        <div className="flex items-center gap-4">
          <motion.div
            initial={{ rotate: -90, scale: 0 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: "spring", duration: 1, delay: 0.3 }}
            className="relative"
          >
            <div className="absolute inset-0 border border-cyan-500/30 rounded-full animate-radar pointer-events-none" />
            <ShieldAlert className={`w-9 h-9 relative z-10 ${isCriticalAlert ? 'text-red-500 animate-pulse' : 'text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]'}`} />
          </motion.div>
          <div className="flex flex-col">
            <h1 className="text-3xl font-black tracking-[0.25em] text-white leading-none glitch-text">
              AEGIS<span className="text-cyan-500/80 font-light glitch-text">LINK</span>
            </h1>
            <span className="text-[10px] text-slate-500 font-mono tracking-widest uppercase mt-1">Autonomous Aerial Escort System</span>
          </div>
        </div>
        <div className="flex items-center gap-6 text-sm font-medium">
          <div className="flex items-center gap-3 bg-white/5 px-4 py-2 rounded-full border border-white/10 shadow-inner">
            <span className="text-slate-400 font-mono text-xs uppercase tracking-widest">Sys Status</span>
            <div className="w-px h-4 bg-white/10" />
            {isCriticalAlert ? (
              <motion.span
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
                className="text-red-500 text-glow-red font-bold tracking-widest text-xs"
              >
                DEFCON 1
              </motion.span>
            ) : (
              <span className="text-cyan-400 text-glow-cyan font-semibold tracking-widest text-xs">
                NOMINAL
              </span>
            )}
          </div>
        </div>
      </motion.nav>

      {/* Main Grid */}
      <motion.main
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-7xl mx-auto p-6 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10"
      >

        {/* Left Column: Telemetry & Connections */}
        <motion.div variants={itemVariants} className="lg:col-span-5 space-y-6">
          <motion.div
            animate={{ opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          >
            <SectionTitle title="Hardware Telemetry" icon={<Cpu className="w-5 h-5 text-cyan-400" />} />
          </motion.div>

          <motion.div
            className="glass-panel p-6 space-y-6 relative"
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          >
            <div className="hud-corner-tl" /><div className="hud-corner-tr" /><div className="hud-corner-bl" /><div className="hud-corner-br" />

            {/* Cloud Uplink Server */}
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="relative w-6 h-6 flex items-center justify-center">
                    <Cloud className="w-5 h-5 text-slate-400 relative z-10" />
                    <div className="absolute inset-0 border border-slate-700 rounded-full animate-reticle pointer-events-none" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-200">Cloud Uplink</h3>
                    <p className="text-xs text-slate-500">Firebase RTDB • WPA3</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    {isCloudLinked && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>}
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${isCloudLinked ? 'bg-cyan-500 glow-cyan' : 'bg-slate-600'}`}></span>
                  </span>
                  <span className="text-xs uppercase tracking-wider text-slate-400">
                    {isCloudLinked ? 'Linked' : 'Offline'}
                  </span>
                </div>
              </div>
              <motion.button
                whileHover={!isCloudLinked ? { scale: 1.02, backgroundColor: 'rgba(30,30,40,0.8)' } : {}}
                whileTap={!isCloudLinked ? { scale: 0.98 } : {}}
                onClick={handleConnectCloud}
                disabled={isCloudLinked}
                className={`w-full py-4 px-4 rounded-xl transition-all border disabled:opacity-80 disabled:cursor-not-allowed flex items-center justify-center gap-3 text-sm font-semibold tracking-wide shadow-lg ${isCloudLinked
                  ? 'bg-gradient-to-r from-cyan-900/40 to-blue-900/40 border-cyan-500/50 text-cyan-300 drop-shadow-[0_0_15px_rgba(34,211,238,0.2)]'
                  : 'bg-slate-800/80 border-white/10 text-slate-200 hover:border-white/20'
                  }`}
              >
                {isCloudLinked ? <CheckCircle2 className="w-5 h-5 text-cyan-400" /> : <Cloud className="w-5 h-5 text-slate-400" />}
                {isCloudLinked ? 'Cloud Uplink Active' : 'Initialize Cloud Uplink (WPA3)'}
              </motion.button>
            </div>

            <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-700 to-transparent"></div>

            {/* Wearable Node (Web Bluetooth) */}
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="relative w-6 h-6 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-slate-400 relative z-10" />
                    <div className="absolute inset-0 border border-slate-700 rounded-full animate-reticle-reverse pointer-events-none" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-200">Wearable Node</h3>
                    <p className="text-xs text-slate-500">Web Bluetooth • HC-05</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    {isBleConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>}
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${isBleConnected ? 'bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.6)]' : 'bg-slate-600'}`}></span>
                  </span>
                  <span className="text-xs uppercase tracking-wider text-slate-400">
                    {isBleConnected ? 'Listening' : 'Offline'}
                  </span>
                </div>
              </div>
              <motion.button
                whileHover={!isBleConnected ? { scale: 1.02, backgroundColor: 'rgba(30,30,40,0.8)' } : {}}
                whileTap={!isBleConnected ? { scale: 0.98 } : {}}
                onClick={connectWearable}
                disabled={isBleConnected}
                className={`w-full py-4 px-4 rounded-xl transition-all border disabled:opacity-80 disabled:cursor-not-allowed flex items-center justify-center gap-3 text-sm font-semibold tracking-wide shadow-lg ${isBleConnected
                  ? 'bg-gradient-to-r from-blue-900/40 to-indigo-900/40 border-blue-500/50 text-blue-300 drop-shadow-[0_0_15px_rgba(59,130,246,0.2)]'
                  : 'bg-slate-800/80 border-white/10 text-slate-200 hover:border-white/20'
                  }`}
              >
                {isBleConnected ? <CheckCircle2 className="w-5 h-5 text-blue-400" /> : <Radio className="w-5 h-5 text-slate-400" />}
                {isBleConnected ? 'Wearable Link Active' : 'Initialize Wearable Node (BLE)'}
              </motion.button>
              {bleError && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs text-center border border-red-900/50 bg-red-900/20 py-2 rounded-lg">
                  {bleError}
                </motion.p>
              )}
            </div>

            <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-700 to-transparent"></div>

            {/* Drone Link Status */}
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="relative w-6 h-6 flex items-center justify-center">
                    <Navigation className={`w-5 h-5 relative z-10 ${droneTelemetry.status === 'STNDBY' ? 'text-slate-400' : 'text-cyan-400 glow-cyan animate-pulse'}`} />
                    <div className={`absolute -inset-1 border border-dashed rounded-full pointer-events-none ${droneTelemetry.status === 'STNDBY' ? 'border-slate-700 animate-radar' : 'border-cyan-500 animate-spin'}`} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-200">Aegis Interceptor</h3>
                    <p className="text-xs text-slate-500">Aerial Telemetry Link</p>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className={`text-xs font-bold tracking-wider ${droneTelemetry.status === 'STNDBY' ? 'text-slate-400' : 'text-cyan-400 text-glow-cyan'}`}>
                    {droneTelemetry.status}
                  </span>
                  <div className="text-[10px] text-slate-500 font-mono mt-1">
                    BATT: {droneTelemetry.battery.toFixed(1)}% | ALT: {droneTelemetry.altitude}m
                  </div>
                </div>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1 shadow-inner">
                <motion.div
                  className={`h-full ${droneTelemetry.battery < 20 ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]' : droneTelemetry.status === 'STNDBY' ? 'bg-slate-600' : 'bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.8)]'} transition-all duration-1000 relative`}
                  style={{ width: `${Math.max(0, Math.min(100, droneTelemetry.battery))}%` }}
                >
                  {droneTelemetry.status !== 'STNDBY' && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent w-full h-full animate-[shimmer_1.5s_infinite]" />
                  )}
                </motion.div>
              </div>
            </div>

          </motion.div>
        </motion.div>

        {/* Right Column: Action Panels */}
        <motion.div
          variants={itemVariants}
          className="lg:col-span-7 space-y-6"
        >
          <motion.div
            animate={{ opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 4, delay: 1, repeat: Infinity, ease: "easeInOut" }}
          >
            <SectionTitle title="Action Panels" icon={<Target className="w-5 h-5 text-red-500 animate-pulse" />} />
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Emergency Override */}
            <motion.div
              animate={isCriticalAlert ? { scale: [1, 1.02, 1], y: [0, -2, 0] } : { y: [0, -8, 0] }}
              transition={{ duration: isCriticalAlert ? 0.5 : 7, repeat: Infinity, ease: "easeInOut" }}
              whileHover={{ scale: 1.03, transition: { duration: 0.2 } }}
              className={`glass-panel p-6 flex flex-col justify-between space-y-6 relative ${isCriticalAlert ? 'border-red-500 glow-red' : 'border-slate-800'}`}
            >
              <div className="hud-corner-tl" /><div className="hud-corner-tr" /><div className="hud-corner-bl" /><div className="hud-corner-br" />
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <Flame className={`w-6 h-6 ${isCriticalAlert ? 'text-red-500 animate-pulse' : 'text-slate-400'}`} />
                  <h3 className="font-semibold text-slate-200">Manual Override</h3>
                </div>
                <p className="text-sm text-slate-400">Trigger standard emergency protocols instantly. Bypasses wearable node.</p>
              </div>

              <motion.button
                whileHover={!isCriticalAlert ? { scale: 1.02 } : {}}
                whileTap={{ scale: 0.98 }}
                onClick={isCriticalAlert ? resetAlert : handleSOSOverride}
                className={`w-full py-5 rounded-xl font-black tracking-widest uppercase flex items-center justify-center gap-3 relative overflow-hidden transition-shadow duration-300
                  ${isCriticalAlert
                    ? 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white'
                    : 'bg-gradient-to-br from-red-600 via-rose-600 to-red-700 text-white border border-red-500/50 animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.7)] hover:shadow-[0_0_30px_rgba(239,68,68,1)]'
                  }
                `}
              >
                {!isCriticalAlert && (
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-[200%] hover:animate-[shimmer_2s_infinite]" />
                )}
                <AlertTriangle className={`w-6 h-6 ${!isCriticalAlert && 'hover:animate-bounce max-w-none'}`} />
                {isCriticalAlert ? 'Deactivate Alarm' : 'Trigger SOS Override'}
              </motion.button>
            </motion.div>

            {/* Pre-emptive Escort */}
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 8, delay: 0.5, repeat: Infinity, ease: "easeInOut" }}
              whileHover={{ scale: 1.03, transition: { duration: 0.2 } }}
              className="glass-panel p-6 flex flex-col justify-between space-y-6 relative overflow-hidden group"
            >
              <div className="hud-corner-tl" /><div className="hud-corner-tr" /><div className="hud-corner-bl" /><div className="hud-corner-br" />
              <motion.div
                animate={{ rotate: 360, scale: [1, 1.2, 1] }}
                transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                className="absolute -top-10 -right-10 w-48 h-48 bg-cyan-600/10 rounded-full blur-3xl group-hover:bg-cyan-500/20"
              />

              <div>
                <div className="flex items-center gap-3 mb-2">
                  <Navigation className="w-6 h-6 text-cyan-400" />
                  <h3 className="font-semibold text-slate-200">Aero-Escort Deployment</h3>
                </div>
                <p className="text-sm text-slate-400">Request a proactive drone escort to a safe location.</p>
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="Enter destination (e.g. Girls Hostel)"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                  />
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleAeroEscort}
                  disabled={isDeploying || !destination.trim()}
                  className="w-full py-4 rounded-xl bg-gradient-to-br from-cyan-600 via-cyan-500 to-blue-600 text-white font-bold tracking-[0.1em] transition-all hover:shadow-[0_0_30px_rgba(6,182,212,0.4)] disabled:opacity-50 disabled:cursor-not-allowed border border-cyan-400/30 flex items-center justify-center gap-3 uppercase text-sm relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-[200%] group-hover:animate-[shimmer_2s_infinite]" />
                  <Send className="w-5 h-5 group-hover:-translate-y-1 group-hover:translate-x-1 transition-transform" />
                  Initiate Aero-Escort
                </motion.button>
              </div>
            </motion.div>

          </div>
        </motion.div>

      </motion.main>

      {/* Console Log Terminal */}
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", damping: 15, delay: 0.5 }}
        className="max-w-7xl mx-auto px-6 md:px-8 w-full pb-8 pt-4"
      >
        <motion.div
          animate={{ boxShadow: ['0 25px 50px -12px rgba(6,182,212,0.1)', '0 25px 50px -12px rgba(6,182,212,0.3)', '0 25px 50px -12px rgba(6,182,212,0.1)'] }}
          transition={{ duration: 4, repeat: Infinity }}
          className="glass-panel border-t-2 border-cyan-500/40 rounded-2xl overflow-hidden flex flex-col h-64 relative"
        >
          <div className="hud-corner-tl" /><div className="hud-corner-tr" /><div className="hud-corner-bl" /><div className="hud-corner-br" />
          <div className="bg-[#020617]/90 border-b border-cyan-500/30 px-4 py-3 flex items-center justify-between relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-500/10 to-transparent w-[200%] animate-[shimmer_3s_infinite]" />
            <div className="flex items-center gap-3">
              <Terminal className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-mono text-slate-400 tracking-widest uppercase">System Operations Console</span>
            </div>
            <button
              onClick={clearConsole}
              className="px-3 py-1 bg-slate-800/80 hover:bg-slate-700 rounded text-[10px] uppercase font-bold tracking-widest text-slate-400 hover:text-white transition-all border border-slate-700 hover:border-slate-500 cursor-pointer"
            >
              Clear Logs
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 font-mono text-sm scanline bg-[#0a0f18]/90 backdrop-blur-3xl h-40 max-h-48 text-cyan-400">
            <AnimatePresence>
              {logs.map((log) => (
                <motion.div
                  initial={{ opacity: 0, x: -30, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  key={log.id || Math.random().toString()}
                  className="mb-2 flex gap-3 relative group"
                >
                  <div className="absolute -left-2 top-2 w-1 h-1 rounded-full bg-cyan-400 group-hover:animate-ping" />
                  <span className="shrink-0 font-bold opacity-70">[{log.time}] &gt;</span>
                  <span className={`break-all ${log.type === 'error' ? 'text-red-400 glitch-text' : log.type === 'warn' ? 'text-amber-400' : 'text-cyan-300'}`}>{log.message}</span>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={consoleEndRef} />
            {logs.length === 0 && (
              <div className="text-slate-600 flex items-center justify-center h-full italic">
                Awaiting telemetry streams...
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>

    </div>
  );
}

const FlyingDroneSequence = () => {
  return (
    <motion.div
      className="fixed z-0 pointer-events-none mix-blend-screen opacity-80"
      animate={{
        x: ['-50vw', '110vw', '70vw', '-50vw'],
        y: ['10vh', '70vh', '-10vh', '10vh'],
        rotateZ: [25, -15, 30, 25],
        scale: [1, 2.8, 0.7, 1], // Massive scale changes to simulate low flybys
      }}
      transition={{
        duration: 45,
        ease: "easeInOut",
        repeat: Infinity,
        times: [0, 0.33, 0.66, 1]
      }}
    >
      <img
        src="/drone.png"
        alt="Aegis Drone Patrol"
        className="w-[450px] h-auto drop-shadow-[0_0_30px_rgba(6,182,212,0.9)]"
        style={{ filter: "contrast(1.2)" }}
      />
    </motion.div>
  );
}

function SectionTitle({ title, icon }: { title: string, icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b-2 border-slate-800/60 pb-3">
      <div className="p-2 bg-slate-800/50 rounded-lg border border-white/5 shadow-inner">
        {icon}
      </div>
      <h2 className="text-sm font-bold text-slate-300 uppercase tracking-[0.2em]">{title}</h2>
    </div>
  );
}
