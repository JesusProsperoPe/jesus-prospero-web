# Arma la carpeta que Jesus le adjunta a ChatGPT para hacer un carrusel:
# Sitio Jesus Prospero\carruseles\<corto>\ con guion-carrusel.txt y todas las fotos que el guion menciona
# (fotos de la nota, fotos de cada slide, su foto de perfil y su QR de Yape).
# Uso (después de compilar con Eleventy):  .\scripts\preparar-carrusel.ps1 facultades-urgencia
# Sin código, prepara la nota más reciente que tenga carrusel.
param([string]$Corto)

$raiz = Split-Path $PSScriptRoot -Parent
$guion = if ($Corto) { Join-Path $raiz "_site\carrusel\$Corto.txt" } else { Join-Path $raiz "_site\carrusel.txt" }
if (-not (Test-Path $guion)) { throw "No existe $guion. Compila primero (npx @11ty/eleventy) y revisa el código corto." }
$texto = [IO.File]::ReadAllText($guion, [Text.Encoding]::UTF8)
if (-not $Corto) { $Corto = ([regex]::Match($texto, '/noticias/([^/\s]+)/')).Groups[1].Value }

$destino = Join-Path (Split-Path $raiz -Parent) "carruseles\$Corto"
New-Item -ItemType Directory -Force $destino | Out-Null
Copy-Item $guion (Join-Path $destino "guion-carrusel.txt") -Force
$rutas = [regex]::Matches($texto, 'https://jesusprospero\.pe(/img/[^\s)]+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
foreach ($r in $rutas) {
  $origen = Join-Path $raiz ("src" + $r.Replace('/', '\'))
  if (Test-Path $origen) { Copy-Item $origen $destino -Force } else { Write-Warning "Falta la foto $r" }
}
Write-Output "Carpeta lista: $destino"
Get-ChildItem $destino -Name
