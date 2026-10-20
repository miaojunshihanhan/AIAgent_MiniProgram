param([string]$Source,[string]$Destination)
$ErrorActionPreference='Stop'
$app=$null;$deck=$null
try{New-Item -ItemType Directory -Path $Destination -Force|Out-Null;$app=New-Object -ComObject PowerPoint.Application;$app.AutomationSecurity=3;$deck=$app.Presentations.Open($Source,-1,0,0);foreach($slide in $deck.Slides){$slide.Export((Join-Path $Destination ($slide.SlideIndex.ToString()+'.png')),'PNG',1200,[int](1200*$deck.PageSetup.SlideHeight/$deck.PageSetup.SlideWidth))};Write-Output $deck.Slides.Count}finally{if($deck){$deck.Close()};if($app){$app.Quit()}}
