/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useRef, useCallback } from 'react';

export function useWebBluetooth(onEmergencyTrigger: () => void) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serverRef = useRef<any>(null);
  const charRef = useRef<any>(null);

  const connect = useCallback(async () => {
    try {
      if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
        throw new Error('Web Bluetooth API is not supported in this browser.');
      }

      const n: any = navigator;
      
      // We use a common BLE UART service UUID (often HM-10/AT-09 modules are used in place of HC-05 for Web Bluetooth)
      const UART_SERVICE = '0000ffe0-0000-1000-8000-00805f9b34fb';
      const UART_CHAR = '0000ffe1-0000-1000-8000-00805f9b34fb';

      const device = await n.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [UART_SERVICE]
      });

      const server = await device.gatt.connect();
      serverRef.current = server;
      
      const service = await server.getPrimaryService(UART_SERVICE);
      const characteristic = await service.getCharacteristic(UART_CHAR);
      charRef.current = characteristic;

      await characteristic.startNotifications();
      
      let incomingBuffer = '';
      characteristic.addEventListener('characteristicvaluechanged', (event: any) => {
        const value = event.target.value;
        const decoder = new TextDecoder('utf-8');
        const text = decoder.decode(value);
        incomingBuffer += text;

        if (incomingBuffer.includes('SOS_TRIGGER')) {
          incomingBuffer = ''; // Clear buffer after triggering
          onEmergencyTrigger();
        }
        
        // Keep buffer from growing indefinitely
        if (incomingBuffer.length > 100) {
           incomingBuffer = incomingBuffer.slice(-50);
        }
      });
      
      device.addEventListener('gattserverdisconnected', () => {
        setIsConnected(false);
        serverRef.current = null;
        charRef.current = null;
      });

      setIsConnected(true);
      setError(null);
    } catch (err: any) {
      console.error('Failed to connect to Wearable Node:', err);
      setError(err.message || 'Failed to connect via Web Bluetooth');
      setIsConnected(false);
    }
  }, [onEmergencyTrigger]);
  
  const disconnect = useCallback(() => {
     if (serverRef.current) {
        serverRef.current.disconnect();
        setIsConnected(false);
     }
  }, []);

  return { connect, disconnect, isConnected, error };
}
