!include LogicLib.nsh

!macro customPageAfterChangeDir
  Function ExtractQuotedExecutable
    Exch $R0
    Push $R1
    Push $R2

    StrCpy $R1 1
    ExtractQuotedExecutableLoop:
      StrCpy $R2 $R0 1 $R1
      StrCmp $R2 "" ExtractQuotedExecutableInvalid
      StrCmp $R2 '"' ExtractQuotedExecutableDone
      IntOp $R1 $R1 + 1
      Goto ExtractQuotedExecutableLoop

    ExtractQuotedExecutableDone:
      StrCpy $R0 $R0 $R1 1
      Goto ExtractQuotedExecutableExit

    ExtractQuotedExecutableInvalid:
      StrCpy $R0 ""

    ExtractQuotedExecutableExit:
      Pop $R2
      Pop $R1
      Exch $R0
  FunctionEnd

  Function MigratePerMachineInstall
    ${if} $installMode != "CurrentUser"
    ${orIf} $hasPerMachineInstallation != "1"
      Abort
    ${endif}

    ReadRegStr $R0 HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    ${if} $R0 == ""
      MessageBox MB_OK|MB_ICONSTOP "检测到现有的所有用户安装，但找不到卸载程序。请修复或卸载旧版本后重试。"
      Quit
    ${endif}

    Push $R0
    Call ExtractQuotedExecutable
    Pop $R1
    ${if} $R1 == ""
    ${orIfNot} ${FileExists} "$R1"
      MessageBox MB_OK|MB_ICONSTOP "现有的所有用户安装已损坏，无法安全迁移。请修复或卸载旧版本后重试。"
      Quit
    ${endif}

    StrCpy $R5 "$PLUGINSDIR\old-machine-uninstaller.exe"
    ClearErrors
    CopyFiles /SILENT "$R1" "$R5"
    ${if} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "无法准备旧版本卸载程序，安装范围没有更改。"
      Quit
    ${endif}

    ${StdUtils.ExecShellWaitEx} $R2 $R3 "$R5" "runas" "/S /KEEP_APP_DATA /allusers --updated _?=$perMachineInstallationFolder"
    ${if} $R2 != "ok"
      MessageBox MB_OK|MB_ICONSTOP "未能获得管理员权限，安装范围没有更改。"
      Quit
    ${endif}

    ${StdUtils.WaitForProcEx} $R4 $R3
    ${if} $R4 != 0
      MessageBox MB_OK|MB_ICONSTOP "旧版本卸载失败，安装范围没有更改。错误代码：$R4"
      Quit
    ${endif}

    StrCpy $hasPerMachineInstallation "0"
    Abort
  FunctionEnd

  Page custom MigratePerMachineInstall
!macroend
