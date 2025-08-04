CREATE TABLE IF NOT EXISTS players (
    puuid VARCHAR(80) PRIMARY KEY,
    player_name VARCHAR(20) NOT NULL,
    tier VARCHAR(20),
    rank_value VARCHAR(20),
    lp INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_player_name ON players(player_name);