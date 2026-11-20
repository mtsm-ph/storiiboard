# The HEIC measurements (Kevin, Nov 19; .github/workflows/measure-heic.yml, Windows job): what our own ffprobe says
# about each HEIC the Mac runner made from scripts/heicFixtures.ts's drawings, whether our own ffmpeg can scale inside
# the tile grid's filter graph (probe A, with a piped fallback), each proof patch's code values after it, and the time
# and peak memory of each sidecar run at 12 and 48 MP. Every value it prints comes from those drawings.
#
#   ./scripts/measureHeic.ps1 -Pictures <folder> -Out <folder> -Bin <folder with ffmpeg and ffprobe>
#
# Runs in PowerShell 7 on the runner and in Windows PowerShell 5.1 (no newer syntax). Peak memory is each process's
# PeakWorkingSet64 polled every 20 ms, and also read once from the process's own handle after it exits (psapi's
# GetProcessMemoryInfo): a process shorter than one poll shows only the second.

param(
  [Parameter(Mandatory = $true)] [string] $Pictures,
  [Parameter(Mandatory = $true)] [string] $Out,
  [Parameter(Mandatory = $true)] [string] $Bin,
  [int] $Runs = 5,
  [string] $Extension = 'heic',
  [int] $LongEdge = 2560,
  [int] $TimeoutSeconds = 600,
  # Skips probe A and goes straight to the piped pair, so that path can be tried where probe A works.
  [switch] $PipedOnly
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Pictures = (Resolve-Path $Pictures).Path
$Out = (Resolve-Path $Out).Path
$ffmpeg = (Get-ChildItem -Path $Bin -Filter 'ffmpeg*.exe' | Select-Object -First 1).FullName
$ffprobe = (Get-ChildItem -Path $Bin -Filter 'ffprobe*.exe' | Select-Object -First 1).FullName
if (-not $ffmpeg -or -not $ffprobe) { throw "No ffmpeg or ffprobe in $Bin" }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HeicMeasure {
  [StructLayout(LayoutKind.Sequential)]
  public struct Counters {
    public uint cb; public uint PageFaultCount; public UIntPtr PeakWorkingSetSize; public UIntPtr WorkingSetSize;
    public UIntPtr QuotaPeakPagedPoolUsage; public UIntPtr QuotaPagedPoolUsage; public UIntPtr QuotaPeakNonPagedPoolUsage;
    public UIntPtr QuotaNonPagedPoolUsage; public UIntPtr PagefileUsage; public UIntPtr PeakPagefileUsage;
  }
  [DllImport("psapi.dll", SetLastError = true)]
  static extern bool GetProcessMemoryInfo(IntPtr process, ref Counters counters, uint size);
  // The peak working set from the process's handle; it still answers after the process has exited.
  public static long Peak(IntPtr handle) {
    Counters c = new Counters();
    c.cb = (uint)Marshal.SizeOf(typeof(Counters));
    if (!GetProcessMemoryInfo(handle, ref c, c.cb)) return -1;
    return (long)c.PeakWorkingSetSize.ToUInt64();
  }
  // The mean of each channel of a rectangle of 8-bit RGB pixels.
  public static double[] Mean(byte[] rgb, int width, int x, int y, int w, int h) {
    double[] sum = new double[3];
    for (int row = y; row < y + h; row++)
      for (int col = x; col < x + w; col++)
        for (int i = 0; i < 3; i++) sum[i] += rgb[(row * width + col) * 3 + i];
    for (int i = 0; i < 3; i++) sum[i] = Math.Round(sum[i] / (w * h) * 10) / 10;
    return sum;
  }
}
'@

function Say([string] $Text = '') { Write-Output $Text }

function Quote([string] $Arg) { '"' + ($Arg -replace '"', '\"') + '"' }

function New-Process([string] $Exe, [string[]] $Arguments, [bool] $In, [bool] $OutPipe) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $Exe
  $info.Arguments = ($Arguments | ForEach-Object { Quote $_ }) -join ' '
  $info.UseShellExecute = $false
  $info.RedirectStandardInput = $In
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.CreateNoWindow = $true
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $info
  [void] $p.Start()
  $h = $p.Handle # Taken now, so the handle stays open for the peak after exit.
  $entry = [ordered]@{ Process = $p; Handle = $h; Polled = [long]0; Error = $null; Output = $null; Name = [IO.Path]::GetFileNameWithoutExtension($Exe) -replace '-.*$', '' }
  $entry.Error = $p.StandardError.ReadToEndAsync()
  if (-not $OutPipe) { $entry.Output = $p.StandardOutput.ReadToEndAsync() }
  return $entry
}

