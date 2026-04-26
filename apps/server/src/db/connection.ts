import mongoose from 'mongoose';

// MongoDB is opt-in. The server starts and runs gameplay fine without it —
// persistence is only enabled when MONGODB_URI is set. When disabled, write
// sites short-circuit via `isDbEnabled()` and never touch the driver.

let connected = false;
let enabled = false;

export function isDbEnabled(): boolean {
  return enabled;
}

export async function connectDB(): Promise<void> {
  if (connected) return;
  const uri = process.env['MONGODB_URI'];
  if (!uri) {
    console.log('[db] disabled (set MONGODB_URI to enable persistence)');
    return;
  }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
    connected = true;
    enabled = true;
    console.log('[db] connected');
  } catch (err) {
    enabled = false;
    throw err;
  }
}

export async function disconnectDB(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
  enabled = false;
  console.log('[db] disconnected');
}
