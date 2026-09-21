; DocDiff 自定义安装脚本
;
; 目标：无论机器上残留着什么（卡死的 DocDiff 进程、装了一半的旧版本、
; 打不开的旧卸载程序），安装都必须能走完，不再出现：
;   - DocDiff cannot be closed. Please close it manually and click Retry
;   - Error opening file for writing: ...\Uninstall DocDiff.exe

; 结束所有 DocDiff 相关进程：先礼后兵
!macro docdiffKillApp
  nsExec::Exec 'taskkill /IM "DocDiff.exe"'
  Pop $0
  Sleep 1200
  nsExec::Exec 'taskkill /F /T /IM "DocDiff.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM "Uninstall DocDiff.exe"'
  Pop $0
  Sleep 600
!macroend

; 让某个文件"可写"：能删就删；删不掉（仍被占用）就改名
; —— Windows 允许重命名正在运行 / 被占用的 exe，但不允许覆盖写入。
!macro docdiffFreeFile path
  ${If} ${FileExists} "${path}"
    ClearErrors
    Delete "${path}"
    ${If} ${FileExists} "${path}"
      Delete "${path}.stale1"
      ClearErrors
      Rename "${path}" "${path}.stale1"
      ${If} ${Errors}
        Delete "${path}.stale2"
        ClearErrors
        Rename "${path}" "${path}.stale2"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  !insertmacro docdiffKillApp
  ; 不调用旧版本自带的卸载程序：旧版本（1.4.1 及更早）的卸载程序在进程卡死时
  ; 会弹 "DocDiff cannot be closed" 并中断整个安装。新版本直接覆盖安装，
  ; 安装完成后会重新登记卸载信息。
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
    DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
  !endif
!macroend

!macro customCheckAppRunning
  DetailPrint "Preparing installation..."
  !insertmacro docdiffKillApp
  !insertmacro docdiffFreeFile "$INSTDIR\Uninstall DocDiff.exe"
  !insertmacro docdiffFreeFile "$INSTDIR\DocDiff.exe"
  ; 如果主程序还是删不掉也改不了名（极少见：进程无法结束），
  ; 就把整个旧目录挪开，安装到干净目录，保证安装一定能完成。
  ${If} ${FileExists} "$INSTDIR\DocDiff.exe"
    DetailPrint "Old files are locked, moving them aside..."
    RMDir /r "$INSTDIR.stale"
    ClearErrors
    Rename "$INSTDIR" "$INSTDIR.stale"
    ${If} ${Errors}
      DetailPrint "Could not move old files, continuing anyway."
    ${EndIf}
  ${EndIf}
!macroend

; 安装收尾：清掉上面挪开的残留
!macro customInstall
  Delete "$INSTDIR\*.stale1"
  Delete "$INSTDIR\*.stale2"
  RMDir /r "$INSTDIR.stale"
!macroend

!macro customUnInstall
  Delete "$INSTDIR\*.stale1"
  Delete "$INSTDIR\*.stale2"
  RMDir /r "$INSTDIR.stale"
!macroend