function Watch-Processes($Entries, [scriptblock] $Tick) {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  while ($true) {
    $running = $false
    foreach ($e in $Entries) {
      if (-not $e.Process.HasExited) {
        $running = $true
        try { $e.Process.Refresh(); if ($e.Process.PeakWorkingSet64 -gt $e.Polled) { $e.Polled = $e.Process.PeakWorkingSet64 } } catch { }
      }
    }
    if ($Tick) { & $Tick }
    if (-not $running) { break }
    if ($clock.Elapsed.TotalSeconds -gt $TimeoutSeconds) {
      foreach ($e in $Entries) { if (-not $e.Process.HasExited) { $e.Process.Kill() } }
      throw "Timed out after $TimeoutSeconds s"
    }
    Start-Sleep -Milliseconds 20
  }
  foreach ($e in $Entries) { $e.Process.WaitForExit() }
}

function Result($e) {
  $p = $e.Process
  [pscustomobject]@{
    Name = $e.Name
    ExitCode = $p.ExitCode
    WallMs = [math]::Round(($p.ExitTime - $p.StartTime).TotalMilliseconds)
    PolledMB = [math]::Round($e.Polled / 1MB, 1)
    AtExitMB = [math]::Round([HeicMeasure]::Peak($e.Handle) / 1MB, 1)
    Stdout = $(if ($e.Output) { $e.Output.Result } else { '' })
    Stderr = $e.Error.Result.Trim()
    Start = $p.StartTime
    Exit = $p.ExitTime
  }
}

# One process: its result, stdout captured.
function Invoke-One([string] $Exe, [string[]] $Arguments) {
  $e = New-Process $Exe $Arguments $false $false
  Watch-Processes @($e) $null
  return , @(Result $e)
}

# Two processes joined by a pipe (the first's stdout into the second's stdin), copied here so both are ours to watch.
function Invoke-Pair([string[]] $First, [string[]] $Second) {
  $a = New-Process $ffmpeg $First $false $true
  $b = New-Process $ffmpeg $Second $true $false
  $copy = $a.Process.StandardOutput.BaseStream.CopyToAsync($b.Process.StandardInput.BaseStream, 1MB)
  $state = @{ Closed = $false }
  $tick = {
    if ($copy.IsCompleted -and -not $state.Closed) { try { $b.Process.StandardInput.Close() } catch { }; $state.Closed = $true }
    # The second gave up: nothing reads the first any more, so it would wait for ever.
    if ($b.Process.HasExited -and -not $a.Process.HasExited -and $copy.IsCompleted) { $a.Process.Kill() }
  }
  Watch-Processes @($a, $b) $tick
  return , @((Result $a), (Result $b))
}

function Get-Probe([string] $File) {
  $r = (Invoke-One $ffprobe @('-v', 'error', '-of', 'json', '-show_streams', '-show_stream_groups', $File))[0]
  if ($r.ExitCode -ne 0) { throw "ffprobe failed on ${File}: $($r.Stderr)" }
  return ($r.Stdout | ConvertFrom-Json)
}

function Cut-Stream($s) {
  $side = @()
  foreach ($d in @($s.side_data_list)) {
    if ($null -eq $d) { continue }
    $entry = [ordered]@{ side_data_type = $d.side_data_type }
    if ($null -ne $d.rotation) { $entry.rotation = $d.rotation }
    if ($null -ne $d.size) { $entry.size = $d.size }
    $side += [pscustomobject]$entry
  }
  [pscustomobject][ordered]@{
    index = $s.index; codec_name = $s.codec_name; width = $s.width; height = $s.height; pix_fmt = $s.pix_fmt
    bits_per_raw_sample = $s.bits_per_raw_sample; color_primaries = $s.color_primaries; color_transfer = $s.color_transfer
    color_space = $s.color_space; color_range = $s.color_range; side_data = $side
    icc_profile = $(if ($side | Where-Object { $_.side_data_type -match 'ICC' }) { 'yes' } else { 'no' })
  }
}

