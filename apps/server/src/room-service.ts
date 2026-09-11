import { randomInt, randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io';
import type { Server } from 'socket.io';
import {
  drawSolvableCards,
  expireTwentyFourRound,
  gomokuDefinition,
  otherPlayer,
  requireBinaryPlayer,
  quoridorDefinition,
  splendorDefinition,
  texasHoldemDefinition,
  applyTexasHoldemAction,
  abortSplendorState,
  type PokerSeat,
  startNextTwentyFourRound,
  twentyFourDefinition,
  type ApplyResult,
  type GameResult,
  type GomokuState,
  type Player,
  type QuoridorState,
  type SplendorSeat,
  type SplendorState,
  type SplendorResult,
  type TwentyFourState,
  type TexasHoldemResult,
  type TexasHoldemState,
} from '@gamehall/game-core';
import type {
  ClientToServerEvents,
  CommandAck,
  CommandError,
  CreateRoomCommand,
  GameActionCommand,
  GameId,
  GameSnapshot,
  JoinRoomCommand,
  LeaveRoomCommand,
  PlayerSeat,
  ReadyRoomCommand,
  ReopenRoomCommand,
  RematchCommand,
  RoomMessage,
  RoomMessageCommand,
  RoomSnapshot,
  ServerToClientEvents,
  StartRoomCommand,
} from '@gamehall/protocol';
import type { GameHallDatabase } from './database';
import { normalizeNickname, normalizeRoomMessage, requestHash } from './security';

type InterServerEvents = Record<string, never>;
export type SocketData = { sessionId: string };
export type GameHallIo = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type GameHallSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

type RoomRow = {
  id: string;
  code: string;
  game_id: GameId;
  status: 'waiting' | 'active' | 'paused' | 'finished';
  version: number;
  round_no: number;
  state_schema_version: number;
  state_json: string | null;
  pause_reason: 'disconnect' | 'restart' | null;
  paused_remaining_ms: number | null;
  restart_deadline_ms: number | null;
  next_round_at_ms: number | null;
  finish_reason: string | null;
  host_seat: PlayerSeat;
  created_at_ms: number;
  last_activity_ms: number;
  cleanup_at_ms: number;
};

type MemberRow = {
  room_id: string;
  seat: PlayerSeat;
  session_id: string;
  nickname: string;
  nickname_key: string;
  ready: number;
  rematch_ready: number;
  joined_at_ms: number;
  disconnected_at_ms: number | null;
  disconnect_deadline_ms: number | null;
  disconnect_order: number | null;
  restart_rejoined_at_ms: number | null;
};

type GameState = GomokuState | QuoridorState | TwentyFourState | SplendorState | TexasHoldemState;

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const WAITING_TTL_MS = 2 * 60 * 60_000;
const FINISHED_TTL_MS = 30 * 60_000;
const DISCONNECT_GRACE_MS = 60_000;
const RESTART_GRACE_MS = 10 * 60_000;
const REVEAL_MS = 4_000;

function errorAck(event: string, commandId: string | null, code: string, message: string, retryable = false, currentVersion?: number): CommandAck {
  const error: CommandError = { event, commandId, code, message, retryable };
  if (currentVersion !== undefined) error.currentVersion = currentVersion;
  return { ok: false, error };
}

function gameRandom(): number {
  return randomInt(0x1_0000_0000) / 0x1_0000_0000;
}

function createRoomCode(): string {
  let result = '';
  for (let index = 0; index < 6; index += 1) result += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return result;
}

function parseGameState(room: RoomRow): GameState | null {
  if (!room.state_json) return null;
  const currentSchemaVersion = gameStateSchemaVersion(room.game_id);
  if (room.state_schema_version > currentSchemaVersion) throw new Error(`unsupported ${room.game_id} state schema`);
  if (room.game_id === 'gomoku') return gomokuDefinition.deserialize(room.state_json);
  if (room.game_id === 'quoridor') return quoridorDefinition.deserialize(room.state_json);
  if (room.game_id === 'splendor') return splendorDefinition.deserialize(room.state_json);
  if (room.game_id === 'texas-holdem') return texasHoldemDefinition.deserialize(room.state_json);
  const state = twentyFourDefinition.deserialize(room.state_json);
  if (room.state_schema_version >= 2 || state.phase !== 'finished') return state;
  if (room.finish_reason === 'restart_timeout') return { ...state, winner: null, finishReason: 'restart_timeout' };
  if (room.finish_reason === 'disconnect_forfeit') return { ...state, finishReason: 'disconnect' };
  if (room.finish_reason === 'left_room') return { ...state, finishReason: 'leave' };
  if (state.winner !== null && state.scores[state.winner] < 5) return { ...state, finishReason: 'resign' };
  return state;
}

function gameStateSchemaVersion(gameId: GameId): number {
  if (gameId === 'gomoku') return gomokuDefinition.stateSchemaVersion;
  if (gameId === 'quoridor') return quoridorDefinition.stateSchemaVersion;
  if (gameId === 'splendor') return splendorDefinition.stateSchemaVersion;
  if (gameId === 'texas-holdem') return texasHoldemDefinition.stateSchemaVersion;
  return twentyFourDefinition.stateSchemaVersion;
}

function serializeGameState(state: GameState): string {
  if (state.kind === 'gomoku') return gomokuDefinition.serialize(state);
  if (state.kind === 'quoridor') return quoridorDefinition.serialize(state);
  if (state.kind === 'splendor') return splendorDefinition.serialize(state);
  if (state.kind === 'texas-holdem') return texasHoldemDefinition.serialize(state);
  return twentyFourDefinition.serialize(state);
}

function createInitialGame(gameId: GameId, nowMs: number, role?: Player, seats?: PlayerSeat[]): GameState {
  if (gameId === 'gomoku') return gomokuDefinition.initialize(role ?? randomInt(2) as Player);
  if (gameId === 'quoridor') return quoridorDefinition.initialize(role ?? randomInt(2) as Player);
  if (gameId === 'splendor') {
    const splendorSeats = (seats ?? [0, 1]) as SplendorSeat[];
    return splendorDefinition.initialize({ playerCount: splendorSeats.length as 2 | 3 | 4, seats: splendorSeats, rng: gameRandom });
  }
  if (gameId === 'texas-holdem') {
    return texasHoldemDefinition.initialize({ seats: (seats ?? [0, 1]) as PokerSeat[], rng: gameRandom });
  }
  const round = drawSolvableCards(gameRandom);
  return twentyFourDefinition.initialize({ cards: round.cards, canonicalSolution: round.solution, nowMs });
}

function gameResult(state: GameState): GameResult | SplendorResult | TexasHoldemResult | null {
  if (state.kind === 'gomoku') return gomokuDefinition.result(state);
  if (state.kind === 'quoridor') return quoridorDefinition.result(state);
  if (state.kind === 'splendor') return splendorDefinition.result(state);
  if (state.kind === 'texas-holdem') return texasHoldemDefinition.result(state);
  return twentyFourDefinition.result(state);
}

function viewForPlayer(state: GameState, player: PlayerSeat, nowMs: number, pausedRemainingMs: number | null = null): unknown {
  if (state.kind === 'gomoku') return gomokuDefinition.viewFor(state, requireBinaryPlayer(player), nowMs);
  if (state.kind === 'quoridor') return quoridorDefinition.viewFor(state, requireBinaryPlayer(player), nowMs);
  if (state.kind === 'splendor') return splendorDefinition.viewFor(state, player, nowMs);
  if (state.kind === 'texas-holdem') return texasHoldemDefinition.viewFor(state, player, nowMs);
  const view = twentyFourDefinition.viewFor(state, requireBinaryPlayer(player), nowMs);
  // A paused timed round publishes a synthetic deadline anchored to this
  // snapshot. The client can freeze that server-time anchor until play resumes
  // without exposing a private persistence field in the shared room protocol.
  return pausedRemainingMs !== null && view.phase === 'answering'
    ? { ...view, deadlineAtMs: nowMs + pausedRemainingMs }
    : view;
}

function validateAndAdvance(state: GameState, actor: PlayerSeat, input: unknown, nowMs: number):
  | { ok: true; result: ApplyResult<GameState> }
  | { ok: false; message: string } {
  if (state.kind === 'gomoku') {
    if (actor > 1) return { ok: false, message: '双人游戏不支持此座位' };
    const validation = gomokuDefinition.validateAction(input);
    return validation.ok
      ? { ok: true, result: gomokuDefinition.advance(state, requireBinaryPlayer(actor), validation.action, nowMs) }
      : validation;
  }
  if (state.kind === 'quoridor') {
    if (actor > 1) return { ok: false, message: '双人游戏不支持此座位' };
    const validation = quoridorDefinition.validateAction(input);
    return validation.ok
      ? { ok: true, result: quoridorDefinition.advance(state, requireBinaryPlayer(actor), validation.action, nowMs) }
      : validation;
  }
  if (state.kind === 'splendor') {
    const validation = splendorDefinition.validateAction(input);
    return validation.ok
      ? { ok: true, result: splendorDefinition.advance(state, actor, validation.action, nowMs) }
      : validation;
  }
  if (state.kind === 'texas-holdem') {
    const validation = texasHoldemDefinition.validateAction(input);
    return validation.ok
      ? { ok: true, result: applyTexasHoldemAction(state, actor, validation.action, gameRandom) }
      : validation;
  }
  if (actor > 1) return { ok: false, message: '双人游戏不支持此座位' };
  const validation = twentyFourDefinition.validateAction(input);
  return validation.ok
    ? { ok: true, result: twentyFourDefinition.advance(state, requireBinaryPlayer(actor), validation.action, nowMs) }
    : validation;
}

function finishStateByForfeit(state: GameState, loser: PlayerSeat, reason: 'disconnect' | 'leave'): GameState {
  if (state.kind === 'splendor') return abortSplendorState(state, reason);
  if (state.kind === 'texas-holdem') return { ...state, phase: 'finished', turn: null, result: { type: 'aborted', reason } };
  if (loser > 1) throw new Error('binary game contains invalid seat');
  const winner = otherPlayer(requireBinaryPlayer(loser));
  if (state.kind === 'twenty-four') return { ...state, phase: 'finished', winner, finishReason: reason };
  return { ...state, phase: 'finished', result: { type: 'win', winner, reason } };
}

function finishStateAfterRestartTimeout(state: GameState): GameState {
  if (state.kind === 'splendor') return abortSplendorState(state, 'restart_timeout');
  if (state.kind === 'texas-holdem') return { ...state, phase: 'finished', turn: null, result: { type: 'aborted', reason: 'restart_timeout' } };
  if (state.kind === 'twenty-four') return { ...state, phase: 'finished', winner: null, finishReason: 'restart_timeout' };
  return { ...state, phase: 'finished', result: { type: 'draw' } };
}

export class RoomService {
  private readonly connections = new Map<string, Set<string>>();

  constructor(private readonly database: GameHallDatabase, private readonly io: GameHallIo) {}

  recoverAfterRestart(nowMs = Date.now(), lastKnownRunningAtMs = nowMs): void {
    this.database.transaction(() => {
      const rooms = this.database.raw.prepare("SELECT * FROM rooms WHERE status IN ('active', 'paused')").all() as RoomRow[];
      for (const room of rooms) {
        const state = parseGameState(room);
        let remaining = room.paused_remaining_ms;
        if (room.status === 'active' && room.pause_reason !== 'restart' && state?.kind === 'twenty-four') {
          // The persisted process heartbeat is the last instant the timer was
          // definitely running. Downtime is not charged, while elapsed play
          // before a hard crash is never reset to a fresh 30-second window.
          if (state.phase === 'answering') remaining = Math.max(0, state.deadlineAtMs - lastKnownRunningAtMs);
          if (state.phase === 'revealing') {
            remaining = Math.max(0, (room.next_round_at_ms ?? lastKnownRunningAtMs) - lastKnownRunningAtMs);
          }
        }
        this.database.raw.prepare(`
          UPDATE rooms
          SET status='paused', pause_reason='restart', restart_deadline_ms=?, paused_remaining_ms=?,
              next_round_at_ms=NULL, version=version+1, last_activity_ms=?
          WHERE id=?
        `).run(nowMs + RESTART_GRACE_MS, remaining, nowMs, room.id);
        this.database.raw.prepare(`
          UPDATE room_members
          SET disconnected_at_ms=?, disconnect_deadline_ms=NULL, disconnect_order=NULL, restart_rejoined_at_ms=NULL
          WHERE room_id=?
        `).run(nowMs, room.id);
      }
    });
  }

  getReconnectableRoomCode(sessionId: string, nowMs = Date.now()): string | null {
    const row = this.database.raw.prepare(`
      SELECT r.code
      FROM rooms r JOIN room_members m ON m.room_id=r.id
      WHERE m.session_id=? AND (r.status IN ('active', 'paused') OR r.cleanup_at_ms>?)
      ORDER BY r.last_activity_ms DESC LIMIT 1
    `).get(sessionId, nowMs) as { code: string } | undefined;
    return row?.code ?? null;
  }

  connect(socket: GameHallSocket): void {
    const sessionId = socket.data.sessionId;
    const sockets = this.connections.get(sessionId) ?? new Set<string>();
    const wasOffline = sockets.size === 0;
    const nowMs = Date.now();
    const memberships = this.database.raw.prepare(`
      SELECT r.id FROM rooms r JOIN room_members m ON m.room_id=r.id
      WHERE m.session_id=? AND (r.status IN ('active', 'paused') OR r.cleanup_at_ms>?)
    `).all(sessionId, nowMs) as Array<{ id: string }>;
    // Resolve an expired grace period while the session is still considered
    // offline. Adding this socket first would let a late reconnect bypass the
    // 60-second forfeit check in resolveExpiredDisconnect().
    if (wasOffline) {
      for (const membership of memberships) {
        this.resolveExpiredDisconnect(membership.id, nowMs);
        this.resolveExpiredRestart(membership.id, nowMs);
      }
    }
    sockets.add(socket.id);
    this.connections.set(sessionId, sockets);

    for (const membership of memberships) void socket.join(membership.id);
    if (wasOffline) {
      for (const membership of memberships) this.handleReconnect(sessionId, membership.id, nowMs);
    }
    for (const membership of memberships) {
      if (this.transferMultiplayerHost(membership.id)) this.database.raw.prepare('UPDATE rooms SET version=version+1 WHERE id=?').run(membership.id);
      this.emitSnapshots(membership.id);
      this.emitMessageHistoryToSession(membership.id, sessionId);
    }
  }

  disconnect(socket: GameHallSocket, nowMs = Date.now()): void {
    const sessionId = socket.data.sessionId;
    const sockets = this.connections.get(sessionId);
    sockets?.delete(socket.id);
    if (sockets && sockets.size > 0) return;
    this.connections.delete(sessionId);

    const rooms = this.database.raw.prepare(`
      SELECT r.* FROM rooms r JOIN room_members m ON m.room_id=r.id
      WHERE m.session_id=? AND (r.status IN ('active', 'paused') OR r.cleanup_at_ms>?)
    `).all(sessionId, nowMs) as RoomRow[];
    for (const room of rooms) {
      if (room.status === 'waiting' || room.status === 'finished') {
        if (room.status === 'waiting') {
          this.database.raw.prepare('UPDATE room_members SET disconnected_at_ms=?, ready=0 WHERE room_id=? AND session_id=?')
            .run(nowMs, room.id, sessionId);
        } else {
          this.database.raw.prepare('UPDATE room_members SET disconnected_at_ms=?, rematch_ready=0 WHERE room_id=? AND session_id=?')
            .run(nowMs, room.id, sessionId);
        }
        if (this.transferMultiplayerHost(room.id)) this.database.raw.prepare('UPDATE rooms SET version=version+1 WHERE id=?').run(room.id);
        this.emitSnapshots(room.id);
        continue;
      }
      if (room.pause_reason === 'restart') {
        this.database.raw.prepare('UPDATE room_members SET disconnected_at_ms=?, restart_rejoined_at_ms=NULL WHERE room_id=? AND session_id=?')
          .run(nowMs, room.id, sessionId);
        this.emitSnapshots(room.id);
        continue;
      }
      const state = parseGameState(room);
      let remaining: number | null = room.paused_remaining_ms;
      if (room.status === 'active' && state?.kind === 'twenty-four') {
        if (state.phase === 'answering') remaining = Math.max(0, state.deadlineAtMs - nowMs);
        if (state.phase === 'revealing' && room.next_round_at_ms !== null) {
          remaining = Math.max(0, room.next_round_at_ms - nowMs);
        }
      }
      this.database.transaction(() => {
        const fresh = this.getRoom(room.id);
        if (!fresh || (fresh.status !== 'active' && fresh.pause_reason !== 'disconnect')) return;
        const newVersion = fresh.version + 1;
        this.database.raw.prepare(`
          UPDATE room_members
          SET disconnected_at_ms=?, disconnect_deadline_ms=?, disconnect_order=?
          WHERE room_id=? AND session_id=?
        `).run(nowMs, nowMs + DISCONNECT_GRACE_MS, newVersion, room.id, sessionId);
        this.database.raw.prepare(`
          UPDATE rooms SET status='paused', pause_reason='disconnect', paused_remaining_ms=?,
            next_round_at_ms=NULL, version=?, last_activity_ms=? WHERE id=?
        `).run(remaining, newVersion, nowMs, room.id);
      });
      this.emitSnapshots(room.id);
    }
  }

  createRoom(sessionId: string, command: CreateRoomCommand): CommandAck {
    const normalized = normalizeNickname(command.nickname);
    if (!normalized) return errorAck('room:create', command.commandId, 'INVALID_NICKNAME', '昵称需为 1–16 个可显示字符');
    const existing = this.findActiveMembership(sessionId);
    if (existing) return errorAck('room:create', command.commandId, 'ALREADY_IN_ROOM', `你已在房间 ${existing.code} 中`);
    let code = createRoomCode();
    while (this.database.raw.prepare('SELECT 1 FROM rooms WHERE code=?').get(code)) code = createRoomCode();
    const nowMs = Date.now();
    const roomId = randomUUID();
    this.database.transaction(() => {
      this.database.raw.prepare(`
        INSERT INTO rooms(id, code, game_id, status, version, created_at_ms, last_activity_ms, cleanup_at_ms)
        VALUES (?, ?, ?, 'waiting', 0, ?, ?, ?)
      `).run(roomId, code, command.gameId, nowMs, nowMs, nowMs + WAITING_TTL_MS);
      this.database.raw.prepare(`
        INSERT INTO room_members(room_id, seat, session_id, nickname, nickname_key, joined_at_ms)
        VALUES (?, 0, ?, ?, ?, ?)
      `).run(roomId, sessionId, normalized.display, normalized.key, nowMs);
    });
    this.joinSessionSockets(sessionId, roomId);
    this.emitSnapshots(roomId);
    this.emitMessageHistoryToSession(roomId, sessionId);
    return { ok: true, roomId, code, version: 0 };
  }

  joinRoom(sessionId: string, command: JoinRoomCommand): CommandAck {
    const normalized = normalizeNickname(command.nickname);
    if (!normalized) return errorAck('room:join', command.commandId, 'INVALID_NICKNAME', '昵称需为 1–16 个可显示字符');
    const room = this.database.raw.prepare('SELECT * FROM rooms WHERE code=?').get(command.code) as RoomRow | undefined;
    if (!room) return errorAck('room:join', command.commandId, 'ROOM_NOT_FOUND', '没有找到这个房间');
    const sameMembership = this.database.raw.prepare('SELECT 1 FROM room_members WHERE room_id=? AND session_id=?').get(room.id, sessionId);
    if (sameMembership) {
      this.joinSessionSockets(sessionId, room.id);
      this.emitSnapshots(room.id);
      this.emitMessageHistoryToSession(room.id, sessionId);
      return { ok: true, roomId: room.id, code: room.code, version: room.version };
    }
    const existing = this.findActiveMembership(sessionId);
    if (existing) return errorAck('room:join', command.commandId, 'ALREADY_IN_ROOM', `你已在房间 ${existing.code} 中`);
    if (room.status !== 'waiting') return errorAck('room:join', command.commandId, 'ROOM_NOT_JOINABLE', '这个房间已经开局或结束');
    const members = this.getMembers(room.id);
    const capacity = room.game_id === 'splendor' || room.game_id === 'texas-holdem' ? 4 : 2;
    if (members.length >= capacity) return errorAck('room:join', command.commandId, 'ROOM_FULL', '房间已经坐满');
    const seat = Array.from({ length: capacity }, (_, index) => index).find((index) => !members.some((item) => item.seat === index))!;
    if (members.some((member) => member.nickname_key === normalized.key)) {
      return errorAck('room:join', command.commandId, 'NICKNAME_TAKEN', '房间里已有同名玩家');
    }
    const nowMs = Date.now();
    const newVersion = room.version + 1;
    this.database.transaction(() => {
      this.database.raw.prepare(`
        INSERT INTO room_members(room_id, seat, session_id, nickname, nickname_key, joined_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(room.id, seat, sessionId, normalized.display, normalized.key, nowMs);
      this.database.raw.prepare('UPDATE rooms SET version=?, last_activity_ms=?, cleanup_at_ms=? WHERE id=?')
        .run(newVersion, nowMs, nowMs + WAITING_TTL_MS, room.id);
    });
    this.joinSessionSockets(sessionId, room.id);
    this.emitSnapshots(room.id);
    this.emitMessageHistoryToSession(room.id, sessionId);
    return { ok: true, roomId: room.id, code: room.code, version: newVersion };
  }

  setReady(sessionId: string, command: ReadyRoomCommand): CommandAck {
    const room = this.getRoom(command.roomId);
    if (!room) return errorAck('room:ready', command.commandId, 'ROOM_NOT_FOUND', '房间不存在');
    const member = this.getMember(room.id, sessionId);
    if (!member) return errorAck('room:ready', command.commandId, 'NOT_A_MEMBER', '你不在这个房间');
    if (room.status !== 'waiting') return errorAck('room:ready', command.commandId, 'ROOM_ALREADY_STARTED', '对局已经开始');
    const nowMs = Date.now();
    const resultingVersion = room.version + 1;
    this.database.transaction(() => {
      this.database.raw.prepare('UPDATE room_members SET ready=? WHERE room_id=? AND session_id=?')
        .run(command.ready ? 1 : 0, room.id, sessionId);
      const members = this.getMembers(room.id);
      if (room.game_id !== 'splendor' && room.game_id !== 'texas-holdem' && members.length === 2 && members.every((item) => item.ready === 1 && this.isOnline(item.session_id))) {
        const state = createInitialGame(room.game_id, nowMs);
        this.database.raw.prepare(`
          UPDATE rooms SET status='active', version=?, round_no=1, state_json=?, state_schema_version=?, pause_reason=NULL,
            finish_reason=NULL, last_activity_ms=?, cleanup_at_ms=? WHERE id=?
        `).run(resultingVersion, serializeGameState(state), gameStateSchemaVersion(room.game_id), nowMs, nowMs + WAITING_TTL_MS, room.id);
      } else {
        this.database.raw.prepare('UPDATE rooms SET version=?, last_activity_ms=?, cleanup_at_ms=? WHERE id=?')
          .run(resultingVersion, nowMs, nowMs + WAITING_TTL_MS, room.id);
      }
    });
    this.emitSnapshots(room.id);
    return { ok: true, roomId: room.id, version: resultingVersion };
  }

  startRoom(sessionId: string, command: StartRoomCommand): CommandAck {
    const ack = this.executeRoomCommand('room:start', sessionId, command, (): CommandAck => {
      const room = this.getRoom(command.roomId);
      const member = room && this.getMember(room.id, sessionId);
      if (!room || !member) return errorAck('room:start', command.commandId, 'NOT_A_MEMBER', '你不在这个房间');
      if ((room.game_id !== 'splendor' && room.game_id !== 'texas-holdem') || room.host_seat !== member.seat) return errorAck('room:start', command.commandId, 'HOST_ONLY', '仅多人牌桌房主可以开始对局');
      if (room.version !== command.expectedVersion) return errorAck('room:start', command.commandId, 'VERSION_CONFLICT', '房间已更新，请重试', true, room.version);
      if (room.status !== 'waiting') return errorAck('room:start', command.commandId, 'ROOM_ALREADY_STARTED', '当前不能开始对局');
      const members = this.getMembers(room.id);
      if (members.length < 2 || members.length > 4 || !members.every((item) => this.isOnline(item.session_id) && (item.seat === room.host_seat || item.ready))) return errorAck('room:start', command.commandId, 'PLAYERS_NOT_READY', '至少两位玩家在线且其他成员均已准备后才可开始');
      this.database.raw.prepare('UPDATE room_members SET ready=1 WHERE room_id=? AND seat=?').run(room.id, room.host_seat);
      const nowMs = Date.now();
      const state = createInitialGame(room.game_id, nowMs, undefined, members.map((item) => item.seat));
      this.database.raw.prepare(`UPDATE rooms SET status='active', version=version+1, round_no=round_no+1,
        state_json=?, state_schema_version=?, pause_reason=NULL, finish_reason=NULL,
        last_activity_ms=?, cleanup_at_ms=? WHERE id=?`).run(serializeGameState(state), gameStateSchemaVersion(room.game_id), nowMs, nowMs + WAITING_TTL_MS, room.id);
      return { ok: true, roomId: room.id, version: room.version + 1 };
    });
    this.emitSnapshots(command.roomId);
    return ack;
  }

  reopenRoom(sessionId: string, command: ReopenRoomCommand): CommandAck {
    const ack = this.executeRoomCommand('room:reopen', sessionId, command, (): CommandAck => {
      const room = this.getRoom(command.roomId);
      const member = room && this.getMember(room.id, sessionId);
      if (!room || !member) return errorAck('room:reopen', command.commandId, 'NOT_A_MEMBER', '你不在这个房间');
      if ((room.game_id !== 'splendor' && room.game_id !== 'texas-holdem') || room.host_seat !== member.seat) return errorAck('room:reopen', command.commandId, 'HOST_ONLY', '仅多人牌桌房主可以返回等待区');
      if (room.version !== command.expectedVersion) return errorAck('room:reopen', command.commandId, 'VERSION_CONFLICT', '房间已更新，请重试', true, room.version);
      if (room.status !== 'finished') return errorAck('room:reopen', command.commandId, 'GAME_NOT_FINISHED', '本局结束后才可返回等待区');
      for (const item of this.getMembers(room.id)) {
        if (!this.isOnline(item.session_id)) this.database.raw.prepare('DELETE FROM room_members WHERE room_id=? AND session_id=?').run(room.id, item.session_id);
      }
      this.database.raw.prepare(`UPDATE room_members SET ready=0, rematch_ready=0, disconnected_at_ms=NULL,
        disconnect_deadline_ms=NULL, disconnect_order=NULL, restart_rejoined_at_ms=NULL WHERE room_id=?`).run(room.id);
      const nowMs = Date.now();
      this.database.raw.prepare(`UPDATE rooms SET status='waiting', version=version+1, state_json=NULL,
        pause_reason=NULL, paused_remaining_ms=NULL, restart_deadline_ms=NULL, next_round_at_ms=NULL,
        finish_reason=NULL, last_activity_ms=?, cleanup_at_ms=? WHERE id=?`).run(nowMs, nowMs + WAITING_TTL_MS, room.id);
      return { ok: true, roomId: room.id, code: room.code, version: room.version + 1 };
    });
    this.emitSnapshots(command.roomId);
    return ack;
  }

  private executeRoomCommand(event: string, sessionId: string, command: StartRoomCommand, operation: () => CommandAck): CommandAck {
    return this.database.transaction(() => {
      const hash = requestHash({ event, ...command });
      const receipt = this.database.raw.prepare('SELECT request_hash, outcome_json FROM processed_actions WHERE session_id=? AND action_id=?')
        .get(sessionId, command.commandId) as { request_hash: string; outcome_json: string } | undefined;
      if (receipt) return receipt.request_hash === hash ? JSON.parse(receipt.outcome_json) as CommandAck
        : errorAck(event, command.commandId, 'COMMAND_ID_REUSED', '同一个 commandId 不能用于不同操作');
      const outcome = operation();
      const room = this.getRoom(command.roomId);
      if (room && this.getMember(room.id, sessionId)) this.database.raw.prepare(`
        INSERT INTO processed_actions(session_id, action_id, room_id, request_hash, expected_version,
          outcome_json, resulting_version, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, command.commandId, room.id, hash, command.expectedVersion, JSON.stringify(outcome), room.version, Date.now());
      return outcome;
    });
  }

  leaveRoom(sessionId: string, command: LeaveRoomCommand): CommandAck {
    const room = this.getRoom(command.roomId);
    if (!room) return errorAck('room:leave', command.commandId, 'ROOM_NOT_FOUND', '房间不存在');
    const member = this.getMember(room.id, sessionId);
    if (!member) return errorAck('room:leave', command.commandId, 'NOT_A_MEMBER', '你不在这个房间');
    const nowMs = Date.now();
    if (room.game_id === 'splendor' || room.game_id === 'texas-holdem') {
      this.database.transaction(() => {
        const state = parseGameState(room);
        const aborted = state?.kind === 'splendor' && room.status !== 'finished' ? abortSplendorState(state, 'leave')
          : state?.kind === 'texas-holdem' && room.status !== 'finished' ? finishStateByForfeit(state, member.seat, 'leave') : state;
        this.database.raw.prepare('DELETE FROM room_members WHERE room_id=? AND session_id=?').run(room.id, sessionId);
        this.database.raw.prepare(`UPDATE rooms SET status=?, state_json=?, version=version+1, last_activity_ms=?, cleanup_at_ms=?,
          pause_reason=NULL, paused_remaining_ms=NULL, restart_deadline_ms=NULL, next_round_at_ms=NULL WHERE id=?`)
          .run(room.status === 'waiting' ? 'waiting' : 'finished', aborted ? serializeGameState(aborted) : null,
            nowMs, nowMs + (room.status === 'waiting' ? WAITING_TTL_MS : FINISHED_TTL_MS), room.id);
        this.database.raw.prepare('UPDATE room_members SET disconnect_deadline_ms=NULL, disconnect_order=NULL WHERE room_id=?').run(room.id);
        this.transferMultiplayerHost(room.id);
      });
      this.leaveSessionSockets(sessionId, room.id);
      if (this.getMembers(room.id).length === 0) this.closeRoom(room.id, 'room_closed');
      else this.emitSnapshots(room.id);
      return { ok: true, roomId: room.id, version: room.version + 1 };
    }
    if (room.status === 'active' || room.status === 'paused') {
      this.finishWithLoser(room, member.seat, 'left_room', nowMs);
      this.database.raw.prepare('DELETE FROM room_members WHERE room_id=? AND session_id=?').run(room.id, sessionId);
      this.leaveSessionSockets(sessionId, room.id);
      this.emitSnapshots(room.id);
      return { ok: true, roomId: room.id, version: room.version + 1 };
    }
    if (room.status === 'waiting' && member.seat === 1) {
      const version = room.version + 1;
      this.database.transaction(() => {
        this.database.raw.prepare('DELETE FROM room_members WHERE room_id=? AND session_id=?').run(room.id, sessionId);
        this.database.raw.prepare('UPDATE rooms SET version=?, last_activity_ms=?, cleanup_at_ms=? WHERE id=?')
          .run(version, nowMs, nowMs + WAITING_TTL_MS, room.id);
      });
      this.leaveSessionSockets(sessionId, room.id);
      this.emitSnapshots(room.id);
      return { ok: true, roomId: room.id, version };
    }
    this.closeRoom(room.id, 'room_closed');
    return { ok: true, roomId: room.id, version: room.version + 1 };
  }

  requestRematch(sessionId: string, command: RematchCommand): CommandAck {
    const room = this.getRoom(command.roomId);
    if (!room) return errorAck('game:rematch', command.commandId, 'ROOM_NOT_FOUND', '房间不存在');
    const member = this.getMember(room.id, sessionId);
    if (!member) return errorAck('game:rematch', command.commandId, 'NOT_A_MEMBER', '你不在这个房间');
    if (room.game_id === 'splendor' || room.game_id === 'texas-holdem' || room.status !== 'finished' || this.getMembers(room.id).length !== 2) {
      return errorAck('game:rematch', command.commandId, 'REMATCH_UNAVAILABLE', '当前不能发起复赛');
    }
    const nowMs = Date.now();
    const newVersion = room.version + 1;
    this.database.transaction(() => {
      this.database.raw.prepare('UPDATE room_members SET rematch_ready=? WHERE room_id=? AND session_id=?')
        .run(command.requested ? 1 : 0, room.id, sessionId);
      const members = this.getMembers(room.id);
      if (members.every((item) => item.rematch_ready === 1 && this.isOnline(item.session_id))) {
        const previous = parseGameState(room);
        let role: Player | undefined;
        if (previous?.kind === 'gomoku') role = otherPlayer(previous.blackPlayer);
        if (previous?.kind === 'quoridor') {
          const previousSouth = previous.goalRows[0] === 0 ? 0 : 1;
          role = otherPlayer(previousSouth);
        }
        const state = createInitialGame(room.game_id, nowMs, role);
        this.database.raw.prepare(`
          UPDATE rooms SET status='active', version=?, round_no=round_no+1, state_json=?, state_schema_version=?, pause_reason=NULL,
            paused_remaining_ms=NULL, restart_deadline_ms=NULL, next_round_at_ms=NULL, finish_reason=NULL,
            last_activity_ms=?, cleanup_at_ms=? WHERE id=?
        `).run(newVersion, serializeGameState(state), gameStateSchemaVersion(room.game_id), nowMs, nowMs + WAITING_TTL_MS, room.id);
        this.database.raw.prepare(`
          UPDATE room_members SET ready=1, rematch_ready=0, disconnected_at_ms=NULL,
            disconnect_deadline_ms=NULL, disconnect_order=NULL WHERE room_id=?
        `).run(room.id);
      } else {
        this.database.raw.prepare('UPDATE rooms SET version=?, last_activity_ms=? WHERE id=?').run(newVersion, nowMs, room.id);
      }
    });
    this.emitSnapshots(room.id);
    return { ok: true, roomId: room.id, version: newVersion };
  }

  applyGameAction(sessionId: string, command: GameActionCommand): CommandAck {
    const initialRoom = this.getRoom(command.roomId);
    if (!initialRoom) return errorAck('game:action', command.actionId, 'ROOM_NOT_FOUND', '房间不存在');
    const member = this.getMember(initialRoom.id, sessionId);
    if (!member) return errorAck('game:action', command.actionId, 'NOT_A_MEMBER', '你不在这个房间');
    const hash = requestHash(command);
    let shouldBroadcast = false;
    const ack = this.database.transaction((): CommandAck => {
      const receipt = this.database.raw.prepare('SELECT request_hash, outcome_json FROM processed_actions WHERE session_id=? AND action_id=?')
        .get(sessionId, command.actionId) as { request_hash: string; outcome_json: string } | undefined;
      if (receipt) {
        if (receipt.request_hash !== hash) return errorAck('game:action', command.actionId, 'ACTION_ID_REUSED', '同一个 actionId 不能用于不同操作');
        return JSON.parse(receipt.outcome_json) as CommandAck;
      }
      const room = this.getRoom(command.roomId);
      if (!room) return errorAck('game:action', command.actionId, 'ROOM_NOT_FOUND', '房间不存在');
      let outcome: CommandAck;
      let resultingVersion = room.version;
      if (room.status !== 'active' && !(room.game_id === 'splendor' && room.status === 'paused' && command.action.type === 'resign')) {
        outcome = errorAck('game:action', command.actionId, room.status === 'paused' ? 'ROOM_PAUSED' : 'GAME_NOT_ACTIVE', room.status === 'paused' ? '对局暂停中' : '对局尚未开始或已经结束', true, room.version);
      } else if (command.expectedVersion !== room.version) {
        outcome = errorAck('game:action', command.actionId, 'VERSION_CONFLICT', '状态已更新，请基于最新棋盘重试', true, room.version);
      } else {
        const state = parseGameState(room);
        if (!state) {
          outcome = errorAck('game:action', command.actionId, 'STATE_MISSING', '对局状态不可用');
        } else {
          const nowMs = Date.now();
          const advanced = validateAndAdvance(state, member.seat, command.action, nowMs);
          if (!advanced.ok) {
            outcome = errorAck('game:action', command.actionId, 'INVALID_ACTION', advanced.message);
          } else {
            const result = advanced.result;
            if (!result.ok && !result.state) {
              outcome = errorAck('game:action', command.actionId, result.error.code, result.error.message, false, room.version);
            } else {
              const nextState = result.state!;
              resultingVersion = room.version + 1;
              const terminalResult = gameResult(nextState);
              const finished = terminalResult !== null;
              if (finished !== (nextState.phase === 'finished')) {
                throw new Error('game result and phase disagree');
              }
              const status = finished ? 'finished' : 'active';
              const nextRoundAt = nextState.kind === 'twenty-four' && nextState.phase === 'revealing' ? nowMs + REVEAL_MS : null;
              const cleanupAt = finished ? nowMs + FINISHED_TTL_MS : room.cleanup_at_ms;
              const updated = this.database.raw.prepare(`
                UPDATE rooms SET state_json=?, state_schema_version=?, status=?, version=?, next_round_at_ms=?, finish_reason=?,
                  last_activity_ms=?, cleanup_at_ms=? WHERE id=? AND version=?
              `).run(serializeGameState(nextState), gameStateSchemaVersion(room.game_id), status, resultingVersion, nextRoundAt, finished ? 'game_result' : null, nowMs, cleanupAt, room.id, room.version);
              if (updated.changes !== 1) throw new Error('room version changed during transaction');
              if (finished && (nextState.kind === 'splendor' || nextState.kind === 'texas-holdem')) {
                this.database.raw.prepare('UPDATE rooms SET pause_reason=NULL, paused_remaining_ms=NULL, restart_deadline_ms=NULL WHERE id=?').run(room.id);
                this.database.raw.prepare('UPDATE room_members SET disconnect_deadline_ms=NULL, disconnect_order=NULL WHERE room_id=?').run(room.id);
              }
              shouldBroadcast = true;
              outcome = result.ok
                ? { ok: true, roomId: room.id, version: resultingVersion }
                : errorAck('game:action', command.actionId, result.error.code, result.error.message, false, resultingVersion);
            }
          }
        }
      }
      this.transferMultiplayerHost(room.id);
      this.database.raw.prepare(`
        INSERT INTO processed_actions(session_id, action_id, room_id, request_hash, expected_version,
          outcome_json, resulting_version, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, command.actionId, room.id, hash, command.expectedVersion, JSON.stringify(outcome), resultingVersion, Date.now());
      return outcome;
    });
    if (shouldBroadcast) this.emitSnapshots(command.roomId);
    else this.emitSnapshotsToSession(command.roomId, sessionId);
    return ack;
  }

  sendMessage(sessionId: string, command: RoomMessageCommand): CommandAck {
    const room = this.getRoom(command.roomId);
    if (!room) return errorAck('room:message:send', command.messageId, 'ROOM_NOT_FOUND', '房间不存在');
    const member = this.getMember(command.roomId, sessionId);
    if (!member) return errorAck('room:message:send', command.messageId, 'NOT_A_MEMBER', '你不在这个房间');
    const content = normalizeRoomMessage(command.content);
    if (!content) {
      return errorAck('room:message:send', command.messageId, 'INVALID_MESSAGE', '消息需为 1–100 个可见字符，且不能包含控制字符');
    }

    let message: RoomMessage | null = null;
    const result = this.database.transaction((): CommandAck => {
      const existing = this.database.raw.prepare(`
        SELECT room_id, sender_session_id, content FROM room_messages WHERE message_id=?
      `).get(command.messageId) as { room_id: string; sender_session_id: string; content: string } | undefined;
      if (existing) {
        if (existing.room_id === command.roomId && existing.sender_session_id === sessionId && existing.content === content) {
          return { ok: true, roomId: command.roomId, version: room.version };
        }
        return errorAck('room:message:send', command.messageId, 'MESSAGE_ID_REUSED', '同一个消息编号不能用于不同内容');
      }

      const sentAtMs = Date.now();
      this.database.raw.prepare(`
        INSERT INTO room_messages(message_id, room_id, sender_session_id, seat, nickname, content, sent_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(command.messageId, command.roomId, sessionId, member.seat, member.nickname, content, sentAtMs);
      this.database.raw.prepare(`
        DELETE FROM room_messages
        WHERE room_id=? AND sequence NOT IN (
          SELECT sequence FROM room_messages WHERE room_id=? ORDER BY sequence DESC LIMIT 100
        )
      `).run(command.roomId, command.roomId);
      message = {
        messageId: command.messageId,
        roomId: command.roomId,
        seat: member.seat,
        nickname: member.nickname,
        content,
        sentAtMs,
      };
      return { ok: true, roomId: command.roomId, version: room.version };
    });
    const sentMessage = message as RoomMessage | null;
    if (sentMessage) {
      if (room.game_id !== 'splendor') this.io.to(command.roomId).emit('room:message', sentMessage);
      else for (const recipient of this.getMembers(room.id)) {
        for (const socketId of this.connections.get(recipient.session_id) ?? []) {
          this.io.to(socketId).emit('room:message', { ...sentMessage, isMine: recipient.session_id === sessionId });
        }
      }
    }
    return result;
  }

  sweep(nowMs = Date.now()): void {
    const expiredDisconnects = this.database.raw.prepare(`
      SELECT DISTINCT room_id FROM room_members
      WHERE disconnect_deadline_ms IS NOT NULL AND disconnect_deadline_ms<=?
    `).all(nowMs) as Array<{ room_id: string }>;
    for (const item of expiredDisconnects) this.resolveExpiredDisconnect(item.room_id, nowMs);

    const restartExpired = this.database.raw.prepare(`
      SELECT id FROM rooms WHERE status='paused' AND pause_reason='restart' AND restart_deadline_ms<=?
    `).all(nowMs) as Array<{ id: string }>;
    for (const item of restartExpired) this.resolveExpiredRestart(item.id, nowMs);

    const activeTwentyFour = this.database.raw.prepare("SELECT * FROM rooms WHERE status='active' AND game_id='twenty-four'").all() as RoomRow[];
    for (const room of activeTwentyFour) {
      const state = parseGameState(room);
      if (state?.kind !== 'twenty-four') continue;
      if (state.phase === 'answering' && nowMs >= state.deadlineAtMs) {
        const expired = expireTwentyFourRound(state, nowMs);
        this.database.raw.prepare('UPDATE rooms SET state_json=?, state_schema_version=?, version=version+1, next_round_at_ms=?, last_activity_ms=? WHERE id=?')
          .run(serializeGameState(expired), twentyFourDefinition.stateSchemaVersion, nowMs + REVEAL_MS, nowMs, room.id);
        this.emitSnapshots(room.id);
      }
    }

    const roundsReady = this.database.raw.prepare(`
      SELECT * FROM rooms WHERE status='active' AND game_id='twenty-four'
        AND next_round_at_ms IS NOT NULL AND next_round_at_ms<=?
    `).all(nowMs) as RoomRow[];
    for (const room of roundsReady) {
      const state = parseGameState(room);
      if (state?.kind !== 'twenty-four' || state.phase !== 'revealing') continue;
      const excluded = new Set([state.cards.map((card) => card.rank).sort((a, b) => a - b).join('-')]);
      const next = drawSolvableCards(gameRandom, excluded);
      const advanced = startNextTwentyFourRound(state, next.cards, next.solution, nowMs);
      this.database.raw.prepare(`
        UPDATE rooms SET state_json=?, state_schema_version=?, version=version+1, round_no=round_no+1,
          next_round_at_ms=NULL, last_activity_ms=? WHERE id=?
      `).run(serializeGameState(advanced), twentyFourDefinition.stateSchemaVersion, nowMs, room.id);
      this.emitSnapshots(room.id);
    }

    const expiredRooms = this.database.raw.prepare("SELECT id FROM rooms WHERE status IN ('waiting', 'finished') AND cleanup_at_ms<=?").all(nowMs) as Array<{ id: string }>;
    for (const room of expiredRooms) this.closeRoom(room.id, 'room_expired');
    this.database.raw.prepare(`
      DELETE FROM guest_sessions
      WHERE expires_at_ms<=? AND id NOT IN (SELECT session_id FROM room_members)
    `).run(nowMs);
  }

  emitSnapshots(roomId: string): void {
    const room = this.getRoom(roomId);
    if (!room) return;
    const members = this.getMembers(roomId);
    const nowMs = Date.now();
    const state = parseGameState(room);
    for (const member of members) {
      const roomSnapshot = this.roomSnapshot(room, members, member.seat, nowMs);
      const gameSnapshot: GameSnapshot | null = state ? {
        roomId: room.id,
        gameId: room.game_id,
        version: room.version,
        status: room.status,
        mySeat: member.seat,
        view: viewForPlayer(state, member.seat, nowMs, room.status === 'paused' ? room.paused_remaining_ms : null),
        serverTimeMs: nowMs,
      } : null;
      for (const socketId of this.connections.get(member.session_id) ?? []) {
        this.io.to(socketId).emit('room:snapshot', roomSnapshot);
        this.io.to(socketId).emit('presence:update', roomSnapshot);
        if (gameSnapshot) this.io.to(socketId).emit('game:snapshot', gameSnapshot);
      }
    }
  }

  private roomSnapshot(room: RoomRow, members: MemberRow[], mySeat: PlayerSeat, nowMs: number): RoomSnapshot {
    return {
      roomId: room.id,
      code: room.code,
      gameId: room.game_id,
      status: room.status,
      version: room.version,
      hostSeat: room.host_seat,
      mySeat,
      members: members.map((member) => ({
        seat: member.seat,
        nickname: member.nickname,
        ready: member.ready === 1,
        rematchReady: member.rematch_ready === 1,
        online: this.isOnline(member.session_id),
        disconnectedAtMs: member.disconnected_at_ms,
        disconnectDeadlineMs: member.disconnect_deadline_ms,
      })),
      pauseReason: room.pause_reason,
      restartDeadlineMs: room.restart_deadline_ms,
      serverTimeMs: nowMs,
    };
  }

  private emitSnapshotsToSession(roomId: string, sessionId: string): void {
    const room = this.getRoom(roomId);
    const member = room ? this.getMember(roomId, sessionId) : undefined;
    if (!room || !member) return;
    const members = this.getMembers(roomId);
    const nowMs = Date.now();
    const state = parseGameState(room);
    const roomSnapshot = this.roomSnapshot(room, members, member.seat, nowMs);
    for (const socketId of this.connections.get(sessionId) ?? []) {
      this.io.to(socketId).emit('room:snapshot', roomSnapshot);
      if (state) {
        this.io.to(socketId).emit('game:snapshot', {
          roomId,
          gameId: room.game_id,
          version: room.version,
          status: room.status,
          mySeat: member.seat,
          view: viewForPlayer(state, member.seat, nowMs, room.status === 'paused' ? room.paused_remaining_ms : null),
          serverTimeMs: nowMs,
        });
      }
    }
  }

  private emitMessageHistoryToSession(roomId: string, sessionId: string): void {
    const messages = this.database.raw.prepare(`
      SELECT message_id, room_id, sender_session_id, seat, nickname, content, sent_at_ms
      FROM room_messages WHERE room_id=? ORDER BY sequence ASC
    `).all(roomId) as Array<{
      message_id: string;
      sender_session_id: string;
      room_id: string;
      seat: PlayerSeat;
      nickname: string;
      content: string;
      sent_at_ms: number;
    }>;
    const payload = {
      roomId,
      messages: messages.map((item): RoomMessage => ({
        messageId: item.message_id,
        roomId: item.room_id,
        seat: item.seat,
        nickname: item.nickname,
        content: item.content,
        sentAtMs: item.sent_at_ms,
        ...(this.getRoom(roomId)?.game_id === 'splendor' ? { isMine: item.sender_session_id === sessionId } : {}),
      })),
    };
    for (const socketId of this.connections.get(sessionId) ?? []) {
      this.io.to(socketId).emit('room:message:history', payload);
    }
  }

  private handleReconnect(sessionId: string, roomId: string, nowMs: number): void {
    this.resolveExpiredDisconnect(roomId, nowMs);
    this.resolveExpiredRestart(roomId, nowMs);
    this.database.transaction(() => {
      let room = this.getRoom(roomId);
      if (!room || (room.status === 'finished' && room.game_id !== 'splendor' && room.game_id !== 'texas-holdem')) return;
      this.database.raw.prepare(`
        UPDATE room_members SET disconnected_at_ms=NULL, disconnect_deadline_ms=NULL,
          disconnect_order=NULL, restart_rejoined_at_ms=? WHERE room_id=? AND session_id=?
      `).run(room.pause_reason === 'restart' ? nowMs : null, roomId, sessionId);
      room = this.getRoom(roomId);
      if (!room || room.status !== 'paused') return;
      const members = this.getMembers(roomId);
      if (!members.every((member) => this.isOnline(member.session_id))) return;
      if (room.pause_reason === 'restart' && !members.every((member) => member.restart_rejoined_at_ms !== null)) return;
      let state = parseGameState(room);
      let nextRoundAtMs: number | null = null;
      if (state?.kind === 'twenty-four') {
        if (state.phase === 'answering') {
          state = { ...state, deadlineAtMs: nowMs + (room.paused_remaining_ms ?? 30_000) };
        } else if (state.phase === 'revealing') {
          nextRoundAtMs = nowMs + (room.paused_remaining_ms ?? REVEAL_MS);
        }
      }
      this.database.raw.prepare(`
        UPDATE rooms SET status='active', pause_reason=NULL, paused_remaining_ms=NULL,
          restart_deadline_ms=NULL, next_round_at_ms=?, version=version+1, state_json=?, state_schema_version=?, last_activity_ms=? WHERE id=?
      `).run(nextRoundAtMs, state ? serializeGameState(state) : null, gameStateSchemaVersion(room.game_id), nowMs, roomId);
      this.database.raw.prepare(`
        UPDATE room_members SET disconnected_at_ms=NULL, disconnect_deadline_ms=NULL,
          disconnect_order=NULL, restart_rejoined_at_ms=NULL WHERE room_id=?
      `).run(roomId);
    });
  }

  private transferMultiplayerHost(roomId: string): boolean {
    const room = this.getRoom(roomId);
    if (!room || (room.game_id !== 'splendor' && room.game_id !== 'texas-holdem') || (room.status !== 'waiting' && room.status !== 'finished')) return false;
    const members = this.getMembers(roomId);
    if (members.some((member) => member.seat === room.host_seat && this.isOnline(member.session_id))) return false;
    const successor = members.filter((member) => this.isOnline(member.session_id))
      .sort((a, b) => a.joined_at_ms - b.joined_at_ms || a.seat - b.seat)[0];
    if (!successor || successor.seat === room.host_seat) return false;
    this.database.raw.prepare('UPDATE rooms SET host_seat=? WHERE id=?').run(successor.seat, roomId);
    return true;
  }

  private resolveExpiredDisconnect(roomId: string, nowMs: number): void {
    const room = this.getRoom(roomId);
    if (!room || room.status !== 'paused' || room.pause_reason !== 'disconnect') return;
    const expired = this.database.raw.prepare(`
      SELECT * FROM room_members WHERE room_id=? AND disconnect_deadline_ms IS NOT NULL
        AND disconnect_deadline_ms<=? ORDER BY disconnect_deadline_ms ASC, disconnect_order ASC LIMIT 1
    `).get(roomId, nowMs) as MemberRow | undefined;
    if (!expired || this.isOnline(expired.session_id)) return;
    this.finishWithLoser(room, expired.seat, 'disconnect_forfeit', nowMs);
    this.transferMultiplayerHost(roomId);
    this.emitSnapshots(roomId);
  }

  private resolveExpiredRestart(roomId: string, nowMs: number): void {
    const room = this.getRoom(roomId);
    if (!room || room.status !== 'paused' || room.pause_reason !== 'restart'
      || room.restart_deadline_ms === null || room.restart_deadline_ms > nowMs) return;
    const state = parseGameState(room);
    const finishedState = state ? finishStateAfterRestartTimeout(state) : null;
    this.database.raw.prepare(`
      UPDATE rooms SET status='finished', state_json=?, state_schema_version=?, pause_reason=NULL, paused_remaining_ms=NULL,
        restart_deadline_ms=NULL, next_round_at_ms=NULL, finish_reason='restart_timeout',
        version=version+1, cleanup_at_ms=?, last_activity_ms=? WHERE id=?
    `).run(finishedState ? serializeGameState(finishedState) : null, gameStateSchemaVersion(room.game_id), nowMs + FINISHED_TTL_MS, nowMs, roomId);
    this.transferMultiplayerHost(roomId);
    this.emitSnapshots(roomId);
  }

  private finishWithLoser(room: RoomRow, loser: PlayerSeat, reason: string, nowMs: number): void {
    const state = parseGameState(room);
    const finishedState = state ? finishStateByForfeit(state, loser, reason === 'left_room' ? 'leave' : 'disconnect') : null;
    this.database.transaction(() => {
      this.database.raw.prepare(`
        UPDATE rooms SET status='finished', state_json=?, state_schema_version=?, pause_reason=NULL, paused_remaining_ms=NULL,
          restart_deadline_ms=NULL, next_round_at_ms=NULL, finish_reason=?, version=version+1,
          last_activity_ms=?, cleanup_at_ms=? WHERE id=?
      `).run(finishedState ? serializeGameState(finishedState) : null, gameStateSchemaVersion(room.game_id), reason, nowMs, nowMs + FINISHED_TTL_MS, room.id);
      this.database.raw.prepare(`
        UPDATE room_members SET disconnect_deadline_ms=NULL, disconnect_order=NULL WHERE room_id=?
      `).run(room.id);
    this.transferMultiplayerHost(room.id);
    });
  }

  private closeRoom(roomId: string, code: string): void {
    this.io.to(roomId).emit('command:error', {
      commandId: null,
      event: 'room:closed',
      code,
      message: code === 'room_expired' ? '房间因长时间无操作已关闭' : '房间已经关闭',
      retryable: false,
    });
    const members = this.getMembers(roomId);
    this.database.raw.prepare('DELETE FROM rooms WHERE id=?').run(roomId);
    for (const member of members) this.leaveSessionSockets(member.session_id, roomId);
  }

  private findActiveMembership(sessionId: string): { room_id: string; code: string } | undefined {
    return this.database.raw.prepare(`
      SELECT r.id AS room_id, r.code FROM rooms r JOIN room_members m ON m.room_id=r.id
      WHERE m.session_id=? AND (r.status IN ('waiting', 'active', 'paused') OR (r.game_id='splendor' AND r.status='finished')) LIMIT 1
    `).get(sessionId) as { room_id: string; code: string } | undefined;
  }

  private getRoom(roomId: string): RoomRow | undefined {
    return this.database.raw.prepare('SELECT * FROM rooms WHERE id=?').get(roomId) as RoomRow | undefined;
  }

  private getMembers(roomId: string): MemberRow[] {
    return this.database.raw.prepare('SELECT * FROM room_members WHERE room_id=? ORDER BY seat').all(roomId) as MemberRow[];
  }

  private getMember(roomId: string, sessionId: string): MemberRow | undefined {
    return this.database.raw.prepare('SELECT * FROM room_members WHERE room_id=? AND session_id=?').get(roomId, sessionId) as MemberRow | undefined;
  }

  private isOnline(sessionId: string): boolean {
    return (this.connections.get(sessionId)?.size ?? 0) > 0;
  }

  private joinSessionSockets(sessionId: string, roomId: string): void {
    for (const socketId of this.connections.get(sessionId) ?? []) void this.io.sockets.sockets.get(socketId)?.join(roomId);
  }

  private leaveSessionSockets(sessionId: string, roomId: string): void {
    for (const socketId of this.connections.get(sessionId) ?? []) void this.io.sockets.sockets.get(socketId)?.leave(roomId);
  }
}
