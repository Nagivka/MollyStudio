; Self-contained portable launcher. BCJ2 payloads need the full 7-Zip decoder;
; the default Nsis7z plugin does not support that filter.
Unicode true
!include "FileFunc.nsh"
Name "MollyStudio"
OutFile "${PORTABLE_OUTPUT}"
Icon "${APP_ICON}"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
CRCCheck force
SetCompressor lzma
SetCompressorDictSize 64
VIProductVersion "${APP_BUILD_VERSION}"
VIAddVersionKey /LANG=1033 "ProductName" "MollyStudio"
VIAddVersionKey /LANG=1033 "FileDescription" "MollyStudio Portable"
VIAddVersionKey /LANG=1033 "CompanyName" "nagivka"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright 2026 nagivka"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_BUILD_VERSION}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${APP_BUILD_VERSION}"

Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=7za.exe "${SEVEN_ZIP}"
  SetCompress off
  File /oname=app.7z "${PORTABLE_ARCHIVE}"
  SetCompress auto
  nsExec::ExecToStack /TIMEOUT=180000 '"$PLUGINSDIR\7za.exe" x "$PLUGINSDIR\app.7z" "-o$PLUGINSDIR\app" -y -bd'
  Pop $0
  Pop $1
  StrCmp $0 "0" unpacked
    MessageBox MB_OK|MB_ICONSTOP "MollyStudio could not be extracted. Error: $0$\r$\n$1"
    SetErrorLevel 1
    Quit
  unpacked:
  IfFileExists "$PLUGINSDIR\app\MollyStudio.exe" launch
    MessageBox MB_OK|MB_ICONSTOP "The MollyStudio application is missing from the package."
    SetErrorLevel 1
    Quit
  launch:
  SetOutPath "$PLUGINSDIR\app"
  File /oname=LICENSE.7zip.txt "${SEVEN_ZIP_LICENSE}"
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "MollyStudio").r0'
  ${GetParameters} $0
  ClearErrors
  ExecWait '"$PLUGINSDIR\app\MollyStudio.exe" $0' $1
  IfErrors launchFailed
  SetErrorLevel $1
  Goto cleanup
  launchFailed:
  MessageBox MB_OK|MB_ICONSTOP "MollyStudio could not be started."
  SetErrorLevel 1
  cleanup:
  SetOutPath "$EXEDIR"
  RMDir /r "$PLUGINSDIR\app"
SectionEnd
