param([string]$Source = 'C:\Users\RAM\Downloads\Gemini_Generated_Image_shkmzrshkmzrshkm.jpg')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$web = Join-Path $root 'src\assets'
$native = Join-Path $root 'android\app\src\main\res\drawable-nodpi'
New-Item -ItemType Directory -Force -Path $web, $native | Out-Null
$original = [System.Drawing.Bitmap]::FromFile($Source)
try {
    # Crop only the supplied artwork; no redrawing or synthesized replacement.
    function Save-Brand([System.Drawing.Rectangle]$crop, [int]$size, [int]$inset, [string]$path) {
        $canvas = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $drawing = [System.Drawing.Graphics]::FromImage($canvas)
        try {
            $drawing.Clear([System.Drawing.Color]::Transparent)
            $drawing.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $scale = ($size - 2 * $inset) / [Math]::Max($crop.Width, $crop.Height)
            $width = [int]($crop.Width * $scale); $height = [int]($crop.Height * $scale)
            $target = [System.Drawing.Rectangle]::new([int](($size-$width)/2), [int](($size-$height)/2), $width, $height)
            $drawing.DrawImage($original, $target, $crop, [System.Drawing.GraphicsUnit]::Pixel)
        } finally { $drawing.Dispose() }
        # White artwork on black -> alpha for Android monochrome and nonblack UI surfaces.
        for ($y=0; $y -lt $size; $y++) { for ($x=0; $x -lt $size; $x++) {
            $pixel = $canvas.GetPixel($x,$y)
            $alpha = [int][Math]::Clamp(($pixel.R - 20) * 255.0 / 225, 0, 255)
            $canvas.SetPixel($x,$y,[System.Drawing.Color]::FromArgb($alpha,255,255,255))
        } }
        try { $canvas.Save($path, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $canvas.Dispose() }
    }
    $symbol = [System.Drawing.Rectangle]::new(826,192,1100,980)
    Save-Brand $symbol 512 12 (Join-Path $web 'murmur-mark.png')
    Save-Brand $symbol 512 12 (Join-Path $native 'murmur_mark.png')
    Save-Brand $symbol 432 86 (Join-Path $native 'murmur_launcher.png')
    Save-Brand ([System.Drawing.Rectangle]::new(826,192,1100,1178)) 768 20 (Join-Path $native 'murmur_lockup.png')
    $generated = @((Join-Path $web 'murmur-mark.png'), (Join-Path $native 'murmur_mark.png'), (Join-Path $native 'murmur_launcher.png'), (Join-Path $native 'murmur_lockup.png'))
    & node (Join-Path $PSScriptRoot 'brand-provenance.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo registrar el origen del logo.' }
    @{ sourceSha256=(Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash.ToLower(); sourceBytes=(Get-Item -LiteralPath $Source).Length; outputs=@($generated | ForEach-Object { @{path=$_.Substring($root.Length+1);bytes=(Get-Item -LiteralPath $_).Length} }); operation='User-supplied logo crop, alpha and downsampling for application resources.' } | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $root 'verification\brand-assets.json')
} finally { $original.Dispose() }
