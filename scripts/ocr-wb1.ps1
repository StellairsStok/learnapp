param(
  [string]$PageDir = (Join-Path $PSScriptRoot "..\tmp\wb1-pages"),
  [string]$OutFile = (Join-Path $PSScriptRoot "..\tmp\wb1-ocr.json")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime

[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object {
    $_.Name -eq "AsTask" -and
    $_.IsGenericMethodDefinition -and
    $_.GetParameters().Count -eq 1
  } | Select-Object -First 1)

function Await-Operation($op, [Type]$resultType) {
  $asTask = $script:asTaskGeneric.MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($op))
  $task.Wait()
  return $task.Result
}

$lang = [Windows.Globalization.Language]::new("zh-Hans")
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if ($null -eq $engine) {
  throw "Windows OCR zh-Hans engine is not available."
}

$pages = @()
for ($wb = 1; $wb -le 71; $wb++) {
  $pdf = $wb + 4
  $path = Join-Path $PageDir ("wb1-60-{0:00}.png" -f $pdf)
  if (!(Test-Path -LiteralPath $path)) {
    throw "Missing OCR page image: $path"
  }
  $file = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $stream = Await-Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

  $lines = @()
  foreach ($line in $result.Lines) {
    $words = @()
    $minX = [double]::PositiveInfinity
    $minY = [double]::PositiveInfinity
    $maxX = 0.0
    $maxY = 0.0
    foreach ($word in $line.Words) {
      $r = $word.BoundingRect
      $words += [ordered]@{
        text = $word.Text
        x = [math]::Round($r.X, 2)
        y = [math]::Round($r.Y, 2)
        w = [math]::Round($r.Width, 2)
        h = [math]::Round($r.Height, 2)
      }
      $minX = [math]::Min($minX, $r.X)
      $minY = [math]::Min($minY, $r.Y)
      $maxX = [math]::Max($maxX, $r.X + $r.Width)
      $maxY = [math]::Max($maxY, $r.Y + $r.Height)
    }
    if ($line.Words.Count -gt 0) {
      $lines += [ordered]@{
        text = $line.Text
        x = [math]::Round($minX, 2)
        y = [math]::Round($minY, 2)
        w = [math]::Round($maxX - $minX, 2)
        h = [math]::Round($maxY - $minY, 2)
        words = $words
      }
    }
  }
  $pages += [ordered]@{
    wbPage = $wb
    pdfPage = $pdf
    image = $path
    text = $result.Text
    lines = $lines
  }
  Write-Host ("OCR p{0:000}: {1} lines" -f $wb, $lines.Count)
}

$json = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  engine = $engine.RecognizerLanguage.LanguageTag
  pages = $pages
} | ConvertTo-Json -Depth 8

[System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "Wrote $OutFile"
