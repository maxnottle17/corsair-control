# Draws the app logo (a control dial on a dark keycap) and writes ui\icon.png and ui\icon.ico.
Add-Type -AssemblyName System.Drawing
$ui = Join-Path (Split-Path $PSScriptRoot -Parent) 'ui'

function New-Logo([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'
  $s = $size / 256.0

  # rounded dark keycap
  $r = 56 * $s; $d = $r * 2; $m = 8 * $s; $w = $size - 2 * $m
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($m, $m, $d, $d, 180, 90); $path.AddArc($m + $w - $d, $m, $d, $d, 270, 90)
  $path.AddArc($m + $w - $d, $m + $w - $d, $d, $d, 0, 90); $path.AddArc($m, $m + $w - $d, $d, $d, 90, 90); $path.CloseFigure()
  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 38, 43, 56)), ([System.Drawing.Color]::FromArgb(255, 13, 15, 20)), 90
  $g.FillPath($bg, $path)

  # dial ring: yellow sweep with a cyan tail, open at the bottom
  $pad = 58 * $s; $box = New-Object System.Drawing.RectangleF $pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad)
  $track = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 58, 64, 80)), (26 * $s)
  $track.StartCap = 'Round'; $track.EndCap = 'Round'
  $g.DrawArc($track, $box, 135, 270)
  $yellow = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 255, 214, 10)), (26 * $s)
  $yellow.StartCap = 'Round'; $yellow.EndCap = 'Round'
  $g.DrawArc($yellow, $box, 135, 190)

  # pointer dot at the end of the sweep, and a cyan centre
  $ang = (135 + 190) * [Math]::PI / 180; $rad = ($size - 2 * $pad) / 2; $c = $size / 2
  $px = $c + $rad * [Math]::Cos($ang); $py = $c + $rad * [Math]::Sin($ang); $dot = 20 * $s
  $g.FillEllipse([System.Drawing.Brushes]::White, $px - $dot, $py - $dot, 2 * $dot, 2 * $dot)
  $cy = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0, 200, 255))
  $cr = 24 * $s; $g.FillEllipse($cy, $c - $cr, $c - $cr, 2 * $cr, 2 * $cr)
  $g.Dispose()
  return $bmp
}

$sizes = 256, 64, 48, 32, 24, 16
$pngs = foreach ($sz in $sizes) {
  $ms = New-Object System.IO.MemoryStream
  $b = New-Logo $sz; $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()
  , $ms.ToArray()
}
[System.IO.File]::WriteAllBytes((Join-Path $ui 'icon.png'), $pngs[0])

# .ico container holding the PNGs
$out = New-Object System.IO.MemoryStream; $bw = New-Object System.IO.BinaryWriter $out
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$pngs[$i].Length); $bw.Write([uint32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
[System.IO.File]::WriteAllBytes((Join-Path $ui 'icon.ico'), $out.ToArray())
"icon written: $((Get-Item (Join-Path $ui 'icon.ico')).Length) bytes"
