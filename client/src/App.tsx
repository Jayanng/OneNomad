import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import HunterStats from './pages/HunterStats'
import Security from './pages/Security'
import Docs from './pages/Docs'
import Liquidity from './pages/Liquidity'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/hunter-stats" element={<HunterStats />} />
        <Route path="/security" element={<Security />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/liquidity" element={<Liquidity />} />
      </Routes>
    </BrowserRouter>
  )
}
