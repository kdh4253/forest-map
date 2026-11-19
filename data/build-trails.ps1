# 숲길·종주길 GPX(한국등산트레킹지원센터) -> trails.json(길별 요약) + trail_routes.json(코스 경로)
#   trail = 숲길·둘레길 : 국가숲길 코스(15108080) + 오감만족 숲길(15098179, 내포문화숲길은 국가숲길과 겹쳐 제외)
#   ridge = 종주길       : 백두대간 종주길(15098180) + 9정맥 종주코스(15098181)
# 길 하나 = 지도 핀 하나(첫 코스 출발점), 그 안에 코스 목록.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$raw  = "$here\raw"
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-Km($a1, $o1, $a2, $o2) {
  $r = [math]::PI / 180
  $dLat = ($a2 - $a1) * $r; $dLon = ($o2 - $o1) * $r
  $h = [math]::Pow([math]::Sin($dLat / 2), 2) + [math]::Cos($a1 * $r) * [math]::Cos($a2 * $r) * [math]::Pow([math]::Sin($dLon / 2), 2)
  return 6371 * 2 * [math]::Asin([math]::Sqrt($h))
}

# 압축 해제 (없을 때만)
foreach ($n in 'nationaltrail', 'ogam', 'baekdu', 'jeongmaek') {
  if (-not (Test-Path "$raw\gpx_$n")) { [IO.Compression.ZipFile]::ExtractToDirectory("$raw\$n.zip", "$raw\gpx_$n") }
}

# 국가숲길 코스 이름표 (엑셀)
$legend = @{}
$xl = Get-ChildItem "$raw\gpx_nationaltrail" -Filter *.xlsx | Select-Object -First 1
if ($xl) {
  $z = [IO.Compression.ZipFile]::OpenRead($xl.FullName)
  $rd = New-Object IO.StreamReader(($z.Entries | ? FullName -eq 'xl/sharedStrings.xml').Open()); [xml]$s = $rd.ReadToEnd(); $rd.Close()
  $strings = @($s.sst.si | % { if ($_.t -is [string]) { $_.t } elseif ($_.t.'#text') { $_.t.'#text' } else { ($_.r | % { if ($_.t -is [string]) { $_.t } else { $_.t.'#text' } }) -join '' } })
  $rd = New-Object IO.StreamReader(($z.Entries | ? FullName -eq 'xl/worksheets/sheet1.xml').Open()); [xml]$w = $rd.ReadToEnd(); $rd.Close(); $z.Dispose()
  $cur = ''
  foreach ($row in ($w.worksheet.sheetData.row | Select-Object -Skip 1)) {
    $cells = @{}
    foreach ($c in $row.c) { $col = ($c.r -replace '\d', ''); $cells[$col] = if ($c.t -eq 's') { $strings[[int]$c.v] } else { $c.v } }
    if ($cells['A']) { $cur = $cells['A'].Trim() }
    if ($cells['B'] -and $cells['C']) { $legend["$cur|$($cells['C'])"] = ($cells['B'].Trim() -replace '대관련숲길', '대관령숲길') }
  }
}

function Read-Course([string]$file) {
  [xml]$x = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)
  # 한 코스가 여러 조각(trkseg)으로 나뉘고 순서가 섞인 파일이 있어(9정맥 등),
  # 거리는 조각 안에서만 재고 경로도 조각별로 따로 저장한다.
  $km = 0.0; $maxEle = -1; $startEle = $null; $nPts = 0
  $segs = New-Object System.Collections.Generic.List[object]
  foreach ($sg in $x.SelectNodes('//*[local-name()="trkseg"]')) {
    $pts = $sg.SelectNodes('*[local-name()="trkpt"]')
    if ($pts.Count -lt 2) { continue }
    $seg = New-Object System.Collections.Generic.List[object]
    $plat = $null; $plon = $null
    foreach ($p in $pts) {
      $lat = [double]$p.GetAttribute('lat'); $lon = [double]$p.GetAttribute('lon')
      if ($null -ne $plat) { $km += Get-Km $plat $plon $lat $lon }
      $plat = $lat; $plon = $lon
      $e = $p.SelectSingleNode('*[local-name()="ele"]'); $ele = if ($e) { [double]$e.InnerText } else { 0 }
      if ($ele -gt 0) { if ($null -eq $startEle) { $startEle = $ele }; if ($ele -gt $maxEle) { $maxEle = $ele } }
      $seg.Add(@($lat, $lon))
    }
    $segs.Add($seg); $nPts += $seg.Count
  }
  if (-not $segs.Count) { return $null }
  # 경로 단순화: 길이에 비례해 전체 60~400개 지점 (조각마다 처음·끝 점은 유지)
  $target = [math]::Min(400, [math]::Max(60, [int]($km * 3)))
  $step = [math]::Max(1, [math]::Ceiling($nPts / $target))
  $coords = New-Object System.Collections.Generic.List[object]
  foreach ($seg in $segs) {
    $s = New-Object System.Collections.Generic.List[object]
    for ($i = 0; $i -lt $seg.Count; $i += $step) { $s.Add(@([math]::Round($seg[$i][0], 5), [math]::Round($seg[$i][1], 5))) }
    $last = $seg[$seg.Count - 1]; $s.Add(@([math]::Round($last[0], 5), [math]::Round($last[1], 5)))
    $coords.Add($s)
  }
  $cats = @{}
  foreach ($wp in $x.SelectNodes('//*[local-name()="wpt"]')) {
    $c = $wp.SelectSingleNode('*[local-name()="extensions"]/*[local-name()="category"]'); if ($c) { $cats[$c.InnerText.Trim()] = $true }
  }
  $rise = if ($null -ne $startEle -and $maxEle -gt 0) { [int][math]::Round([math]::Max(0, $maxEle - $startEle)) } else { $null }
  $level = if ($null -eq $rise) { if ($km -le 5) { 'easy' } elseif ($km -ge 12) { 'hard' } else { 'mid' } }
           elseif ($km -le 5 -and $rise -lt 300) { 'easy' } elseif ($km -ge 12 -or $rise -ge 700) { 'hard' } else { 'mid' }
  return @{ km = [math]::Round($km, 1); rise = $rise; level = $level; coords = $coords
            start = $coords[0][0]; park = [bool]$cats['PARK']; toilet = [bool]$cats['TOILET']; bus = [bool]$cats['TRANS'] }
}

