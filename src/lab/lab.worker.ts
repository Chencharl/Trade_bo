import { evaluateLab } from './engine'
import type { LabConfig, MonthlyRow } from './engine'
self.onmessage = (event: MessageEvent<{ rows: MonthlyRow[]; config: LabConfig }>) => {
  try {
    self.postMessage({ result: evaluateLab(event.data.rows, event.data.config) })
  } catch (reason) {
    self.postMessage({
      error: reason instanceof Error ? reason.message : 'The evaluation could not finish.',
    })
  }
}