function Find-Grid($Probe) {
  $i = 0
  foreach ($g in @($Probe.stream_groups)) {
    if ($null -ne $g -and "$($g.type)" -match 'Tile Grid') { return [pscustomobject]@{ Group = $g; Position = $i } }
    $i += 1
  }
  return $null
}

# The picture's whole size: the grid's, or the first video stream's.
function Get-Size($Probe, $Grid) {
  if ($Grid) {
    $c = @($Grid.Group.components)[0]
    if ($c -and $c.width -and $c.height) { return @([int]$c.width, [int]$c.height) }
  }
  $v = @($Probe.streams | Where-Object { $_.codec_type -eq 'video' })[0]
  return @([int]$v.width, [int]$v.height)
}

function Fit([int] $W, [int] $H) {
  $long = [math]::Max($W, $H)
  if ($long -le $LongEdge) { return @($W, $H) }
  $s = $LongEdge / $long
  return @([int][math]::Round($W * $s), [int][math]::Round($H * $s))
}

function Get-PngSize([string] $File) {
  $p = Get-Probe $File
  $v = @($p.streams)[0]
  return "$($v.width) x $($v.height)"
}

# ---- The runner ----
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$ram = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
Say "Runner: $($cpu.Name.Trim()), $($cpu.NumberOfCores) cores, $($cpu.NumberOfLogicalProcessors) logical processors, $([math]::Round($ram / 1GB, 1)) GB RAM"
Say "ffmpeg: $(((& $ffmpeg -version) | Select-Object -First 1))"
Say "ffprobe: $(((& $ffprobe -version) | Select-Object -First 1))"
Say ''

$files = Get-ChildItem -Path $Pictures -Filter "*.$Extension" | Sort-Object { if ($_.Name -match 'proof') { 0 } elseif ($_.Name -match '12mp') { 1 } else { 2 } }
if (-not $files) { throw "No .$Extension files in $Pictures" }
$methods = @{}

