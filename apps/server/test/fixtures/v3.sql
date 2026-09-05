CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at_ms INTEGER NOT NULL) STRICT;

      CREATE TABLE IF NOT EXISTS guest_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        game_id TEXT NOT NULL CHECK (game_id IN ('gomoku', 'quoridor', 'twenty-four')),
        status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'paused', 'finished')),
        version INTEGER NOT NULL DEFAULT 0,
        round_no INTEGER NOT NULL DEFAULT 0,
        state_schema_version INTEGER NOT NULL DEFAULT 1,
        state_json TEXT,
        pause_reason TEXT CHECK (pause_reason IS NULL OR pause_reason IN ('disconnect', 'restart')),
        paused_remaining_ms INTEGER,
        restart_deadline_ms INTEGER,
        next_round_at_ms INTEGER,
        finish_reason TEXT,
        created_at_ms INTEGER NOT NULL,
        last_activity_ms INTEGER NOT NULL,
        cleanup_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS room_members (
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        seat INTEGER NOT NULL CHECK (seat IN (0, 1)),
        session_id TEXT NOT NULL REFERENCES guest_sessions(id) ON DELETE RESTRICT,
        nickname TEXT NOT NULL,
        nickname_key TEXT NOT NULL,
        ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1)),
        rematch_ready INTEGER NOT NULL DEFAULT 0 CHECK (rematch_ready IN (0, 1)),
        joined_at_ms INTEGER NOT NULL,
        disconnected_at_ms INTEGER,
        disconnect_deadline_ms INTEGER,
        disconnect_order INTEGER,
        restart_rejoined_at_ms INTEGER,
        PRIMARY KEY (room_id, seat),
        UNIQUE (room_id, session_id),
        UNIQUE (room_id, nickname_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS processed_actions (
        session_id TEXT NOT NULL REFERENCES guest_sessions(id) ON DELETE CASCADE,
        action_id TEXT NOT NULL,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        request_hash TEXT NOT NULL,
        expected_version INTEGER NOT NULL,
        outcome_json TEXT NOT NULL,
        resulting_version INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY (session_id, action_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON guest_sessions(expires_at_ms);
      CREATE INDEX IF NOT EXISTS idx_rooms_cleanup ON rooms(status, cleanup_at_ms);
      CREATE INDEX IF NOT EXISTS idx_members_session ON room_members(session_id);
      CREATE INDEX IF NOT EXISTS idx_members_disconnect ON room_members(disconnect_deadline_ms);
      CREATE INDEX IF NOT EXISTS idx_actions_room ON processed_actions(room_id);
    

      CREATE TABLE IF NOT EXISTS server_runtime (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        heartbeat_at_ms INTEGER NOT NULL
      ) STRICT;
    

      CREATE TABLE IF NOT EXISTS room_messages (
        sequence INTEGER PRIMARY KEY,
        message_id TEXT NOT NULL UNIQUE,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        sender_session_id TEXT NOT NULL,
        seat INTEGER NOT NULL CHECK (seat IN (0, 1)),
        nickname TEXT NOT NULL,
        content TEXT NOT NULL,
        sent_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_room_messages_room_sequence
        ON room_messages(room_id, sequence);
    
INSERT INTO schema_migrations VALUES (1,'initial_schema',1000),(2,'server_runtime_heartbeat',1000),(3,'room_messages',1000);
