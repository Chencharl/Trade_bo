import { simulate } from './engine'
import type { Config, Setup } from './engine'

self.onmessage = (
  event: MessageEvent<{ id: number; key: string; config: Config; pinned: Setup | null }>,
) => {
  const { id, key, config, pinned } = event.data
  try {
    self.postMessage({
      id,
      key,
      result: simulate(config),
      comparison: pinned ? simulate({ ...config, ...pinned }) : null,
    })
  } catch (error) {
    self.postMessage({
      id,
      key,
      error: error instanceof Error ? error.message : 'The simulation could not run.',
    })
  }
}
