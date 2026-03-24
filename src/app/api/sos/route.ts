/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER;
const securityPhoneNumber = process.env.SECURITY_PHONE_NUMBER;

let client: twilio.Twilio | null = null;
if (accountSid && authToken && accountSid.startsWith('AC')) {
  client = twilio(accountSid, authToken);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { latitude, longitude, messageType = 'SOS' } = body;

    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      return NextResponse.json(
        { success: false, error: 'Latitude and longitude are required.' },
        { status: 400 }
      );
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json(
        { success: false, error: 'Invalid coordinate format. Latitude must be between -90 and 90, Longitude between -180 and 180.' },
        { status: 400 }
      );
    }

    const messageBody = `🚨 AEGIS SYSTEM ALERT: ${messageType} triggered. Live Location: https://www.google.com/search?q=https://www.google.com/maps/search/%3Fapi%3D1%26query%3D${lat},${lng}`;

    if (!client || !fromNumber || !securityPhoneNumber) {
      throw new Error(`Twilio is not fully configured. Missing: ${!client ? 'API Client' : ''} ${!fromNumber ? 'From Number' : ''} ${!securityPhoneNumber ? 'Security Number' : ''}`);
    }

    const message = await client.messages.create({
      body: messageBody,
      from: fromNumber,
      to: securityPhoneNumber,
    });

    console.log(`SOS SMS sent successfully. Message SID: ${message.sid}`);
    return NextResponse.json({ success: true, messageId: message.sid });

  } catch (error: any) {
    console.error('Error sending SOS SMS:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to send SMS' },
      { status: 500 }
    );
  }
}
