param([switch]$SmokeTest, [string]$ScreenshotPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$packageRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$node = Join-Path $packageRoot 'runtime\node.exe'
$runner = Join-Path $PSScriptRoot 'setup-runner.mjs'
if (!(Test-Path -LiteralPath $node)) { throw '请先解压整个 ZIP，再打开 Setup.cmd。缺少内置运行环境。' }

function Invoke-Setup($request) {
    $requestFile = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString() + '.json')
    try {
        [IO.File]::WriteAllText($requestFile, ($request | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
        $info = [Diagnostics.ProcessStartInfo]::new()
        $info.FileName = $node
        $info.Arguments = '"' + $runner + '" "' + $requestFile + '"'
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.StandardOutputEncoding = [Text.Encoding]::UTF8
        $info.StandardErrorEncoding = [Text.Encoding]::UTF8
        $process = [Diagnostics.Process]::Start($info)
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        while (!$process.WaitForExit(50)) { [System.Windows.Forms.Application]::DoEvents() }
        $output = $stdout.Result
        $errorText = $stderr.Result
        if ($process.ExitCode -ne 0) { throw $errorText }
        return $output.Trim()
    } finally { if (Test-Path -LiteralPath $requestFile) { Remove-Item -LiteralPath $requestFile } }
}

$discovery = (Invoke-Setup @{action='discover'}) | ConvertFrom-Json
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Antigravity i18n — 安装与还原 / Setup'
$form.ClientSize = New-Object Drawing.Size(680, 490)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object Drawing.Font('Microsoft YaHei UI', 10)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
function Add-Label($text, $x, $y, $width) {
    $label = New-Object Windows.Forms.Label
    $label.Text=$text; $label.SetBounds($x,$y,$width,30);$form.Controls.Add($label)
}
Add-Label '安装前请保存工作并完全退出 Antigravity（包括托盘）。' 20 15 640
Add-Label 'Antigravity 安装目录 / Installation folder' 20 55 620
$directory = New-Object Windows.Forms.TextBox
$directory.SetBounds(20,85,535,30)
$directory.Text = $discovery.resources
$form.Controls.Add($directory)
$browse = New-Object Windows.Forms.Button
$browse.Text='浏览…';$browse.SetBounds(565,83,95,32);$form.Controls.Add($browse)
$browse.Add_Click({$dialog=New-Object Windows.Forms.FolderBrowserDialog;if($dialog.ShowDialog() -eq 'OK'){$directory.Text=$dialog.SelectedPath};$dialog.Dispose()})
Add-Label '界面语言 / Display language' 20 130 300
$language = New-Object Windows.Forms.ComboBox
$language.DropDownStyle='DropDownList';$language.SetBounds(20,160,640,30)
$form.Controls.Add($language)
foreach($entry in $discovery.languages){[void]$language.Items.Add(($entry.nativeName+' ('+$entry.code+')'))}
$language.SelectedIndex = 1
Add-Label '代理 / Proxy（可选；留空使用客户端默认网络配置）' 20 205 640
$proxy = New-Object Windows.Forms.TextBox
$proxy.SetBounds(20,235,640,30);$form.Controls.Add($proxy)
$existingConfig=Join-Path $discovery.resources 'agy-i18n\config.json'
if(Test-Path -LiteralPath $existingConfig){try{$saved=Get-Content -LiteralPath $existingConfig -Raw -Encoding UTF8|ConvertFrom-Json;$proxy.Text=$saved.proxy;for($i=0;$i -lt $discovery.languages.Count;$i++){if($discovery.languages[$i].code -eq $saved.locale){$language.SelectedIndex=$i}}}catch{}}
$status=New-Object Windows.Forms.TextBox
$status.SetBounds(20,325,640,145);$status.Multiline=$true;$status.ReadOnly=$true;$status.ScrollBars='Vertical';$form.Controls.Add($status)
$status.Text='无需安装 Node.js，无需联网下载。安装完成后正常打开 Antigravity，在右下角切换语言。'
$buttons=@()
foreach($definition in @(@('install','安装 / 更新',20),@('restore','还原原版',240),@('status','检查状态',460))){
    $button=New-Object Windows.Forms.Button
    $button.Text=$definition[1];$button.Tag=$definition[0];$button.SetBounds($definition[2],280,200,35)
    $button.Add_Click({
        $operation=$this.Tag
        foreach($b in $buttons){$b.Enabled=$false};$form.ControlBox=$false
        $status.Text='正在处理，请稍候…'
        try{
            $status.Text=Invoke-Setup @{action=$operation;directory=$directory.Text;locale=$discovery.languages[$language.SelectedIndex].code;proxy=$proxy.Text}
            if($operation -eq 'install'){$status.AppendText("`r`n现在可以正常打开 Antigravity。此工具可以关闭。")}
        }catch{$status.Text="操作未完成：`r`n"+$_.Exception.Message}
        finally{foreach($b in $buttons){$b.Enabled=$true};$form.ControlBox=$true}
    })
    $form.Controls.Add($button);$buttons+= $button
}
if ($SmokeTest) {
    $form.Show(); [System.Windows.Forms.Application]::DoEvents()
    if ($ScreenshotPath) {
        $bitmap = New-Object Drawing.Bitmap($form.Width, $form.Height)
        $form.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)))
        $bitmap.Save($ScreenshotPath, [Drawing.Imaging.ImageFormat]::Png);$bitmap.Dispose()
    }
    Write-Output "GUI smoke OK: $($language.Items.Count) languages"; $form.Close(); $form.Dispose(); exit 0
}
[void]$form.ShowDialog()
