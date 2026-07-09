'use client'

// React Imports
import { useContext } from 'react'

// Context Imports
import { SettingsContext } from '@/contexts/settingsContext'

export const useSettings = () => {
  const context = useContext(SettingsContext)

  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }

  return context
}
