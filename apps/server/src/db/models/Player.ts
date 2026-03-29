import { Schema, model } from 'mongoose';

interface IPlayer {
  _id: string;
  displayName: string;
  createdAt: Date;
  lastSeen: Date;
}

const PlayerSchema = new Schema<IPlayer>({
  _id: { type: String, required: true },
  displayName: { type: String, required: true, trim: true, maxlength: 32 },
  createdAt: { type: Date, default: () => new Date() },
  lastSeen: { type: Date, default: () => new Date() },
});

export const PlayerModel = model<IPlayer>('Player', PlayerSchema);