foreach ($f in $files) {
  $name = $f.BaseName
  Say "==== $($f.Name) ($([math]::Round($f.Length / 1KB, 1)) KiB)"

  # ---- What the file says ----
  $probe = Get-Probe $f.FullName
  $grid = Find-Grid $probe
  $groups = @()
  foreach ($g in @($probe.stream_groups)) {
    if ($null -eq $g) { continue }
    $member = @($g.streams)[0]
    $groups += [pscustomobject][ordered]@{
      index = $g.index; type = $g.type; nb_streams = $g.nb_streams
      components = @($g.components | ForEach-Object { [pscustomobject][ordered]@{ component_type = $_.component_type; width = $_.width; height = $_.height; coded_width = $_.coded_width; coded_height = $_.coded_height; nb_tiles = $_.nb_tiles } })
      tile_size = $(if ($member) { "$($member.width) x $($member.height)" } else { $null })
    }
  }
  $cut = [pscustomobject][ordered]@{
    streams = @($probe.streams | ForEach-Object { Cut-Stream $_ })
    stream_groups = $groups
    tile_grid = $(if ($grid) { "yes, group $($grid.Group.index)" } else { 'no' })
  }
  Say ($cut | ConvertTo-Json -Depth 8)
  # The ICC profile's size, from the first decoded frame's side data (a stream's side data doesn't print one).
  $frames = (Invoke-One $ffprobe @('-v', 'error', '-of', 'json', '-select_streams', 'v:0', '-read_intervals', '%+#1', '-show_frames', $f.FullName))[0]
  $frame = $null
  if ($frames.Stdout.Trim()) { $frame = @(($frames.Stdout | ConvertFrom-Json).frames)[0] }
  if ($frame) {
    $frameCut = [pscustomobject][ordered]@{
      width = $frame.width; height = $frame.height; pix_fmt = $frame.pix_fmt; color_primaries = $frame.color_primaries
      color_transfer = $frame.color_transfer; color_space = $frame.color_space; color_range = $frame.color_range
      side_data = @($frame.side_data_list | Where-Object { $null -ne $_ } | ForEach-Object { [pscustomobject][ordered]@{ side_data_type = $_.side_data_type; name = $_.name; size = $_.size; rotation = $_.rotation } })
    }
    Say "First frame of stream v:0 (an ICC profile's size shows here): $($frameCut | ConvertTo-Json -Depth 6 -Compress)"
  } else {
    Say "First frame of stream v:0: none read (exit $($frames.ExitCode))"
  }
  if ($frames.Stderr) { Say "  ffprobe said: $($frames.Stderr)" }

  # ---- Probe A ----
  $size = Get-Size $probe $grid
  $fit = Fit $size[0] $size[1]
  $source = $(if ($grid) { "0:g:$($grid.Position)" } else { '0:v:0' })
  $scaled = Join-Path $Out "$name-scaled.png"
  if (Test-Path $scaled) { Remove-Item $scaled }
  $argsA = @('-v', 'error', '-y', '-i', $f.FullName, '-filter_complex', "[$source]scale=w=$($fit[0]):h=$($fit[1]):flags=lanczos[o]", '-map', '[o]', '-frames:v', '1', '-c:v', 'png', '-pix_fmt', 'rgb24', $scaled)
  $method = $null
  if ($PipedOnly) {
    $a = [pscustomobject]@{ ExitCode = 'skipped (-PipedOnly)'; Stderr = '' }
  } else {
    Say "Probe A: ffmpeg $($argsA -join ' ')"
    $a = (Invoke-One $ffmpeg $argsA)[0]
  }
  if ($a.ExitCode -eq 0 -and (Test-Path $scaled)) {
    Say "Probe A: yes. Output $(Get-PngSize $scaled) (asked for $($fit[0]) x $($fit[1]), from $($size[0]) x $($size[1]))"
    $method = @{ Kind = 'one'; Args = $argsA }
  } else {
    Say "Probe A: no (exit $($a.ExitCode)). ffmpeg said: $($a.Stderr)"
    $first = @('-v', 'error', '-i', $f.FullName, '-filter_complex', "[$source]null[o]", '-map', '[o]', '-f', 'rawvideo', '-pix_fmt', 'rgb48le', '-')
    $second = @('-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb48le', '-s', "$($size[0])x$($size[1])", '-i', '-', '-vf', "scale=$($fit[0]):$($fit[1]):flags=lanczos", '-frames:v', '1', '-c:v', 'png', '-pix_fmt', 'rgb24', $scaled)
    Say "Fallback: ffmpeg $($first -join ' ') | ffmpeg $($second -join ' ')"
    $pair = Invoke-Pair $first $second
    if ($pair[0].ExitCode -eq 0 -and $pair[1].ExitCode -eq 0 -and (Test-Path $scaled)) {
      Say "Fallback: yes. Output $(Get-PngSize $scaled)"
      $method = @{ Kind = 'pair'; First = $first; Second = $second }
    } else {
      Say "Fallback: no (exits $($pair[0].ExitCode), $($pair[1].ExitCode)). ffmpeg said: $($pair[0].Stderr) / $($pair[1].Stderr)"
    }
  }
  $methods[$f.FullName] = $method

  # ---- The proof's patches ----
  $regionsFile = Join-Path $Pictures 'heic-proof-regions.json'
  if ($method -and $name -match 'proof' -and (Test-Path $regionsFile)) {
    $table = Get-Content -Raw $regionsFile | ConvertFrom-Json
    $raw = Join-Path $Out "$name-scaled.rgb"
    & $ffmpeg -v error -y -i $scaled -f rawvideo -pix_fmt rgb24 $raw
    $bytes = [IO.File]::ReadAllBytes($raw)
    $w = [int]$table.width
    if ($bytes.Length -ne $w * [int]$table.height * 3) {
      Say "Patches: the output isn't $($table.width) x $($table.height); not measured."
    } else {
      Say 'Patch means (P3 code values): drawn -> after decode and scale, and the largest difference'
      foreach ($r in $table.regions) {
        $m = [HeicMeasure]::Mean($bytes, $w, [int]$r.x, [int]$r.y, [int]$r.w, [int]$r.h)
        $d = [math]::Max([math]::Max([math]::Abs($m[0] - $r.drawn[0]), [math]::Abs($m[1] - $r.drawn[1])), [math]::Abs($m[2] - $r.drawn[2]))
        Say ('  {0,-16} ({1,5}, {2,5}, {3,5}) -> ({4,5}, {5,5}, {6,5})   {7,5}' -f $r.name, $r.drawn[0], $r.drawn[1], $r.drawn[2], $m[0], $m[1], $m[2], $d)
      }
    }
    Remove-Item $raw
  }
  Say ''
}

