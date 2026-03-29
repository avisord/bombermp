import { Schema, model } from 'mongoose';

interface IGameSession {
  roomId: string;
  startedAt: Date;
  endedAt: Date | null;
  winnerId: string | null;
  playerIds: string[];
}

const GameSessionSchema = new Schema<IGameSession>({
  roomId: { type: String, required: true, index: true },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
  winnerId: { type: String, default: null },
  playerIds: { type: [String], required: true },
});

export const GameSessionModel = model<IGameSession>('GameSession', GameSessionSchema);
