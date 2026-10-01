import * as React from "react"
import {
  useTheme,
  type Theme,
} from "@productivity-os/shared-ui/components/theme-provider"
import { Monitor, Moon, Sun } from "@productivity-os/shared-ui/components/sf-symbols"

const appearances: Array<{
  value: Theme
  label: string
  icon: React.ReactNode
}> = [
  { value: "system", label: "System", icon: <Monitor aria-hidden="true" /> },
  { value: "light", label: "Light", icon: <Sun aria-hidden="true" /> },
  { value: "dark", label: "Dark", icon: <Moon aria-hidden="true" /> },
]

export function Preferences() {
  const { theme, setTheme } = useTheme()

  return (
    <main className="reminders-preferences">
      <header>
        <h1>Reminders Settings</h1>
        <p>Choose how Reminders appears on this Mac.</p>
      </header>
      <section className="reminders-preferences-group" aria-labelledby="appearance-title">
        <div>
          <h2 id="appearance-title">Appearance</h2>
          <p>System changes automatically with your Mac’s appearance.</p>
        </div>
        <div className="reminders-appearance-options" role="radiogroup" aria-label="Appearance">
          {appearances.map((appearance) => (
            <button
              key={appearance.value}
              type="button"
              role="radio"
              aria-checked={theme === appearance.value}
              data-selected={theme === appearance.value || undefined}
              onClick={() => setTheme(appearance.value)}
            >
              {appearance.icon}
              <span>{appearance.label}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="reminders-preferences-group reminders-preferences-status">
        <div>
          <h2>Menu Bar</h2>
          <p>The menu-bar icon shows how many incomplete reminders are due today.</p>
        </div>
        <span>Always On</span>
      </section>
    </main>
  )
}
