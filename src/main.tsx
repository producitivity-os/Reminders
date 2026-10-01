import { createRoot } from "react-dom/client";
import "@productivity-os/shared-ui/globals.css";
import { SharedUiProvider } from "@productivity-os/shared-ui/components/shared-ui-provider";
import { NativeThemeSync } from "@productivity-os/shared-ui/components/native-theme-sync";
import { ThemeProvider } from "@productivity-os/shared-ui/components/theme-provider";
import { App } from "./App";
import { Preferences } from "./Preferences";
import { configureOverdueNotifications } from "./overdue-notifications";
import "./App.css";

const preferencesWindow =
  new URLSearchParams(window.location.search).get("window") === "preferences";

if (!preferencesWindow) void configureOverdueNotifications();

createRoot(document.getElementById("root")!).render(
  <ThemeProvider
    defaultTheme="system"
    storageKey="reminders-theme"
    systemThemeMigrationVersion="2026-09"
  >
    <SharedUiProvider>
      <NativeThemeSync />
      {preferencesWindow ? <Preferences /> : <App />}
    </SharedUiProvider>
  </ThemeProvider>,
);
