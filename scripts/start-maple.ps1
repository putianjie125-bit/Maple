param(
 [string]$DataDir,
 [ValidateRange(1024,65535)][int]$Port=4141,
 [switch]$NoOpen
)
$ErrorActionPreference='Stop'
$taskSource=Split-Path -Parent $PSScriptRoot
if(-not $DataDir){$DataDir=Join-Path $env:USERPROFILE '.maple'}
$taskRoot=[IO.Path]::GetFullPath($DataDir)
$taskNode=Get-Command node.exe -ErrorAction SilentlyContinue
if(-not $taskNode){throw 'Please install Node.js 22 or newer from https://nodejs.org/ and try again.'}
$taskMajor=[int]((& $taskNode.Source --version).TrimStart('v').Split('.')[0])
if($taskMajor -lt 22){throw 'Maple needs Node.js 22 or newer. Please update Node.js.'}
$taskUrl='http://127.0.0.1:'+$Port
function Test-MapleReady {
 try{$taskHtml=(Invoke-WebRequest -Uri $taskUrl -UseBasicParsing -TimeoutSec 2).Content;return ($taskHtml.Contains('<title>Maple</title>') -and $taskHtml.Contains('name="parley-token"'))}catch{return $false}
}
$taskMutex=[Threading.Mutex]::new($false,('Local\Maple-start-'+$Port))
$taskLocked=$false
try{
 try{$taskLocked=$taskMutex.WaitOne(30000)}catch [Threading.AbandonedMutexException]{$taskLocked=$true}
 if(-not $taskLocked){throw 'Another Maple launch is taking too long. Try again shortly.'}
 if(-not (Test-MapleReady)){
  if(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue){throw ('Port '+$Port+' is in use by another app. Choose another port with -Port.')}
  New-Item -ItemType Directory -Path $taskRoot -Force|Out-Null
  $taskArgs='"'+(Join-Path $taskSource 'parley.mjs')+'" --root "'+$taskRoot+'" --port '+$Port+' --no-open'
  $taskChild=Start-Process -FilePath $taskNode.Source -ArgumentList $taskArgs -WorkingDirectory $taskSource -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'server.log') -RedirectStandardError (Join-Path $taskRoot 'server-error.log') -PassThru
  [IO.File]::WriteAllText((Join-Path $taskRoot 'server.pid'),[string]$taskChild.Id)
  $taskReady=$false
  for($taskTry=0;$taskTry -lt 40;$taskTry++){
   Start-Sleep -Milliseconds 250
   if(Test-MapleReady){$taskReady=$true;break}
   if($taskChild.HasExited){break}
  }
  if(-not $taskReady){throw ('Maple did not start. See '+(Join-Path $taskRoot 'server-error.log'))}
 }
 if(-not $NoOpen){Start-Process $taskUrl}
 Write-Output ('Maple is ready: '+$taskUrl)
 Write-Output ('Data: '+$taskRoot)
}finally{if($taskLocked){$taskMutex.ReleaseMutex()};$taskMutex.Dispose()}
