'use client'

// Next Imports
import { useTheme } from 'next-themes'
import Link from 'next/link'

// Third-party Imports
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { BanIcon, CircleQuestionMarkIcon, PaletteIcon, RefreshCcwIcon } from 'lucide-react'

// Type Imports
import {
  initialSettings,
  type Collapsible,
  type FontKey,
  type Layout,
  type Mode,
  type Radius,
  type Scale,
  type Variant
} from '@/contexts/settingsContext'
import type { ThemePresetKey } from '@/utils/theme-presets'

// Component Imports
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from '@/components/ui/select'
import { useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// Hook Imports
import { useSettings } from '@/hooks/use-settings'

// Util Imports
import { FONT_CONFIG, FONT_GROUPS } from '@/utils/fonts'
import { themePresets } from '@/utils/theme-presets'

// Theme modes
const MODES: { value: Mode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

// Content layouts
const LAYOUTS: { value: Layout; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'full', label: 'Full' }
]

// Scale modes
const SCALE_MODES: { value: Scale; label: string }[] = [
  { value: 'sm', label: 'SM' },
  { value: 'md', label: 'MD' },
  { value: 'lg', label: 'LG' }
]

// Sidebar modes
const SIDEBAR_MODES: { value: Collapsible; label: string }[] = [
  { value: 'none', label: 'Default' },
  { value: 'icon', label: 'Icon' },
  { value: 'offcanvas', label: 'Full' }
]

// Sidebar variants
const VARIANTS: { value: Variant; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'inset', label: 'Inset' },
  { value: 'floating', label: 'Floating' }
]

// Border radii
const RADII: { value: Radius; tooltip: string }[] = [
  { value: 'none', tooltip: '0rem' },
  { value: 'sm', tooltip: '0.45rem' },
  { value: 'md', tooltip: '0.625rem' },
  { value: 'lg', tooltip: '0.875rem' }
]

// Default preset primary colors from globals.css :root and .dark
const DEFAULT_PRIMARY: Record<'light' | 'dark', string> = {
  light: 'oklch(0.205 0 0)',
  dark: 'oklch(0.922 0 0)'
}

