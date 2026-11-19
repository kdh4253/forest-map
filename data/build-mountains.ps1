# 100대명산 코스 GPX(한국등산트레킹지원센터) -> mountains.json(산별 요약) + mtn_routes.json(코스 경로)
# 산 하나 = 지도 핀 하나(가장 높은 지점), 코스별 길이·누적 오르막·예상 소요시간·편의시설을 계산한다.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src  = "$here\raw\mountain100\100대명산"
$GPXNS = 'http://www.topografix.com/GPX/1/1'

function Get-Km($a1, $o1, $a2, $o2) {
  $r = [math]::PI / 180
  $dLat = ($a2 - $a1) * $r; $dLon = ($o2 - $o1) * $r
  $h = [math]::Pow([math]::Sin($dLat / 2), 2) + [math]::Cos($a1 * $r) * [math]::Cos($a2 * $r) * [math]::Pow([math]::Sin($dLon / 2), 2)
  return 6371 * 2 * [math]::Asin([math]::Sqrt($h))
}
function CData($n) { if ($null -eq $n) { return '' }; $v = $n.'#cdata-section'; if ($v) { return ($v -replace '\s+', ' ').Trim() }; return ([string]$n.InnerText).Trim() }

$mountains = New-Object System.Collections.Generic.List[object]
$routes = [ordered]@{}
$mi = 0
foreach ($dir in (Get-ChildItem $src -Directory | Sort-Object Name)) {
  $mi++
  $mid = "mtn$mi"
  $courses = New-Object System.Collections.Generic.List[object]
  $peak = $null
  $ci = 0
  foreach ($f in (Get-ChildItem $dir.FullName -Filter *.gpx | Sort-Object Name)) {
    [xml]$x = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8)
    $ns = New-Object Xml.XmlNamespaceManager $x.NameTable; $ns.AddNamespace('g', $GPXNS)
    $pts = $x.SelectNodes('//g:trkpt', $ns)
    if ($pts.Count -lt 2) { continue }
    $ci++
    $km = 0.0; $maxEle = -1; $startEle = $null
    $plat = $null; $plon = $null
    $coords = New-Object System.Collections.Generic.List[object]
    $step = [math]::Max(1, [math]::Ceiling($pts.Count / 80))
    for ($i = 0; $i -lt $pts.Count; $i++) {
      $p = $pts[$i]
      $lat = [double]$p.lat; $lon = [double]$p.lon
      $eleNode = $p.SelectSingleNode('g:ele', $ns); $ele = if ($eleNode) { [double]$eleNode.InnerText } else { 0 }
      if ($null -ne $plat) { $km += Get-Km $plat $plon $lat $lon }
      $plat = $lat; $plon = $lon
      if ($ele -gt 0) {
        if ($null -eq $startEle) { $startEle = $ele }
        if ($ele -gt $maxEle) {
          $maxEle = $ele
          if ($null -eq $peak -or $ele -gt $peak.ele) { $peak = @{ lat = $lat; lon = $lon; ele = $ele } }
        }
      }
      if ($i % $step -eq 0 -or $i -eq $pts.Count - 1) { $coords.Add(@([math]::Round($lat, 5), [math]::Round($lon, 5))) }
    }
    $cats = @{}; $entry = $null
    foreach ($w in $x.SelectNodes('//g:wpt', $ns)) {
      $cat = CData ($w.SelectSingleNode('g:extensions/g:category', $ns))
      $cats[$cat] = $true
      if ($cat -eq 'ENTRY' -and -not $entry) { $entry = CData ($w.SelectSingleNode('g:name', $ns)) }
    }
    # GPS 고도는 흔들림이 커서 누적 오르막 대신 '출발점 대비 최고점 높이차'만 쓴다.
    $rise = if ($null -ne $startEle -and $maxEle -gt 0) { [int][math]::Round([math]::Max(0, $maxEle - $startEle)) } else { $null }
    # 체감 난이도(참고값): 거리와 높이차 기준
    $level = if ($null -eq $rise) { if ($km -le 5) { 'easy' } elseif ($km -ge 12) { 'hard' } else { 'mid' } }
             elseif ($km -le 5 -and $rise -lt 300) { 'easy' }
             elseif ($km -ge 12 -or $rise -ge 700) { 'hard' } else { 'mid' }
    $cid = "$mid-$ci"
    $routes[$cid] = $coords
    $courses.Add([ordered]@{
      id = $cid; from = $entry; km = [math]::Round($km, 1); rise = $rise; level = $level
      park = [bool]$cats['PARK']; toilet = [bool]$cats['TOILET']; bus = [bool]$cats['TRANS']
      start = @([math]::Round([double]$pts[0].lat, 5), [math]::Round([double]$pts[0].lon, 5))
    })
  }
  if (-not $courses.Count) { continue }
  if (-not $peak) {   # 고도 기록이 없는 산은 첫 코스 경로의 중간 지점을 대표 위치로
    $mid0 = $routes[$courses[0].id]; $c0 = $mid0[[int]($mid0.Count / 2)]
    $peak = @{ lat = $c0[0]; lon = $c0[1]; ele = 0 }
  }
  $mountains.Add([ordered]@{
    id = $mid; cat = 'mtn'; name = $dir.Name; addr = ''
    lat = [math]::Round($peak.lat, 5); lon = [math]::Round($peak.lon, 5)
    courses = $courses
  })
  Write-Output ("{0,3} {1}: {2}코스" -f $mi, $dir.Name, $courses.Count)
}
$enc = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText("$here\mountains.json", ($mountains | ConvertTo-Json -Depth 6 -Compress), $enc)
[IO.File]::WriteAllText("$here\mtn_routes.json", ($routes | ConvertTo-Json -Depth 4 -Compress), $enc)
Write-Output "mountains: $($mountains.Count), courses: $($routes.Count)"
