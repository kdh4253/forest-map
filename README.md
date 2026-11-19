# 내곁숲

휠체어부터 등산화까지, 누구나 갈 수 있는 내 주변 숲 지도.
흩어져 있는 산림공공데이터 여덟 가지를 한 지도에 모아, 지금 위치에서 가까운 순서로 보여 준다.

| 구분 | 데이터 | 제공 | 건수 |
|---|---|---|---|
| 무장애나눔길 | [한국산림복지진흥원_무장애나눔길 조성정보](https://www.data.go.kr/data/15063418/fileData.do) | 한국산림복지진흥원 | 167 |
| 유아숲체험원 | [산림청_유아숲체험원 현황](https://www.data.go.kr/data/15081674/fileData.do) | 산림청 | 499 |
| 자연휴양림 | [전국휴양림표준데이터](https://www.data.go.kr/data/15013111/standard.do) | 공공데이터포털(전국 지자체) | 186 |
| 등산코스 | [한국등산트레킹지원센터_산림청 100대명산](https://www.data.go.kr/data/15098177/fileData.do) (GPX) | 한국등산트레킹지원센터 | 100산 · 607코스 |
| 숲길·둘레길 | [국가숲길 코스](https://www.data.go.kr/data/15108080/fileData.do), [오감만족 숲길](https://www.data.go.kr/data/15098179/fileData.do) (GPX) | 한국등산트레킹지원센터 | 9곳 · 69구간 |
| 종주길 | [백두대간 종주길](https://www.data.go.kr/data/15098180/fileData.do), [9정맥 종주코스](https://www.data.go.kr/data/15098181/fileData.do) (GPX) | 한국등산트레킹지원센터 | 16곳 · 61구간 |

## 기능
- 내 위치 기준 가까운 숲 목록, 반경 10km 요약
- 종류별 필터, 숙박 가능 휴양림 필터, 쉬운 코스가 있는 산 필터, 이름·지역 검색
- 등산코스를 누르면 실제 경로를 지도에 표시 (난이도는 거리·높이차 기준 참고값)
- 상세 정보(길이·조성연도, 운영기간·참여방법, 숙박·입장료·시설), 전화 걸기, 카카오맵 길찾기
- 글자 크게 보기, 키보드 조작, 다크 모드, 모바일 바텀시트
- 장소별 공유 링크 (`#p=bf12` 형식)

## 구조
```
index.html            화면
assets/style.css      스타일
assets/app.js         지도·목록 로직 (Leaflet + MarkerCluster, 빌드 도구 없음)
data/places.json      앱이 읽는 통합 데이터
data/raw/             공공데이터포털 원본
data/fetch.sh         원본 다운로드 (bash fetch.sh <데이터번호> <파일>)
data/geocode.ps1      유아숲 주소 → 좌표 (OpenStreetMap Nominatim)
data/build-mountains.ps1  100대명산 GPX → mountains.json(산별 요약) + routes.json(코스 경로)
data/build-data.ps1   원본 4종 → places.json
data/routes.json      등산코스 경로 (코스를 처음 누를 때 불러옴)
serve.ps1             로컬 미리보기 서버 (http://localhost:8080)
```

## 데이터 갱신
```powershell
powershell -ExecutionPolicy Bypass -File data\geocode.ps1
powershell -ExecutionPolicy Bypass -File data\build-mountains.ps1
powershell -ExecutionPolicy Bypass -File data\build-trails.ps1
powershell -ExecutionPolicy Bypass -File data\build-data.ps1
```

## 배포 (GitHub Pages)
1. GitHub에서 새 저장소를 만든다 (Public).
2. 이 폴더의 파일을 업로드한다 (`.claude` 폴더는 빼도 됨).
3. 저장소 Settings → Pages → Branch를 `main` / `(root)`로 두고 Save.
4. 1~2분 뒤 `https://<아이디>.github.io/<저장소>/` 로 열린다.

## 참고
- 유아숲체험원은 원본에 좌표가 없어 주소를 변환했다. 지번 주소는 OSM에서 번지까지 찾기 어려워 대부분 읍·면·동 중심의 **대략 위치**이며, 지도에 속이 빈 고리 모양으로 표시한다.
- 무장애나눔길 원본의 연번 69·70(주소/좌표 뒤바뀜), 78~80(한 행씩 밀림), 115(기관명 오타)는 `build-data.ps1`에서 보정한다. 원본 파일은 그대로 둔다.
- 지도 타일 © OpenStreetMap contributors.
