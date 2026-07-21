!macro NSIS_HOOK_POSTINSTALL
  Delete "$INSTDIR\resources\dream-skin-engine\assets\codex-region-contract.json"
  Delete "$INSTDIR\resources\dream-skin-engine\assets\region-contract.js"
  Delete "$INSTDIR\resources\dream-skin-engine\tests\region-contract.test.mjs"
  CreateShortCut "$DESKTOP\Codex Dream Skin Studio.lnk" "$INSTDIR\Codex Dream Skin Studio.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$DESKTOP\Codex Dream Skin Studio.lnk"
!macroend
