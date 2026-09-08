import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { RepoProvider } from './lib/context/RepoContext'
import Layout from './components/layout/Layout'
import DashboardPage from './pages/DashboardPage'
import RepositoryPage from './pages/RepositoryPage'
import PlaceholderPage from './pages/PlaceholderPage'

export default function App() {
  return (
    <RepoProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/"             element={<DashboardPage />}  />
            <Route path="/repository"   element={<RepositoryPage />} />
            <Route path="/architecture" element={<PlaceholderPage />} />
            <Route path="/ai-copilot"   element={<PlaceholderPage />} />
            <Route path="/impact"       element={<PlaceholderPage />} />
            <Route path="/security"     element={<PlaceholderPage />} />
            <Route path="/code-health"  element={<PlaceholderPage />} />
            <Route path="/settings"     element={<PlaceholderPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </RepoProvider>
  )
}
