import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "./api"

export async function configureOverdueNotifications(): Promise<void> {
  if (!isTauri) return

  let granted = false
  try {
    if ("Notification" in window) {
      const permission =
        window.Notification.permission === "default"
          ? await window.Notification.requestPermission()
          : window.Notification.permission
      granted = permission === "granted"
    }
  } catch (error) {
    console.warn("Could not request Reminders notification permission", error)
  }

  try {
    await invoke("set_overdue_notification_permission", { granted })
  } catch (error) {
    console.warn("Could not configure overdue reminder notifications", error)
  }
}
