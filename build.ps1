$MSVC_VER = "14.44.35207"
$SDK_VER = "10.0.26100.0"
$MSVC_BASE = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\$MSVC_VER"
$SDK_BASE = "C:\Program Files (x86)\Windows Kits\10"
$NASM_PATH = "$env:USERPROFILE\AppData\Local\bin\NASM"

$env:PATH = "$env:USERPROFILE\.cargo\bin;$NASM_PATH;$MSVC_BASE\bin\Hostx64\x64;$SDK_BASE\bin\$SDK_VER\x64;$env:PATH"
$env:LIB = "$MSVC_BASE\lib\x64;$SDK_BASE\Lib\$SDK_VER\ucrt\x64;$SDK_BASE\Lib\$SDK_VER\um\x64"
$env:INCLUDE = "$MSVC_BASE\include;$SDK_BASE\Include\$SDK_VER\ucrt;$SDK_BASE\Include\$SDK_VER\um;$SDK_BASE\Include\$SDK_VER\shared"

npm run tauri build