$places = New-Object System.Collections.Generic.List[object]
$routes = [ordered]@{}
$seq = @{ trail = 0; ridge = 0 }

function Add-Group([string]$cat, [string]$name, [object[]]$files, [scriptblock]$courseLabel, [string]$source) {
  $seq[$cat]++
  $pid_ = "$cat$($seq[$cat])"
  $courses = New-Object System.Collections.Generic.List[object]
  $ci = 0
  foreach ($f in $files) {
    $c = Read-Course $f.FullName
    if (-not $c) { continue }
    $ci++
    $cid = "$pid_-$ci"
    $routes[$cid] = $c.coords
    $courses.Add([ordered]@{
      id = $cid; from = (& $courseLabel $f); km = $c.km; rise = $c.rise; level = $c.level
      park = $c.park; toilet = $c.toilet; bus = $c.bus; start = $c.start
    })
  }
  if (-not $courses.Count) { return }
  $places.Add([ordered]@{
    id = $pid_; cat = $cat; name = $name; addr = ''; src = $source
    lat = $courses[0].start[0]; lon = $courses[0].start[1]; courses = $courses
  })
  $total = 0.0; foreach ($c in $courses) { $total += $c.km }
  Write-Output ("{0,-7} {1}: {2}코스, 총 {3:N0}km" -f $pid_, $name, $courses.Count, $total)
}

# 1) 국가숲길
foreach ($d in (Get-ChildItem "$raw\gpx_nationaltrail" -Directory | Sort-Object Name)) {
  $tname = $d.Name -replace '^\d+_', ''
  $files = Get-ChildItem $d.FullName -Filter *.gpx | Sort-Object Name
  Add-Group 'trail' $tname $files { param($f) $cid = ($f.BaseName -split '_')[-1]; $n = $legend["$tname|$cid"]; if ($n) { $n -replace '_', ' ' } else { "$([int]$cid)코스" } } '국가숲길'
}
# 2) 오감만족 숲길 (내포문화숲길 제외)
foreach ($d in (Get-ChildItem "$raw\gpx_ogam" -Directory | Sort-Object Name)) {
  $tname = $d.Name -replace '^\d+\.', ''
  if ($tname -match '내포') { continue }
  $files = Get-ChildItem $d.FullName -Filter *.gpx | Sort-Object { [int](($_.BaseName -replace '\D', '') + '0') }, Name
  Add-Group 'trail' $tname $files { param($f) $b = $f.BaseName -replace "^$([regex]::Escape($tname))[_ ]?", ''; if ($b) { $b } else { $tname } } '오감만족 숲길'
}
# 3) 백두대간 종주길 (권역별)
foreach ($d in (Get-ChildItem "$raw\gpx_baekdu" -Directory | Sort-Object Name)) {
  $tname = $d.Name -replace '^\d+\.', ''
  $files = Get-ChildItem $d.FullName -Filter *.gpx | Sort-Object { [int](([regex]::Match($_.BaseName, '(\d+)코스').Groups[1].Value) + 0) }
  Add-Group 'ridge' $tname $files { param($f)
    $m = [regex]::Match($f.BaseName, '(\d+코스)_?\(?([^)]*)\)?'); $lab = $m.Groups[1].Value
    $sub = ($m.Groups[2].Value -replace '_$', '' -replace '_', '~').Trim('~ ')
    if ($sub) { "$lab ($sub)" } else { $lab } } '백두대간 종주길'
}
# 4) 9정맥 (정맥별 1코스)
foreach ($d in (Get-ChildItem "$raw\gpx_jeongmaek" -Directory | Sort-Object Name)) {
  $tname = $d.Name
  $files = Get-ChildItem $d.FullName -Filter *.gpx | Sort-Object Name
  Add-Group 'ridge' $tname $files { param($f) '전 구간' } '9정맥 종주코스'
}

$enc = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText("$here\trails.json", ($places | ConvertTo-Json -Depth 6 -Compress), $enc)
[IO.File]::WriteAllText("$here\trail_routes.json", ($routes | ConvertTo-Json -Depth 5 -Compress), $enc)
Write-Output ("trails: {0}곳 (trail {1}, ridge {2}), 코스 {3}개" -f $places.Count, $seq.trail, $seq.ridge, $routes.Count)
