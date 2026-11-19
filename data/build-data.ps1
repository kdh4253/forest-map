# 원본 3종을 하나의 places.json으로 합친다.
#   bf  = 무장애나눔길 (한국산림복지진흥원)
#   kid = 유아숲체험원 (산림청)            * 주소만 있어 geocode.ps1 결과를 사용
#   rec = 자연휴양림 (전국휴양림표준데이터)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$raw  = "$here\raw"
$out  = New-Object System.Collections.Generic.List[object]

function Clean([string]$s) { if ($null -eq $s) { return '' } ($s -replace '\s+', ' ').Trim() }

# 1) 무장애나눔길
$bfRows = Import-Csv "$raw\barrierfree.csv" -Encoding Default
# 원본 오류 보정 (원본 파일은 그대로 두고 여기서만 고친다)
#  - 69·70: 주소/좌표가 서로 뒤바뀜 (물향기수목원 = 오산시 청학로 211, 곰솔누리숲 = 시흥시 정왕동)
#  - 78·79·80: 주소/좌표가 한 행씩 밀림 (진도 사천리 / 광양 칠성리 / 목포 산정동)
#  - 115: 관리기관 '경상북도 여양군' → '경상북도 영양군'
$byNo = @{}; foreach ($r in $bfRows) { $byNo[$r.'연번'] = $r }
$geoCols = '주소', '위도(도)', '경도(도)'
function Get-Geo($r) { $o = @{}; foreach ($c in $geoCols) { $o[$c] = $r.$c }; $o }
function Set-Geo($r, $g) { foreach ($c in $geoCols) { $r.$c = $g[$c] } }
if ($byNo['69'].'사업명' -match '곰솔' -and $byNo['69'].'주소' -match '오산') {
  $g69 = Get-Geo $byNo['69']; $g70 = Get-Geo $byNo['70']; Set-Geo $byNo['69'] $g70; Set-Geo $byNo['70'] $g69
}
if ($byNo['79'].'사업명' -match '광양' -and $byNo['79'].'주소' -match '진도') {
  $g78 = Get-Geo $byNo['78']; $g79 = Get-Geo $byNo['79']; $g80 = Get-Geo $byNo['80']
  Set-Geo $byNo['78'] $g79; Set-Geo $byNo['79'] $g80; Set-Geo $byNo['80'] $g78
}
if ($byNo['115'].'관리기관' -match '여양군') { $byNo['115'].'관리기관' = $byNo['115'].'관리기관' -replace '여양군', '영양군' }

foreach ($r in $bfRows) {
  $lat = [double]$r.'위도(도)'; $lon = [double]$r.'경도(도)'
  if (-not $lat -or -not $lon) { continue }
  $out.Add([ordered]@{
    id = "bf$($r.'연번')"; cat = 'bf'; name = (Clean $r.'사업명'); addr = (Clean $r.'주소')
    lat = [math]::Round($lat, 5); lon = [math]::Round($lon, 5)
    year = [int]$r.'조성연도'; len = [int]$r.'조성길이(m)'; org = (Clean $r.'관리기관')
  })
}

# 2) 유아숲체험원
$geo = @{}
if (Test-Path "$here\geocode_cache.json") {
  (Get-Content "$here\geocode_cache.json" -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $geo[$_.Name] = $_.Value }
}
$seen = @{}; $k = 0; $skipped = 0
foreach ($r in (Import-Csv "$raw\yoosoop.csv" -Encoding Default)) {
  $name = Clean $r.'시설명'; $addr = Clean $r.'주소'
  $key = "$name|$addr"
  if ($seen.ContainsKey($key)) { continue }; $seen[$key] = 1
  $g = $geo[$r.'주소']
  if (-not $g -or $null -eq $g.lat) { $skipped++; continue }
  $k++
  $out.Add([ordered]@{
    id = "kid$k"; cat = 'kid'; name = $name; addr = $addr
    lat = [math]::Round([double]$g.lat, 5); lon = [math]::Round([double]$g.lon, 5)
    approx = ($g.level -ne 'exact')
    period = (Clean $r.'운영기간'); tel = (Clean $r.'전화번호'); how = (Clean $r.'참여방법')
  })
}

# 3) 자연휴양림
$h = Get-Content "$raw\hyuyang_std.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$k = 0
foreach ($r in $h) {
  $lat = [double]$r.LATITUDE; $lon = [double]$r.LONGITUDE
  if (-not $lat -or -not $lon) { continue }
  $k++
  $out.Add([ordered]@{
    id = "rec$k"; cat = 'rec'; name = (Clean $r.RCRFRST_NM); addr = (Clean $r.RDNMADR)
    lat = [math]::Round($lat, 5); lon = [math]::Round($lon, 5)
    own = (Clean $r.RCRFRST_TYPE); stay = ($r.STAYNG_POSBL_YN -eq 'Y')
    fee = ((Clean $r.ADMFEE) -replace '\+', ' · '); fac = ((Clean $r.MAIN_FCLTY_NM) -replace '\+', ', ')
    cap = (Clean $r.ACEPTNC_CO); tel = (Clean $r.TELEPHONE_NUMBER); url = (Clean $r.HOMEPAGE_URL)
    org = (Clean $r.INSTITUTION_NM)
  })
}

# 4) 100대명산 등산코스 (build-mountains.ps1 결과)
if (Test-Path "$here\mountains.json") {
  foreach ($m in (Get-Content "$here\mountains.json" -Raw -Encoding UTF8 | ConvertFrom-Json)) { $out.Add($m) }
}

$meta = [ordered]@{
  built = (Get-Date -Format 'yyyy-MM-dd')
  sources = @(
    [ordered]@{ cat = 'bf';  title = '한국산림복지진흥원_무장애나눔길 조성정보'; url = 'https://www.data.go.kr/data/15063418/fileData.do'; ref = '2026-03-25' },
    [ordered]@{ cat = 'kid'; title = '산림청_유아숲체험원 현황';               url = 'https://www.data.go.kr/data/15081674/fileData.do'; ref = '2025-11-30' },
    [ordered]@{ cat = 'rec'; title = '전국휴양림표준데이터';                  url = 'https://www.data.go.kr/data/15013111/standard.do'; ref = '2026-09' },
    [ordered]@{ cat = 'mtn'; title = '한국등산트레킹지원센터_산림청 100대명산'; url = 'https://www.data.go.kr/data/15098177/fileData.do'; ref = '2022-01-12' }
  )
}
$json = [ordered]@{ meta = $meta; places = $out } | ConvertTo-Json -Depth 8 -Compress
[IO.File]::WriteAllText("$here\places.json", $json, (New-Object Text.UTF8Encoding $false))
Write-Output ("places.json: bf={0} kid={1} rec={2} mtn={3} (kid skipped without coords: {4})" -f `
  @($out | ? { $_.cat -eq 'bf' }).Count, @($out | ? { $_.cat -eq 'kid' }).Count, @($out | ? { $_.cat -eq 'rec' }).Count, @($out | ? { $_.cat -eq 'mtn' }).Count, $skipped)
