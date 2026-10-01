import * as React from "react"
import { useTheme } from "@productivity-os/shared-ui/components/theme-provider"

export function NativeThemeSync() {
  const { theme } = useTheme()

  React.useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) return
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().setTheme(theme === "system" ? null : theme),
    )
  }, [theme])

  return null
}
