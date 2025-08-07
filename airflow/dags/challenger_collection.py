from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator
import requests
import psycopg2
import os

default_args = {
    'owner': 'lol-analyzer',
    'depends_on_past': False,
    'start_date': datetime(2025, 1, 1),
    'retries': 1,
    'retry_delay': timedelta(minutes=5),
}

dag = DAG(
    'challenger_data_collection',
    default_args=default_args,
    description='챌린저 랭킹 데이터 수집',
    schedule_interval='0 */6 * * *',  # 6시간마다
    catchup=False,
)

def collect_challenger_ranking(**context):
    """챌린저 랭킹 수집"""
    api_key = os.getenv('RIOT_API_KEY', 'understand')  # 임시
    
    # Riot API 호출
    url = f"https://kr.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5?api_key={api_key}"
    response = requests.get(url)
    
    if response.status_code == 200:
        data = response.json()
        print(f"✅ 챌린저 {len(data['entries'])}명 데이터 수집 완료")
        
        # DB 저장 로직 추가 예정
        return data['entries'][:10]  # 상위 10명만
    else:
        raise Exception(f"API 호출 실패: {response.status_code}")

collect_task = PythonOperator(
    task_id='collect_challenger_ranking',
    python_callable=collect_challenger_ranking,
    dag=dag,
)