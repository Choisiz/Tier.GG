# GET /api/champion_images

LoL 챔피언 이미지 URL 목록을 반환합니다.

---

## ✅ 요청

- **Method**: `GET`
- **Query Params**:
  - `version` (선택): 데이터 드래곤 버전 (예: `15.11.1`)
  - `lang` (선택): 언어 코드 (기본: `ko_KR`)

### 성공 (200)
```json
{
  "version": "15.11.1",
  "championImageUrls": [
    {
      "name": "Ahri",
      "url": "https://ddragon.leagueoflegends.com/cdn/15.11.1/img/champion/Ahri.png"
    }
    // ...
  ]
}
```