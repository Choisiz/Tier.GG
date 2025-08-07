from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator
import psycopg2
import random

default_args = {
    'owner': 'lol-analyzer',
    'depends_on_past': False,
    'start_date': datetime(2025, 1, 1),
    'retries': 1,
    'retry_delay': timedelta(minutes=2),
}

dag = DAG(
    'test_dummy_data',
    default_args=default_args,
    description='더미 데이터로 테스트',
    schedule_interval=None,  # 수동 실행만
    catchup=False,
)

def create_dummy_players(**context):
    """더미 플레이어 데이터 생성"""
    
    dummy_players = [
        {"puuid": "test1", "playerName": "TestPlayer1", "tier": "CHALLENGER", "lp": 1500},
        {"puuid": "test2", "playerName": "TestPlayer2", "tier": "GRANDMASTER", "lp": 1200},
        {"puuid": "test3", "playerName": "TestPlayer3", "tier": "MASTER", "lp": 800},
    ]
    
    # DB 연결
    try:
        conn = psycopg2.connect(
            host='postgres',
            database='lol_analyzer',
            user='postgres',
            password='understand',
            port=5432
        )
        cursor = conn.cursor()
        
        for player in dummy_players:
            cursor.execute("""
                INSERT INTO players (puuid, "playerName", tier, lp, "createdAt", "updatedAt") 
                VALUES (%s, %s, %s, %s, NOW(), NOW())
                ON CONFLICT (puuid) DO UPDATE SET
                tier = EXCLUDED.tier, lp = EXCLUDED.lp, "updatedAt" = NOW()
            """, (player["puuid"], player["playerName"], player["tier"], player["lp"]))
        
        conn.commit()
        print(f"✅ {len(dummy_players)}명의 더미 플레이어 데이터 생성 완료!")
        
    except Exception as e:
        print(f"❌ DB 작업 실패: {e}")
    finally:
        if conn:
            conn.close()

test_task = PythonOperator(
    task_id='create_dummy_players',
    python_callable=create_dummy_players,
    dag=dag,
)