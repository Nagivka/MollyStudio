!macro customInstall
  ${if} ${isUpdated}
  ${andIfNot} ${isNoDesktopShortcut}
  ${andIfNot} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ${if} ${FileExists} "$newDesktopLink"
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
    ${endIf}
  ${endIf}
!macroend
