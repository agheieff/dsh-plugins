/** Browser half: the `request_secret` card, registered in dsh's per-tool card slot. */
import { SecretCard } from './SecretCard.tsx'

interface Slots {
  inject(name: string, register: () => unknown): void
  register(entry: { name: string; key: string; priority?: number }, component: unknown): unknown
}

export const inject = ['slots']

export function apply(ctx: { slots: Slots }): void {
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register({ name: 'tool.call.toolview', key: 'request_secret' }, SecretCard),
  )
}
