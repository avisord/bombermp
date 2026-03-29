import mongoose from 'mongoose';

let connected = false;

export async function connectDB(): Promise<void> {
  if (connected) return;
  const uri = process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/bombermp';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
  connected = true;
  console.log('[db] connected');
}

export async function disconnectDB(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
  console.log('[db] disconnected');
}