const ThemeCustomizer = () => {
  const { settings, updateSettings } = useSettings()
  const { resolvedTheme } = useTheme()
  const sidebarMode = settings.sidebarOpen ? 'none' : settings.collapsible
  const { setOpen } = useSidebar()

  const mode = resolvedTheme === 'dark' ? 'dark' : 'light'

  const activePreset =
    settings.themePreset === 'default' ? null : themePresets[settings.themePreset as keyof typeof themePresets]

  const activePrimaryColor = activePreset?.styles[mode].primary ?? DEFAULT_PRIMARY[mode]
  const activeLabel = activePreset?.label ?? 'Default'

  return (
    <Popover>
      <PopoverTrigger render={<Button variant='ghost' size='icon' />}>
        <PaletteIcon />
      </PopoverTrigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner align='end' sideOffset={8} positionMethod='fixed' className='isolate z-50'>
          <PopoverPrimitive.Popup className='bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 relative z-50 flex max-h-[calc(100vh-10rem)] w-72 origin-(--transform-origin) flex-col gap-5 overflow-y-auto rounded-md px-0 py-3 text-sm shadow-md ring-1 outline-hidden duration-100'>
            <div className='flex flex-col gap-1 px-3'>
              <div className='flex items-center justify-between'>
                <h3 className='text-lg font-medium'>Theme Customizer</h3>
                <div className='flex items-center gap-2'>
                  <Tooltip>
                    <TooltipTrigger render={<Button size='icon-sm' variant='ghost' />}>
                      <CircleQuestionMarkIcon />
                    </TooltipTrigger>
                    <TooltipContent side='bottom' className='max-w-62'>
                      <p>
                        Refer to the{' '}
                        <Link
                          href='https://shadcnstudio.com/docs/documentation-admin/customization#theme-config'
                          target='_blank'
                          className='inline font-medium underline'
                        >
                          documentation
                        </Link>{' '}
                        for detailed theme customization guidance.
                      </p>
                    </TooltipContent>
                  </Tooltip>

                  <Button
                    size='icon-sm'
                    variant='ghost'
                    onClick={() => {
                      updateSettings(initialSettings)
                      setOpen(initialSettings.sidebarOpen)
                    }}
                  >
                    <RefreshCcwIcon />
                  </Button>
                </div>
              </div>
              <p className='text-muted-foreground text-sm'>Customize your theme to your liking.</p>
            </div>

            {/* ── Theme Preset ── */}
            <div className='flex flex-col gap-1 px-3'>
              <Label htmlFor='theme-preset'>Theme Preset</Label>
              <Select
                id='theme-preset'
                value={settings.themePreset}
                onValueChange={value => updateSettings({ themePreset: value as ThemePresetKey })}
              >
                <SelectTrigger className='input-sm w-full'>
                  <span className='size-2.5 shrink-0 rounded-full' style={{ background: activePrimaryColor }} />
                  <span className='flex-1 text-left'>{activeLabel}</span>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} className='p-1'>
                  <SelectItem value='default' className='[&>div]:items-center'>
                    <span className='size-2 shrink-0 rounded-full' style={{ background: DEFAULT_PRIMARY[mode] }} />
                    Default
                  </SelectItem>
                  {(
                    Object.entries(themePresets) as [
                      keyof typeof themePresets,
                      (typeof themePresets)[keyof typeof themePresets]
                    ][]
                  ).map(([key, preset]) => (
                    <SelectItem key={key} value={key} className='[&>div]:items-center'>
                      <span
                        className='size-2 shrink-0 rounded-full'
                        style={{ background: preset.styles[mode].primary }}
                      />
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* ── Font ── */}
            <div className='flex flex-col gap-1 px-3'>
              <Label htmlFor='font'>Font</Label>
              <Select
                id='font'
                value={settings.font}
                onValueChange={value => updateSettings({ font: value as FontKey })}
              >
                <SelectTrigger className='input-sm w-full'>
                  <span
                    className='flex-1 text-left'
                    style={{ fontFamily: `var(${FONT_CONFIG[settings.font]?.variable ?? '--font-geist-sans'})` }}
                  >
                    {FONT_CONFIG[settings.font]?.label ?? 'Geist'}
                  </span>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} className='p-1'>
                  {FONT_GROUPS.map(({ key: groupKey, label: groupLabel }) => {
                    const fonts = (Object.entries(FONT_CONFIG) as [FontKey, (typeof FONT_CONFIG)[FontKey]][]).filter(
                      ([, config]) => config.group === groupKey
                    )

                    if (fonts.length === 0) return null

                    return (
                      <SelectGroup key={groupKey}>
                        <SelectLabel>{groupLabel}</SelectLabel>
                        {fonts.map(([key, config]) => (
                          <SelectItem key={key} value={key} className='[&>div]:items-center'>
                            <span style={{ fontFamily: `var(${config.variable})` }}>{config.label}</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* ── Mode ── */}
            <div className='flex flex-col gap-1 px-3'>
              <Label htmlFor='color-mode'>Color Mode</Label>
              <RadioGroup
                id='color-mode'
                className='grid grid-cols-3 gap-0 rounded-md'
                value={settings.mode}
                onValueChange={v => updateSettings({ mode: v as Mode })}
              >
                {MODES.map(({ value, label }) => (
                  <Label
                    htmlFor={`mode-${value}`}
                    key={value}
                    className='has-data-checked:bg-accent relative flex flex-col items-center gap-1 border px-2 py-2 text-center shadow-xs transition-[color,box-shadow] outline-none not-last:border-r-0 first:rounded-l-md last:rounded-r-md'
                  >
                    <RadioGroupItem
                      id={`mode-${value}`}
                      value={value}
                      className='sr-only absolute inset-0'
                      aria-label={`mode-${value}`}
                    />
                    <p className='text-foreground text-sm leading-none font-medium'>{label}</p>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            {/* ── Border Radius ── */}
            <div className='flex flex-col gap-1 px-3'>
              <Label htmlFor='radius'>Radius</Label>
              <RadioGroup
                id='radius'
                className='grid grid-cols-4 gap-0 rounded-md'
                value={settings.radius}
                onValueChange={v => updateSettings({ radius: v as Radius })}
              >
                {RADII.map(({ value, tooltip }) => (
                  <Tooltip key={value}>
                    <TooltipTrigger
                      render={
                        <Label
                          htmlFor={`radius-${value}`}
                          className='has-data-checked:bg-accent relative flex flex-col items-center gap-3 border px-2 py-2 text-center shadow-xs transition-[color,box-shadow] outline-none not-last:border-r-0 first:rounded-l-md last:rounded-r-md'
                        />
                      }
                    >
                      <RadioGroupItem
                        id={`radius-${value}`}
                        value={value}
                        className='sr-only absolute inset-0'
                        aria-label={`radius-${value}`}
                      />
                      {value === 'none' ? (
                        <BanIcon className='size-3.5' />
                      ) : (
                        <p className='text-foreground text-sm leading-none font-medium'>{value.toUpperCase()}</p>
                      )}
                    </TooltipTrigger>
                    <TooltipContent>{tooltip}</TooltipContent>
                  </Tooltip>
                ))}
              </RadioGroup>
            </div>

            {/* ── Container ── */}
            <div className='flex flex-col gap-1 px-3'>
              <Label htmlFor='layout'>Content Layout</Label>
              <RadioGroup
                id='layout'
                className='grid grid-cols-2 gap-0 rounded-md'
                value={settings.layout}
                onValueChange={v => updateSettings({ layout: v as Layout })}
              >
                {LAYOUTS.map(({ value, label }) => (
                  <Label
                    htmlFor={`layout-${value}`}
                    key={value}
                    className='has-data-checked:bg-accent relative flex flex-col items-center gap-3 border px-2 py-2 text-center shadow-xs transition-[color,box-shadow] outline-none not-last:border-r-0 first:rounded-l-md last:rounded-r-md'
                  >
                    <RadioGroupItem
                      id={`layout-${value}`}
                      value={value}
                      className='sr-only absolute inset-0'
                      aria-label={`layout-${value}`}
                    />
                    <p className='text-foreground text-sm leading-none font-medium'>{label}</p>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            {/* ── Scale ── */}
            <div className='flex flex-col gap-1 px-3'>
              <Label htmlFor='scale'>Scale</Label>
              <RadioGroup
                id='scale'
                className='grid grid-cols-3 gap-0 rounded-md'
                value={settings.scale}
                onValueChange={v => updateSettings({ scale: v as Scale })}
              >
                {SCALE_MODES.map(item => (
                  <Label
                    htmlFor={`scale-${item.value}`}
                    key={item.value}
                    className='has-data-checked:bg-accent relative flex flex-col items-center gap-3 border px-2 py-2 text-center shadow-xs transition-[color,box-shadow] outline-none not-last:border-r-0 first:rounded-l-md last:rounded-r-md'
                  >
                    <RadioGroupItem
                      id={`scale-${item.value}`}
                      value={item.value}
                      className='sr-only absolute inset-0'
                      aria-label={`scale-${item.value}`}
                    />
                    <p className='text-foreground text-sm leading-none font-medium'>{item.label}</p>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            {/* ── Sidebar variant ── */}
            <div className='flex flex-col gap-1 px-3 max-xl:hidden'>
              <Label htmlFor='variant'>Sidebar Variant</Label>
              <RadioGroup
                id='variant'
                className='grid grid-cols-3 gap-0 rounded-md'
                value={settings.variant}
                onValueChange={v => updateSettings({ variant: v as Variant })}
              >
                {VARIANTS.map(({ value, label }) => (
                  <Label
                    htmlFor={`sidebar-variant-${value}`}
                    key={value}
                    className='has-data-checked:bg-accent relative flex flex-col items-center gap-3 border px-2 py-2 text-center shadow-xs transition-[color,box-shadow] outline-none not-last:border-r-0 first:rounded-l-md last:rounded-r-md'
                  >
                    <RadioGroupItem
                      id={`sidebar-variant-${value}`}
                      value={value}
                      className='sr-only absolute inset-0'
                      aria-label={`variant-${value}`}
                    />
                    <p className='text-foreground text-sm leading-none font-medium'>{label}</p>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            {/* ── Sidebar mode ── */}
            <div className='flex flex-col gap-1 px-3 max-xl:hidden'>
              <Label htmlFor='sidebar-mode'>Sidebar Mode</Label>
              <RadioGroup
                id='sidebar-mode'
                className='grid grid-cols-3 gap-0 rounded-md'
                value={sidebarMode}
                onValueChange={v => {
                  if (v === 'none') {
                    // Set sidebarOpen to true and collapsible to 'icon' so the
                    // header trigger collapses to icon mode (not off-screen)
                    updateSettings({ sidebarOpen: true, collapsible: 'icon' })
                    setOpen(true)

                    return
                  }

                  // For 'icon' or 'offcanvas', close sidebar and update collapsible
                  updateSettings({ sidebarOpen: false, collapsible: v as Collapsible })
                  setOpen(false)
                }}
              >
                {SIDEBAR_MODES.map(mode => (
                  <Label
                    htmlFor={`sidebar-mode-${mode.value}`}
                    key={mode.value}
                    className='has-data-checked:bg-accent relative flex flex-col items-center gap-3 border px-2 py-2 text-center shadow-xs transition-[color,box-shadow] outline-none not-last:border-r-0 first:rounded-l-md last:rounded-r-md'
                  >
                    <RadioGroupItem
                      id={`sidebar-mode-${mode.value}`}
                      value={mode.value}
                      className='sr-only absolute inset-0'
                      aria-label={`sidebar-mode-${mode.value}`}
                    />
                    <p className='text-foreground text-sm leading-none font-medium'>{mode.label}</p>
                  </Label>
                ))}
              </RadioGroup>
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </Popover>
  )
}

export default ThemeCustomizer
