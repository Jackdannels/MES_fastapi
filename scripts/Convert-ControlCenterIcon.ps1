param([Parameter(Mandatory=$true)][string]$SourcePath,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$source=[Drawing.Image]::FromFile((Resolve-Path -LiteralPath $SourcePath).Path)
$frames=New-Object 'Collections.Generic.List[byte[]]'
$sizes=@(16,20,24,32,40,48,64,128,256)
try{
    foreach($size in $sizes){
        $bitmap=New-Object Drawing.Bitmap($size,$size,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics=[Drawing.Graphics]::FromImage($bitmap);$stream=New-Object IO.MemoryStream
        try{
            $graphics.CompositingQuality=[Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode=[Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.Clear([Drawing.Color]::White)
            $graphics.DrawImage($source,(New-Object Drawing.Rectangle(0,0,$size,$size)))
            if($size -eq 256){
                $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
            }else{
                # Framework Icon.ToBitmap expects a DIB for sub-256px frames.
                $dib=New-Object IO.BinaryWriter($stream)
                $maskStride=[int]([Math]::Ceiling($size/32.0)*4);$imageBytes=$size*$size*4
                $dib.Write([uint32]40);$dib.Write([int32]$size);$dib.Write([int32]($size*2));$dib.Write([uint16]1);$dib.Write([uint16]32)
                $dib.Write([uint32]0);$dib.Write([uint32]($imageBytes+$maskStride*$size));$dib.Write([int32]0);$dib.Write([int32]0);$dib.Write([uint32]0);$dib.Write([uint32]0)
                for($y=$size-1;$y -ge 0;$y--){for($x=0;$x -lt $size;$x++){$pixel=$bitmap.GetPixel($x,$y);$dib.Write([byte]$pixel.B);$dib.Write([byte]$pixel.G);$dib.Write([byte]$pixel.R);$dib.Write([byte]$pixel.A)}}
                $dib.Write((New-Object byte[] ($maskStride*$size)));$dib.Flush()
            }
            $frames.Add($stream.ToArray())
        }finally{$stream.Dispose();$graphics.Dispose();$bitmap.Dispose()}
    }
    $full=[IO.Path]::GetFullPath($OutputPath);[IO.Directory]::CreateDirectory((Split-Path -Parent $full))|Out-Null
    $file=[IO.File]::Create($full);$writer=New-Object IO.BinaryWriter($file)
    try{
        $writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$sizes.Count)
        $offset=6+16*$sizes.Count
        for($index=0;$index -lt $sizes.Count;$index++){
            $size=if($sizes[$index] -eq 256){0}else{$sizes[$index]}
            $writer.Write([byte]$size);$writer.Write([byte]$size);$writer.Write([byte]0);$writer.Write([byte]0)
            $writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$frames[$index].Length);$writer.Write([uint32]$offset)
            $offset+=$frames[$index].Length
        }
        foreach($frame in $frames){$writer.Write([byte[]]$frame)}
    }finally{$writer.Dispose()}
}finally{$source.Dispose()}
