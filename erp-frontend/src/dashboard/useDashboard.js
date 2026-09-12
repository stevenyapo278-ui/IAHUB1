import useSWR from 'swr';
import api from '../api/client';

const fetcher = (url) => api.get(url).then(({ data }) => data);

// ── Dashboard configs ──
export function useDashboards() {
  const { data, error, isLoading, mutate } = useSWR('/dashboards', fetcher);
  return { dashboards: data || [], isLoading, error, mutate };
}

export function useDashboard(id) {
  const { data, error, isLoading, mutate } = useSWR(id ? `/dashboards/${id}` : null, fetcher);
  return { dashboard: data, isLoading, error, mutate };
}

// ── Dashboard data (existing endpoints, now with SWR) ──
export function useDashboardStats(days = 30) {
  const { data, error, isLoading } = useSWR(`/dashboard/stats?days=${days}`, fetcher, {
    refreshInterval: 30000,
  });
  return { stats: data, isLoading, error };
}

export function useActivityTrend(days = 30) {
  const { data, error, isLoading } = useSWR(`/dashboard/activity-trend?days=${days}`, fetcher);
  return { trend: Array.isArray(data) ? data : [], isLoading, error };
}

export function useRecentActivity() {
  const { data, error, isLoading } = useSWR('/dashboard/recent-activity', fetcher);
  return { activity: data || [], isLoading, error };
}

export function useTechnicianPerformance(days = 30) {
  const { data, error, isLoading } = useSWR(`/dashboard/technician-performance?days=${days}`, fetcher);
  return { techPerformance: data || [], isLoading, error };
}

export function useSlaAnalytics(days = 30) {
  const { data, error, isLoading } = useSWR(`/dashboard/sla-analytics?days=${days}`, fetcher);
  return { slaAnalytics: data, isLoading, error };
}

export function useIntegrations() {
  const { data, error, isLoading } = useSWR('/dashboard/integrations', fetcher);
  return { integrations: data, isLoading, error };
}

export function usePendingApprovals() {
  const { data, error, isLoading } = useSWR('/dashboard/pending-approvals', fetcher);
  return { pendingApprovals: data || [], isLoading, error };
}

export function usePendingAiDrafts() {
  const { data, error, isLoading } = useSWR('/dashboard/pending-ai-drafts', fetcher);
  return { pendingAiDrafts: data || [], isLoading, error };
}

export function useNeedsReview() {
  const { data, error, isLoading } = useSWR('/dashboard/needs-human-review', fetcher);
  return { needsReview: data || [], isLoading, error };
}

export function useTicketHeatmap(weeks = 20) {
  const { data, error, isLoading } = useSWR(`/dashboard/ticket-heatmap?weeks=${weeks}`, fetcher);
  return { heatmap: data, isLoading, error };
}

export function useWorkloadByTeam() {
  const { data, error, isLoading } = useSWR('/dashboard/workload-by-team', fetcher, {
    refreshInterval: 30000,
  });
  return { workloadByTeam: data || [], isLoading, error };
}
