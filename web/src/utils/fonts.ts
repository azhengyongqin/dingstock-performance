// Third-party Imports
import { GeistPixelSquare } from 'geist/font/pixel'
import {
  DM_Sans,
  Figtree,
  Geist,
  Geist_Mono,
  Inter,
  JetBrains_Mono,
  Lora,
  Merriweather,
  Noto_Sans,
  Noto_Serif,
  Nunito_Sans,
  Outfit,
  Playfair_Display,
  Public_Sans,
  Raleway,
  Roboto,
  Roboto_Slab
} from 'next/font/google'

export const fontGeist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
export const fontGeistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
export const fontDMSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans' })
export const fontFigtree = Figtree({ subsets: ['latin'], variable: '--font-figtree' })
export const fontInter = Inter({ subsets: ['latin'], variable: '--font-inter' })
export const fontJetBrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' })
export const fontLora = Lora({ subsets: ['latin'], variable: '--font-lora' })
export const fontMerriweather = Merriweather({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-merriweather'
})
export const fontNotoSans = Noto_Sans({ subsets: ['latin'], variable: '--font-noto-sans' })
export const fontNotoSerif = Noto_Serif({ subsets: ['latin'], variable: '--font-noto-serif' })
export const fontNunutoSans = Nunito_Sans({ subsets: ['latin'], variable: '--font-nunito-sans' })
export const fontOutfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })
export const fontPlayfairDisplay = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair-display' })
export const fontPublicSans = Public_Sans({ subsets: ['latin'], variable: '--font-public-sans' })
export const fontRaleway = Raleway({ subsets: ['latin'], variable: '--font-raleway' })
export const fontRoboto = Roboto({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-roboto' })
export const fontRobotoSlab = Roboto_Slab({ subsets: ['latin'], variable: '--font-roboto-slab' })

// Re-export geist pixel font (pre-instantiated, no function call needed)
export { GeistPixelSquare as fontGeistPixelSquare }

// All font instances – spread as className on <html> in layout.tsx to register CSS variables
export const allFonts = [
  fontGeist,
  fontGeistMono,
  fontDMSans,
  fontFigtree,
  fontInter,
  fontJetBrainsMono,
  fontLora,
  fontMerriweather,
  fontNotoSans,
  fontNotoSerif,
  fontNunutoSans,
  fontOutfit,
  fontPlayfairDisplay,
  fontPublicSans,
  fontRaleway,
  fontRoboto,
  fontRobotoSlab,
  GeistPixelSquare
]

export type FontGroup = 'sans' | 'mono' | 'serif'

// Font selector config – label, CSS variable, and group for each font
export const FONT_CONFIG = {
  geist: { label: 'Geist', variable: '--font-geist-sans', group: 'sans' as FontGroup },
  'dm-sans': { label: 'DM Sans', variable: '--font-dm-sans', group: 'sans' as FontGroup },
  figtree: { label: 'Figtree', variable: '--font-figtree', group: 'sans' as FontGroup },
  inter: { label: 'Inter', variable: '--font-inter', group: 'sans' as FontGroup },
  'noto-sans': { label: 'Noto Sans', variable: '--font-noto-sans', group: 'sans' as FontGroup },
  'nunito-sans': { label: 'Nunito Sans', variable: '--font-nunito-sans', group: 'sans' as FontGroup },
  outfit: { label: 'Outfit', variable: '--font-outfit', group: 'sans' as FontGroup },
  'public-sans': { label: 'Public Sans', variable: '--font-public-sans', group: 'sans' as FontGroup },
  raleway: { label: 'Raleway', variable: '--font-raleway', group: 'sans' as FontGroup },
  roboto: { label: 'Roboto', variable: '--font-roboto', group: 'sans' as FontGroup },
  'geist-mono': { label: 'Geist Mono', variable: '--font-geist-mono', group: 'mono' as FontGroup },
  'jetbrains-mono': { label: 'JetBrains Mono', variable: '--font-jetbrains-mono', group: 'mono' as FontGroup },
  lora: { label: 'Lora', variable: '--font-lora', group: 'serif' as FontGroup },
  merriweather: { label: 'Merriweather', variable: '--font-merriweather', group: 'serif' as FontGroup },
  'noto-serif': { label: 'Noto Serif', variable: '--font-noto-serif', group: 'serif' as FontGroup },
  'playfair-display': { label: 'Playfair Display', variable: '--font-playfair-display', group: 'serif' as FontGroup },
  'roboto-slab': { label: 'Roboto Slab', variable: '--font-roboto-slab', group: 'serif' as FontGroup },
  'geist-pixel': { label: 'Geist Pixel', variable: '--font-geist-pixel-square', group: 'mono' as FontGroup }
} as const

// Ordered group labels for rendering
export const FONT_GROUPS: { key: FontGroup; label: string }[] = [
  { key: 'sans', label: 'Sans' },
  { key: 'mono', label: 'Mono' },
  { key: 'serif', label: 'Serif' }
]

export type FontKey = keyof typeof FONT_CONFIG