# ---- Timing ----
$rows = @()
foreach ($f in $files | Where-Object { $_.Name -match '12mp|48mp' }) {
  $label = $(if ($f.Name -match '48mp') { '48 MP' } else { '12 MP' })
  $method = $methods[$f.FullName]
  for ($run = 1; $run -le $Runs; $run += 1) {
    $p = (Invoke-One $ffprobe @('-v', 'error', '-of', 'json', '-show_streams', '-show_stream_groups', $f.FullName))[0]
    $rows += [pscustomobject]@{ Size = $label; Run = $run; Step = 'ffprobe'; WallMs = $p.WallMs; PolledMB = $p.PolledMB; AtExitMB = $p.AtExitMB; Exit = $p.ExitCode }
    if (-not $method) { continue }
    if ($method.Kind -eq 'one') {
      $r = (Invoke-One $ffmpeg $method.Args)[0]
      $rows += [pscustomobject]@{ Size = $label; Run = $run; Step = 'ffmpeg decode and scale'; WallMs = $r.WallMs; PolledMB = $r.PolledMB; AtExitMB = $r.AtExitMB; Exit = $r.ExitCode }
    } else {
      $pair = Invoke-Pair $method.First $method.Second
      $rows += [pscustomobject]@{ Size = $label; Run = $run; Step = 'ffmpeg grid decode (piped)'; WallMs = $pair[0].WallMs; PolledMB = $pair[0].PolledMB; AtExitMB = $pair[0].AtExitMB; Exit = $pair[0].ExitCode }
      $rows += [pscustomobject]@{ Size = $label; Run = $run; Step = 'ffmpeg scale and PNG (piped)'; WallMs = $pair[1].WallMs; PolledMB = $pair[1].PolledMB; AtExitMB = $pair[1].AtExitMB; Exit = $pair[1].ExitCode }
      $both = [math]::Round(($pair[1].Exit - $pair[0].Start).TotalMilliseconds)
      $rows += [pscustomobject]@{ Size = $label; Run = $run; Step = 'the pair, start to end'; WallMs = $both; PolledMB = $null; AtExitMB = $null; Exit = $null }
    }
  }
}

if ($rows) {
  Say 'Timing: wall time (ms) and peak working set (MB), polled every 20 ms and read at exit'
  Say ($rows | Format-Table Size, Run, Step, WallMs, PolledMB, AtExitMB, Exit -AutoSize | Out-String).TrimEnd()
  Say ''
  Say 'Min, median and max per size and step'
  $summary = foreach ($group in ($rows | Group-Object Size, Step)) {
    $stat = {
      param($values)
      $v = @($values | Where-Object { $null -ne $_ } | Sort-Object)
      if (-not $v) { return '' }
      $mid = $(if ($v.Count % 2) { $v[($v.Count - 1) / 2] } else { ($v[$v.Count / 2 - 1] + $v[$v.Count / 2]) / 2 })
      "$($v[0]) / $mid / $($v[-1])"
    }
    [pscustomobject]@{
      Size = $group.Group[0].Size
      Step = $group.Group[0].Step
      'Wall ms (min / median / max)' = & $stat ($group.Group | ForEach-Object { $_.WallMs })
      'Peak MB at exit (min / median / max)' = & $stat ($group.Group | ForEach-Object { $_.AtExitMB })
      'Peak MB polled (min / median / max)' = & $stat ($group.Group | ForEach-Object { $_.PolledMB })
    }
  }
  Say ($summary | Format-Table -AutoSize | Out-String -Width 200).TrimEnd()
}
