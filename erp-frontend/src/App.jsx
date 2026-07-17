import { Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import PageTransition from './components/PageTransition';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Tickets from './pages/Tickets';
import TicketDetail from './pages/TicketDetail';
import Teams from './pages/Teams';
import Users from './pages/Users';
import PermissionGroups from './pages/PermissionGroups';
import Settings from './pages/Settings';
import KnowledgeBase from './pages/KnowledgeBase';
import Inbox from './pages/Inbox';
import AiEmailDrafts from './pages/AiEmailDrafts';
import Prompts from './pages/Prompts';
import ApprovalPage from './pages/ApprovalPage';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Supervision from './pages/Supervision';
import Documentation from './pages/Documentation';
import SkillsManagement from './pages/SkillsManagement';
import TransitionDashboard from './pages/TransitionDashboard';

export default function App() {
  // Les transitions de pages sont gérées dans MainLayout (Outlet uniquement).
  // La sidebar ne re-monte plus à chaque navigation.
  return (
    <ErrorBoundary>
    <Routes>
        <Route path="/login" element={<PageTransition><Login /></PageTransition>} />
        <Route path="/approve/:token" element={<PageTransition><ApprovalPage /></PageTransition>} />
        <Route path="/forgot-password" element={<PageTransition><ForgotPassword /></PageTransition>} />
        <Route path="/reset-password/:token" element={<PageTransition><ResetPassword /></PageTransition>} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="tickets" element={<Tickets />} />
          <Route path="tickets/:id" element={<TicketDetail />} />
          <Route path="teams" element={<Teams />} />
          <Route path="knowledge-base" element={<KnowledgeBase />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="email-drafts" element={<AiEmailDrafts />} />
          <Route
            path="supervision"
            element={
              <ProtectedRoute roles={['ADMIN', 'TECHNICIAN']}>
                <Supervision />
              </ProtectedRoute>
            }
          />
          <Route
            path="users"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <Users />
              </ProtectedRoute>
            }
          />
          <Route
            path="permission-groups"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <PermissionGroups />
              </ProtectedRoute>
            }
          />
          <Route
            path="settings"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="prompts"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <Prompts />
              </ProtectedRoute>
            }
          />
          <Route
            path="documentation"
            element={<Documentation />}
          />
          <Route
            path="skills"
            element={
              <ProtectedRoute roles={['ADMIN', 'TECHNICIAN']}>
                <SkillsManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="transition"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <TransitionDashboard />
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}

