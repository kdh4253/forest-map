# 유아숲체험원 주소 -> 좌표 (OpenStreetMap Nominatim, 초당 1건 이하로 호출)
# 지번(산1-2 등)까지 포함한 주소로 먼저 찾고, 실패하면 읍면동 단위로 줄여서 대략 위치를 잡는다.
# 결과는 cache 파일에 쌓이므로 중간에 끊겨도 다시 실행하면 이어서 한다.
$ErrorActionPreference = 'Stop'
$here  = Split-Path -Parent $MyInvocation.MyCommand.Path
$rows  = Import-Csv "$here\raw\yoosoop.csv" -Encoding Default
$cache = "$here\geocode_cache.json"
$map = @{}
if (Test-Path $cache) {
  (Get-Content $cache -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $map[$_.Name] = $_.Value }
}
$ua = @{ 'User-Agent' = 'forest-access-map/1.0 (public data contest prototype)'; 'Accept-Language' = 'ko' }

$qcache = @{}
function Find-Place([string]$q) {
  if ($qcache.ContainsKey($q)) { return $qcache[$q] }
  $res = Find-PlaceRemote $q
  $qcache[$q] = $res
  return $res
}
function Find-PlaceRemote([string]$q) {
  Start-Sleep -Milliseconds 1050
  $url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&q=' + [uri]::EscapeDataString($q)
  try { $r = Invoke-RestMethod -Uri $url -Headers $ua -TimeoutSec 20 } catch { return $null }
  if ($r -and $r.Count -gt 0) { return $r[0] } else { return $null }
}

function Get-Candidates([string]$addr) {
  $a = ($addr -replace '\(.*?\)', '' -replace '전남남도', '전라남도' -replace '([가-힣])(\d)', '$1 $2' -replace '\s+', ' ').Trim()
  $parts = $a.Split(' ')
  $c = New-Object System.Collections.Generic.List[string]
  # 도로명주소(…로/길 + 번호)는 정확한 위치가 잡힐 가능성이 있어 먼저 시도.
  # 지번(산1-2 등)은 OSM에 거의 없어서 바로 읍면동리 단위로 찾는다.
  if ($a -match '(로|길)\s*\d') { $c.Add($a) }
  $admin = @()
  foreach ($p in $parts) {
    if ($p -match '^(산\s*)?\d' -or $p -match '^산\d' -or $p -eq '산' -or $p -match '번지|일원|일대|외$') { break }
    if ($p -match '(로|길)$' -and $admin.Count -ge 2) { break }   # 도로명은 행정구역에서 제외
    $admin += $p
  }
  # 동/리 → 읍면 → 시군구 순으로 한 단계씩 줄여 가며 시도
  for ($n = $admin.Count; $n -ge 2; $n--) { $c.Add((($admin[0..($n-1)]) -join ' ')) }
  if ($c.Count -eq 0) { $c.Add($a) }
  return $c | Select-Object -Unique
}

$i = 0
foreach ($r in $rows) {
  $i++
  $addr = $r.'주소'
  if ($map.ContainsKey($addr) -and $map[$addr].level -ne 'fail') { continue }
  $hit = $null; $level = ''
  $cands = @(Get-Candidates $addr)
  for ($k = 0; $k -lt $cands.Count; $k++) {
    $hit = Find-Place $cands[$k]
    if ($hit) { $level = if ($cands[$k] -match '(로|길)\s*\d') { 'exact' } else { 'area' }; break }
  }
  if ($hit) {
    $map[$addr] = [pscustomobject]@{ lat = [double]$hit.lat; lon = [double]$hit.lon; level = $level }
  } else {
    $map[$addr] = [pscustomobject]@{ lat = $null; lon = $null; level = 'fail' }
  }
  if ($i % 10 -eq 0) {
    $map | ConvertTo-Json -Depth 4 | Set-Content $cache -Encoding UTF8
    Write-Output "$i / $($rows.Count)"
  }
}
$map | ConvertTo-Json -Depth 4 | Set-Content $cache -Encoding UTF8
$vals = $map.Values
Write-Output ("done. exact={0} area={1} fail={2}" -f @($vals | ? level -eq 'exact').Count, @($vals | ? level -eq 'area').Count, @($vals | ? level -eq 'fail').Count)
