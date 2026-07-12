import ReactDOM from 'react-dom/client'
import { PivotPage } from './PivotPage'
import './index.css'

function Root() {
  return <PivotPage isDark={true} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />)
