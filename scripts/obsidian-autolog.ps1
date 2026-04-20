param(
    [string]$Event = "manual"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-Slug {
    param([string]$Value)

    $slug = $Value.ToLowerInvariant() -replace "[^a-z0-9]+", "-"
    $slug = $slug.Trim("-")

    if ([string]::IsNullOrWhiteSpace($slug)) {
        return "update"
    }

    return $slug
}

function Ensure-DailyNote {
    param(
        [string]$Path,
        [string]$TemplatePath,
        [string]$DateLabel
    )

    $dailyDir = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $dailyDir | Out-Null

    if (-not (Test-Path -LiteralPath $Path)) {
        if (Test-Path -LiteralPath $TemplatePath) {
            $template = Get-Content -LiteralPath $TemplatePath -Raw -Encoding UTF8
            $template = $template.Replace("{{date}}", $DateLabel)
            Set-Content -LiteralPath $Path -Value $template -Encoding UTF8
        } else {
            $fallback = @"
# $DateLabel

## Top Priorities
- 

## Recent Changes
- 

## Tasks
- 

## Decisions
- 

## Links
- [[MonteRun MOC]]

## Backlinks / Related Notes
- 

## Log
- 
"@
            Set-Content -LiteralPath $Path -Value $fallback -Encoding UTF8
        }
    }
}

function Add-LineUnderHeading {
    param(
        [string]$Content,
        [string]$Heading,
        [string]$Line
    )

    if ($Content.Contains($Line)) {
        return $Content
    }

    $marker = "$Heading`r`n"
    if ($Content.Contains($marker)) {
        return $Content.Replace($marker, "$Heading`r`n$Line`r`n")
    }

    $marker = "$Heading`n"
    if ($Content.Contains($marker)) {
        return $Content.Replace($marker, "$Heading`n$Line`n")
    }

    return "$Content`r`n$Heading`r`n$Line`r`n"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configPath = Join-Path $repoRoot ".monterun\obsidian-autolog.json"

if (-not (Test-Path -LiteralPath $configPath)) {
    throw "AutoLogger config not found: $configPath"
}

$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$vaultPathValue = [string]$config.vaultPath
if ([string]::IsNullOrWhiteSpace($vaultPathValue)) {
    $vaultPath = Join-Path $repoRoot "Obsidian"
} elseif ([System.IO.Path]::IsPathRooted($vaultPathValue)) {
    $vaultPath = $vaultPathValue
} else {
    $vaultPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $vaultPathValue))
}

$shortSha = (& git -C $repoRoot rev-parse --short HEAD).Trim()
$fullSha = (& git -C $repoRoot rev-parse HEAD).Trim()
$subject = (& git -C $repoRoot log -1 --pretty=%s).Trim()
$branch = (& git -C $repoRoot rev-parse --abbrev-ref HEAD).Trim()
$committedAtRaw = (& git -C $repoRoot log -1 --date=iso-strict --pretty=%cd).Trim()
$committedAt = [DateTimeOffset]::Parse($committedAtRaw).ToLocalTime()

$dateLabel = $committedAt.ToString("yyyy-MM-dd")
$timeLabel = $committedAt.ToString("HHmmss")
$slug = Get-Slug -Value $subject

$dailyFolder = Join-Path $vaultPath $config.dailyNotesFolder
$dailyPath = Join-Path $dailyFolder "$dateLabel.md"
$dailyTemplatePath = Join-Path $vaultPath $config.dailyTemplate

Ensure-DailyNote -Path $dailyPath -TemplatePath $dailyTemplatePath -DateLabel $dateLabel

$gitLogRoot = Join-Path $vaultPath $config.gitLogFolder
$gitLogDayFolder = Join-Path $gitLogRoot $dateLabel
New-Item -ItemType Directory -Force -Path $gitLogDayFolder | Out-Null

$noteStem = "$timeLabel-$shortSha-$slug"
$notePath = Join-Path $gitLogDayFolder "$noteStem.md"
$dailyLink = "[[Daily Notes/$dateLabel]]"
$projectHub = [string]$config.projectHub
if ([string]::IsNullOrWhiteSpace($projectHub)) {
    $projectHub = "MonteRun MOC"
}

$projectStatus = [string]$config.projectStatus
if ([string]::IsNullOrWhiteSpace($projectStatus)) {
    $projectStatus = "01-Projects/MonteRun/Current-Status"
}
$hubLink = "[[$projectHub]]"
$statusLink = "[[$projectStatus]]"
$noteLink = "[[00-Inbox/Git Log/$dateLabel/$noteStem]]"

if (-not (Test-Path -LiteralPath $notePath)) {
    $templatePath = Join-Path $vaultPath $config.gitCommitTemplate
    if (Test-Path -LiteralPath $templatePath) {
        $noteBody = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8
        $noteBody = $noteBody.Replace("{{date}}", $dateLabel)
        $noteBody = $noteBody.Replace("{{sha}}", $shortSha)
        $noteBody = $noteBody.Replace("{{branch}}", $branch)
        $noteBody = $noteBody.Replace("{{subject}}", $subject)
        $noteBody = $noteBody.Replace("{{event}}", $Event)
    } else {
        $noteBody = @"
# Git Commit Log

Daily: $dailyLink
Project: $hubLink
Status: $statusLink

## Commit
- SHA: `$shortSha`
- Branch: `$branch`
- Subject: $subject
- Event: $Event
"@
    }

    $metadata = @"
Commit: `$shortSha`
Full SHA: `$fullSha`
Daily: $dailyLink
Project: $hubLink
Status: $statusLink
"@

    Set-Content -LiteralPath $notePath -Value "$noteBody`r`n`r`n## Metadata`r`n$metadata`r`n" -Encoding UTF8
}

$dailyContent = Get-Content -LiteralPath $dailyPath -Raw -Encoding UTF8
$recentLine = "- $noteLink - $([char]96)$shortSha$([char]96) $subject"
$dailyContent = Add-LineUnderHeading -Content $dailyContent -Heading "## Recent Changes" -Line $recentLine

if (-not $dailyContent.Contains($hubLink)) {
    $dailyContent = Add-LineUnderHeading -Content $dailyContent -Heading "## Links" -Line "- $hubLink"
}

Set-Content -LiteralPath $dailyPath -Value $dailyContent -Encoding UTF8
