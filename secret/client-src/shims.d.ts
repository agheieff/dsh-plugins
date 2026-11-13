// The page lends these to plugins at runtime; only the parts used here are declared.
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { FC, ReactNode } from 'react'
  export const Button: FC<{
    variant?: 'primary' | 'outline' | 'ghost'
    disabled?: boolean
    onClick?: () => void
    className?: string
    children?: ReactNode
  }>
}
