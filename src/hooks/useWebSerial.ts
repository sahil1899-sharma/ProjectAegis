/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useRef, useCallback } from 'react';

export function useWebSerial() {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const portRef = useRef<any>(null); // Using any temporarily for SerialPort

  const connect = useCallback(async () => {
    try {
      if (typeof navigator === 'undefined' || !('serial' in navigator)) {
        throw new Error('Web Serial API is not supported in this browser.');
      }

      // Explicitly using any since standard TS doesn't include Web Serial API by default
      const n: any = navigator;
      const port = await n.serial.requestPort();
      await port.open({ baudRate: 115200 });
      
      portRef.current = port;
      setIsConnected(true);
      setError(null);
      
      // Handle disconnect event from hardware
      port.addEventListener('disconnect', () => {
        setIsConnected(false);
        portRef.current = null;
      });

    } catch (err: any) {
      console.error('Failed to connect to Base Station:', err);
      setError(err.message || 'Failed to connect');
      setIsConnected(false);
    }
  }, []);

  const triggerDroneLaunch = useCallback(async () => {
    try {
      if (!portRef.current || !portRef.current.writable) {
        throw new Error('Not connected to Base Station');
      }

      const writer = portRef.current.writable.getWriter();
      const data = new TextEncoder().encode('LAUNCH\n');
      
      await writer.write(data);
      writer.releaseLock();
      
      console.log('Drone launch signal sent over USB Serial.');
    } catch (err: any) {
      console.error('Failed to send launch signal:', err);
      setError(err.message || 'Failed to send signal');
    }
  }, []);

  return { connect, triggerDroneLaunch, isConnected, error };
}
