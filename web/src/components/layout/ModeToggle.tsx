'use client'

// React Imports
import { useEffect } from 'react'

// Third-party Imports
import { useTheme } from 'next-themes'
import { MoonStarIcon, SunIcon } from 'lucide-react'

// Type Imports
import type { Mode } from '@/contexts/settingsContext'

// Component Imports
import { Button } from '@/components/ui/button'

// Hook Imports
import { useSettings } from '@/hooks/use-settings'

const ModeToggle = () => {
  // Hooks
  const { setTheme, resolvedTheme } = useTheme()
  const { settings, updateSettings } = useSettings()

  const handleModeChange = () => {
    // Use resolvedTheme to get the actual current theme being displayed
    // This handles the system mode correctly by checking what's actually rendered
    const currentTheme = resolvedTheme || settings.mode || 'light'
    const newMode: Mode = currentTheme === 'dark' ? 'light' : 'dark'

    // Update settings first
    updateSettings({ mode: newMode })

    // Then update next-themes
    setTheme(newMode)
  }

  useEffect(() => {
    if (settings.mode) {
      setTheme(settings.mode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode])

  return (
    <Button variant='ghost' size='icon' className='relative' onClick={handleModeChange}>
      <MoonStarIcon className='scale-100 dark:scale-0' />
      <SunIcon className='absolute scale-0 dark:scale-100' />
      <span className='sr-only'>Toggle theme</span>
    </Button>
  )
}

export default ModeToggle
