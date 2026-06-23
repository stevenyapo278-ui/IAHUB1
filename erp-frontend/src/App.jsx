import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
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

export default function App() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes key={location.pathname} location={location}>
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
          <Route index element={<PageTransition><Dashboard /></PageTransition>} />
          <Route path="tickets" element={<PageTransition><Tickets /></PageTransition>} />
          <Route path="tickets/:id" element={<PageTransition><TicketDetail /></PageTransition>} />
          <Route path="teams" element={<PageTransition><Teams /></PageTransition>} />
          <Route path="knowledge-base" element={<PageTransition><KnowledgeBase /></PageTransition>} />
          <Route path="inbox" element={<PageTransition><Inbox /></PageTransition>} />
          <Route path="email-drafts" element={<PageTransition><AiEmailDrafts /></PageTransition>} />
          <Route
            path="users"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <PageTransition><Users /></PageTransition>
              </ProtectedRoute>
            }
          />
          <Route
            path="permission-groups"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <PageTransition><PermissionGroups /></PageTransition>
              </ProtectedRoute>
            }
          />
          <Route
            path="settings"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <PageTransition><Settings /></PageTransition>
              </ProtectedRoute>
            }
          />
          <Route
            path="prompts"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <PageTransition><Prompts /></PageTransition>
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
    </AnimatePresence>
  );
}
