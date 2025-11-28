BEGIN;
ALTER TABLE IF EXISTS champion RENAME COLUMN champ_id TO champion_id;
ALTER TABLE IF EXISTS champion RENAME COLUMN total_pick_matches TO total_pick;
ALTER TABLE IF EXISTS champion RENAME COLUMN total_wins TO total_win;
ALTER TABLE IF EXISTS champion RENAME COLUMN total_ban_matches TO total_ban;
ALTER TABLE IF EXISTS champion RENAME COLUMN pos_pick_matches TO position_pick;
ALTER TABLE IF EXISTS champion RENAME COLUMN pos_wins TO position_wins;
ALTER TABLE IF EXISTS champion RENAME COLUMN total_pick_rate TO rate_total_pick;
ALTER TABLE IF EXISTS champion RENAME COLUMN total_win_rate TO rate_total_win;
ALTER TABLE IF EXISTS champion RENAME COLUMN total_ban_rate TO rate_total_ban;
ALTER TABLE IF EXISTS champion RENAME COLUMN pos_pick_rate TO rate_position_pick;
ALTER TABLE IF EXISTS champion RENAME COLUMN pos_win_rate TO rate_position_win;
-- created_at -> create_at
ALTER TABLE IF EXISTS champion RENAME COLUMN created_at TO create_at;
COMMIT;


