import { lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';

// ─── Code splitting par route ────────────────────────────────────────────────
// Chaque page est un chunk séparé chargé à la demande : la page de login ne
// télécharge plus Recharts/Supervision/etc. Le bundle principal passe de
// ~1,2 Mo à quelques centaines de Ko, ce qui divise le temps de premier
// affichage, surtout sur mobile et connexions lentes.
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./dashboard/DashboardPage'));
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
const TechnicianStats = lazy(() => import('./pages/TechnicianStats'));
const Documentation = lazy(() => import('./pages/Documentation'));
const SkillsManagement = lazy(() => import('./pages/SkillsManagement'));
const ActivityLogs = lazy(() => import('./pages/ActivityLogs'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));
const LogsHub = lazy(() => import('./pages/LogsHub'));
const AiWeeklyReports = lazy(() => import('./pages/AiWeeklyReports'));
const Locations = lazy(() => import('./pages/Locations'));
const Categories = lazy(() => import('./pages/Categories'));
const Assets = lazy(() => import('./pages/Assets'));
const Portal = lazy(() => import('./pages/Portal'));
const TicketEvolution = lazy(() => import('./pages/TicketEvolution'));
const Problems = lazy(() => import('./pages/Problems'));
const ProblemDetail = lazy(() => import('./pages/ProblemDetail'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const ChatMonitor = lazy(() => import('./pages/ChatMonitor'));

// Écran de chargement plein écran, centré — affiché pendant le chargement d'un chunk
// (navigation) et le premier montage React. Même visuel que le boot loader d'index.html.
const EASE = [0.16, 1, 0.3, 1];

function PageLoader() {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background/85 backdrop-blur-sm"
      role="status"
      aria-busy="true"
      aria-label="Chargement de la plateforme"
    >
      {/* Logo animé : halo pulsant + pastille dégradée */}
      <div className="relative flex items-center justify-center">
        <motion.span
          className="absolute w-20 h-20 rounded-full border-2 border-primary/40"
          animate={{ scale: [1, 1.45], opacity: [0.6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
        />
        <motion.span
          className="absolute w-20 h-20 rounded-full border-2 border-primary/25"
          animate={{ scale: [1, 1.45], opacity: [0.6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut', delay: 0.8 }}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/70 shadow-xl shadow-primary/25 flex items-center justify-center"
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-primary-foreground">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.div>
      </div>

      {/* Nom + points bondissants */}
      <div className="flex flex-col items-center gap-2.5">
        <span className="text-sm font-bold tracking-wide text-on-surface">ERP ITSM</span>
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-primary"
              animate={{ y: [0, -5, 0], opacity: [0.35, 1, 0.35] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
            />
          ))}
        </div>
      </div>

      {/* Barre de progression fine */}
      <div className="h-0.5 w-40 overflow-hidden rounded-full bg-surface-container-high">
        <motion.div
          className="h-full w-1/3 rounded-full bg-primary"
          animate={{ x: ['-100%', '300%'] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
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
            <Route path="chat" element={<ChatPage />} />
            <Route
              path="chat-monitor"
              element={
                <ProtectedRoute roles={['SUPERADMIN']}>
                  <ChatMonitor />
                </ProtectedRoute>
              }
            />
            <Route path="tickets" element={<ProtectedRoute permission="tickets.view"><Tickets /></ProtectedRoute>} />
            <Route
              path="ticket-evolution"
              element={
                <ProtectedRoute roles={['ADMIN', 'TECHNICIAN', 'HOTLINE']}>
                  <TicketEvolution />
                </ProtectedRoute>
              }
            />
            <Route path="tickets/:id" element={<ProtectedRoute permission="tickets.view"><TicketDetail /></ProtectedRoute>} />
            <Route path="problems" element={<ProtectedRoute roles={['ADMIN', 'HOTLINE', 'SUPERADMIN']}><Problems /></ProtectedRoute>} />
            <Route path="problems/:id" element={<ProtectedRoute roles={['ADMIN', 'HOTLINE', 'SUPERADMIN']}><ProblemDetail /></ProtectedRoute>} />
            <Route path="teams" element={<ProtectedRoute permission="teams.manage"><Teams /></ProtectedRoute>} />
            <Route path="knowledge-base" element={<KnowledgeBase />} />
            <Route path="inbox" element={<ProtectedRoute permission="inbox.sync"><Inbox /></ProtectedRoute>} />
            <Route path="email-drafts" element={<ProtectedRoute permission="emaildrafts.manage"><ValidationCenter defaultTab="drafts" /></ProtectedRoute>} />

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
                <ProtectedRoute roles={['ADMIN', 'SUPERADMIN']}>
                  <SkillsManagement />
                </ProtectedRoute>
              }
            />
            <Route
              path="logs"
              element={
                <ProtectedRoute roles={['ADMIN', 'TECHNICIAN', 'HOTLINE']}>
                  <LogsHub />
                </ProtectedRoute>
              }
            />
            {/* Compat : /audit redirige vers l'onglet Audit de la vue unifiée */}
            <Route
              path="audit"
              element={
                <ProtectedRoute roles={['ADMIN']}>
                  <Navigate to="/logs?tab=audit" replace />
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
