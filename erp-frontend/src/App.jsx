import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';

// ─── Code splitting par route ────────────────────────────────────────────────
// Chaque page est un chunk séparé chargé à la demande : la page de login ne
// télécharge plus Recharts/Supervision/etc. Le bundle principal passe de
// ~1,2 Mo à quelques centaines de Ko, ce qui divise le temps de premier
// affichage, surtout sur mobile et connexions lentes.
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Tickets = lazy(() => import('./pages/Tickets'));
const TicketDetail = lazy(() => import('./pages/TicketDetail'));
const Teams = lazy(() => import('./pages/Teams'));
const Users = lazy(() => import('./pages/Users'));
const PermissionGroups = lazy(() => import('./pages/PermissionGroups'));
const Settings = lazy(() => import('./pages/Settings'));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'));
const Inbox = lazy(() => import('./pages/Inbox'));
const AiEmailDrafts = lazy(() => import('./pages/AiEmailDrafts'));
const ValidationCenter = lazy(() => import('./pages/ValidationCenter'));
const Prompts = lazy(() => import('./pages/Prompts'));
const ApprovalPage = lazy(() => import('./pages/ApprovalPage'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Supervision = lazy(() => import('./pages/Supervision'));
const TechnicianStats = lazy(() => import('./pages/TechnicianStats'));
const Documentation = lazy(() => import('./pages/Documentation'));
const SkillsManagement = lazy(() => import('./pages/SkillsManagement'));
const ActivityLogs = lazy(() => import('./pages/ActivityLogs'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));
const AiWeeklyReports = lazy(() => import('./pages/AiWeeklyReports'));
const Locations = lazy(() => import('./pages/Locations'));
const Categories = lazy(() => import('./pages/Categories'));
const Assets = lazy(() => import('./pages/Assets'));
const Portal = lazy(() => import('./pages/Portal'));

// Fallback léger pendant le chargement d'un chunk (réseau ou navigation rapide)
function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3" aria-busy="true">
      <span className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      <p className="text-sm text-on-surface-variant">Chargement…</p>
    </div>
  );
}

export default function App() {
  // Les transitions de pages sont gérées dans MainLayout (Outlet uniquement).
  // La sidebar ne re-monte plus à chaque navigation.
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
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
            <Route path="portal" element={<Portal />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="tickets/:id" element={<TicketDetail />} />
            <Route path="teams" element={<Teams />} />
            <Route path="knowledge-base" element={<KnowledgeBase />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="email-drafts" element={<ValidationCenter />} />
            <Route
              path="supervision"
              element={
                <ProtectedRoute roles={['ADMIN', 'TECHNICIAN']}>
                  <Supervision />
                </ProtectedRoute>
              }
            />
            <Route
              path="technician-stats"
              element={
                <ProtectedRoute roles={['ADMIN', 'TECHNICIAN', 'HOTLINE']}>
                  <TechnicianStats />
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
              path="logs"
              element={
                <ProtectedRoute roles={['ADMIN', 'TECHNICIAN', 'HOTLINE']}>
                  <ActivityLogs />
                </ProtectedRoute>
              }
            />
            <Route
              path="audit"
              element={
                <ProtectedRoute roles={['ADMIN']}>
                  <AuditLogs />
                </ProtectedRoute>
              }
            />
            <Route
              path="locations"
              element={
                <ProtectedRoute roles={['ADMIN', 'HOTLINE', 'TECHNICIAN']}>
                  <Locations />
                </ProtectedRoute>
              }
            />
            <Route
              path="categories"
              element={
                <ProtectedRoute roles={['ADMIN', 'HOTLINE', 'TECHNICIAN']}>
                  <Categories />
                </ProtectedRoute>
              }
            />
            <Route
              path="assets"
              element={
                <ProtectedRoute roles={['ADMIN', 'HOTLINE', 'TECHNICIAN', 'REQUESTER']}>
                  <Assets />
                </ProtectedRoute>
              }
            />
            <Route
              path="ai-weekly-reports"
              element={
                <ProtectedRoute roles={['ADMIN', 'HOTLINE']}>
                  <AiWeeklyReports />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
