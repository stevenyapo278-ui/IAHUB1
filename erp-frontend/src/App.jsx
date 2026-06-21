import { Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
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
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/approve/:token" element={<ApprovalPage />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />
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
      </Route>
    </Routes>
  );
}
