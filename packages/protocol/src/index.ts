import { z } from 'zod';

export const gameIds = ['gomoku', 'quoridor', 'twenty-four'] as const;
export type GameId = (typeof gameIds)[number];
export type PlayerSeat = 0 | 1;
export type RoomStatus = 'waiting' | 'active' | 'paused' | 'finished';

const commandId = z.string().uuid();
const roomCode = z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
const roomId = z.string().uuid();
// Transport limit is deliberately wider than 16 UTF-16 code units because a
// single visible grapheme (for example a family emoji) can contain many code
// points. The server performs the authoritative 1–16 grapheme validation.
const nickname = z.string().trim().min(1).max(256);

export const createRoomSchema = z.object({
  commandId,
  nickname,
  gameId: z.enum(gameIds),
}).strict();

export const joinRoomSchema = z.object({ commandId, nickname, code: roomCode }).strict();
export const readyRoomSchema = z.object({ commandId, roomId, ready: z.boolean() }).strict();
export const leaveRoomSchema = z.object({ commandId, roomId }).strict();
export const rematchSchema = z.object({ commandId, roomId, requested: z.boolean() }).strict();
export const roomMessageSchema = z.object({
  messageId: z.string().uuid(),
  roomId,
  // The server performs the authoritative visible-grapheme and safety checks.
  content: z.string().min(1).max(2_000),
}).strict();
const transportActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('place'), row: z.number().int(), col: z.number().int() }).strict(),
  z.object({ type: z.literal('move'), row: z.number().int(), col: z.number().int() }).strict(),
  z.object({ type: z.literal('placeWall'), row: z.number().int(), col: z.number().int(), orientation: z.enum(['H', 'V']) }).strict(),
  z.object({ type: z.literal('submit'), expression: z.string().max(128) }).strict(),
  z.object({ type: z.literal('resign') }).strict(),
]);
export const gameActionSchema = z.object({
  actionId: z.string().uuid(),
  roomId,
  expectedVersion: z.number().int().nonnegative(),
  // Keep the transport shape shallow and bounded before the server hashes an
  // idempotency request. Game-specific legality is still checked by game-core.
  action: transportActionSchema,
}).strict();

export type CreateRoomCommand = z.infer<typeof createRoomSchema>;
export type JoinRoomCommand = z.infer<typeof joinRoomSchema>;
export type ReadyRoomCommand = z.infer<typeof readyRoomSchema>;
export type LeaveRoomCommand = z.infer<typeof leaveRoomSchema>;
export type RematchCommand = z.infer<typeof rematchSchema>;
export type RoomMessageCommand = z.infer<typeof roomMessageSchema>;
export type GameActionCommand = z.infer<typeof gameActionSchema>;

export type RoomMemberView = {
  seat: PlayerSeat;
  nickname: string;
  ready: boolean;
  rematchReady: boolean;
  online: boolean;
  disconnectedAtMs: number | null;
  disconnectDeadlineMs: number | null;
};

export type RoomSnapshot = {
  roomId: string;
  code: string;
  gameId: GameId;
  status: RoomStatus;
  version: number;
  hostSeat: PlayerSeat;
  mySeat: PlayerSeat;
  members: RoomMemberView[];
  pauseReason: 'disconnect' | 'restart' | null;
  restartDeadlineMs: number | null;
  serverTimeMs: number;
};

export type GameSnapshot = {
  roomId: string;
  gameId: GameId;
  version: number;
  status: RoomStatus;
  mySeat: PlayerSeat;
  view: unknown;
  serverTimeMs: number;
};

export type RoomMessage = {
  messageId: string;
  roomId: string;
  seat: PlayerSeat;
  nickname: string;
  content: string;
  sentAtMs: number;
};

export type CommandError = {
  commandId: string | null;
  event: string;
  code: string;
  message: string;
  retryable: boolean;
  currentVersion?: number;
};

export type CommandAck =
  | { ok: true; roomId?: string; code?: string; version?: number }
  | { ok: false; error: CommandError };

export type ServerToClientEvents = {
  'room:snapshot': (snapshot: RoomSnapshot) => void;
  'game:snapshot': (snapshot: GameSnapshot) => void;
  'presence:update': (snapshot: RoomSnapshot) => void;
  'room:message': (message: RoomMessage) => void;
  'room:message:history': (payload: { roomId: string; messages: RoomMessage[] }) => void;
  'command:error': (error: CommandError) => void;
};

export type ClientToServerEvents = {
  'room:create': (command: CreateRoomCommand, ack: (result: CommandAck) => void) => void;
  'room:join': (command: JoinRoomCommand, ack: (result: CommandAck) => void) => void;
  'room:ready': (command: ReadyRoomCommand, ack: (result: CommandAck) => void) => void;
  'room:leave': (command: LeaveRoomCommand, ack: (result: CommandAck) => void) => void;
  'game:action': (command: GameActionCommand, ack: (result: CommandAck) => void) => void;
  'game:rematch': (command: RematchCommand, ack: (result: CommandAck) => void) => void;
  'room:message:send': (command: RoomMessageCommand, ack: (result: CommandAck) => void) => void;
};

export type SessionResponse = {
  sessionId: string;
  reconnectableRoomCode: string | null;
};
