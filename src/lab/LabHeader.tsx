import { ArrowLeft, ArrowUpRight, Github, Layers3 } from 'lucide-react'
const REPO = 'https://github.com/Chencharl/Trade_bo'
export default function LabHeader() {
  return (
    <header className="lab-header">
      <a className="atlas-brand" href="#" aria-label="TradeBo Atlas home">
        <span className="atlas-brand-mark">
          <Layers3 size={23} />
        </span>
        <span>
          tradebo<span className="brand-slash">/</span>
          <strong>lab</strong>
        </span>
      </a>
      <nav aria-label="Strategy Lab navigation">
        <a href="#">
          <ArrowLeft size={14} /> Atlas
        </a>
        <a href={`${REPO}/blob/main/docs/STRATEGY_RESEARCH.md`} target="_blank" rel="noreferrer">
          Research notes <ArrowUpRight size={14} />
        </a>
        <a href={REPO} target="_blank" rel="noreferrer" aria-label="View source on GitHub">
          <Github size={19} />
        </a>
      </nav>
    </header>
  )
}
