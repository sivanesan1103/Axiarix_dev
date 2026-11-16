import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState, FullPageLoader } from '@/components/common';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage } from '@/pages/auth/AuthPages';
import { DashboardPage } from '@/pages/DashboardPage';
import { GuestOnly, RequireAuth, RequirePermission } from './guards';

/** Code-split each module so the initial bundle stays small. */
function page(loader: () => Promise<Record<string, unknown>>, name: string) {
  const C = lazy(async () => ({ default: (await loader())[name] as ComponentType }));
  return <C />;
}

/** Platform owners have no organisation dashboard; they land on the organisations list. */
function HomeRoute() {
  const { user } = useAuth();
  if (user?.isPlatformOwner) return <Navigate to="/platform" replace />;
  return guard(['dashboard:read'], <DashboardPage />);
}

const guard = (any: string[], el: ReactNode) => (
  <RequirePermission any={any}>
    <Suspense fallback={<FullPageLoader />}>{el}</Suspense>
  </RequirePermission>
);

export const router = createBrowserRouter([
  { path: '/login', element: <GuestOnly><LoginPage /></GuestOnly> },
  { path: '/forgot-password', element: <GuestOnly><ForgotPasswordPage /></GuestOnly> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomeRoute /> },
      { path: 'platform', element: guard(['platform:manage'], page(() => import('@/pages/platform/PlatformPage'), 'PlatformPage')) },
      { path: 'platform/new', element: guard(['platform:manage'], page(() => import('@/pages/platform/NewOrganisationPage'), 'NewOrganisationPage')) },
      { path: 'admin', element: guard(['organisation:update', 'organisation:create', 'user:create'], page(() => import('@/pages/AdminHomePage'), 'AdminHomePage')) },
      { path: 'organisation', element: guard(['organisation:read'], page(() => import('@/pages/OrganisationPage'), 'OrganisationPage')) },
      { path: 'users', element: guard(['user:read'], page(() => import('@/pages/UsersPage'), 'UsersPage')) },
      { path: 'checklists', element: guard(['checklist:read'], page(() => import('@/pages/checklists/ChecklistsPage'), 'ChecklistsPage')) },
      { path: 'checklists/import', element: guard(['checklist:create'], page(() => import('@/pages/checklists/ImportWizardPage'), 'ImportWizardPage')) },
      { path: 'checklists/import/:importId', element: guard(['checklist:create'], page(() => import('@/pages/checklists/ImportWizardPage'), 'ImportWizardPage')) },
      { path: 'checklists/:id', element: guard(['checklist:read'], page(() => import('@/pages/checklists/ChecklistDetailPage'), 'ChecklistDetailPage')) },
      { path: 'checklists/:id/versions/:versionId', element: guard(['checklist:read'], page(() => import('@/pages/checklists/ChecklistEditorPage'), 'ChecklistEditorPage')) },
      { path: 'assessments', element: guard(['assessment:read'], page(() => import('@/pages/assessments/AssessmentsPage'), 'AssessmentsPage')) },
      { path: 'assessments/new', element: guard(['assessment:create'], page(() => import('@/pages/assessments/NewAssessmentPage'), 'NewAssessmentPage')) },
      { path: 'assessments/:id', element: guard(['assessment:read'], page(() => import('@/pages/assessments/AssessmentDetailPage'), 'AssessmentDetailPage')) },
      { path: 'my-assessments', element: guard(['assessment:read'], page(() => import('@/pages/assessments/MyAssessmentsPage'), 'MyAssessmentsPage')) },
      { path: 'my-assessments/:id', element: guard(['assessment:read'], page(() => import('@/pages/assessments/WorkspacePage'), 'WorkspacePage')) },
      { path: 'evidence', element: guard(['evidence:read'], page(() => import('@/pages/EvidencePage'), 'EvidencePage')) },
      { path: 'auditor', element: guard(['assessment:review'], page(() => import('@/pages/auditor/AuditorPage'), 'AuditorPage')) },
      { path: 'auditor/:id', element: guard(['assessment:review', 'assessment:read'], page(() => import('@/pages/assessments/WorkspacePage'), 'AuditorReviewPage')) },
      { path: 'findings', element: guard(['finding:read'], page(() => import('@/pages/findings/FindingsPage'), 'FindingsPage')) },
      { path: 'findings/:id', element: guard(['finding:read'], page(() => import('@/pages/findings/FindingDetailPage'), 'FindingDetailPage')) },
      { path: 'corrective-actions', element: guard(['corrective_action:read'], page(() => import('@/pages/findings/ActionsPage'), 'ActionsPage')) },
      { path: 'corrective-actions/:id', element: guard(['corrective_action:read'], page(() => import('@/pages/findings/ActionDetailPage'), 'ActionDetailPage')) },
      { path: 'reports', element: guard(['report:read'], page(() => import('@/pages/ReportsPage'), 'ReportsPage')) },
      { path: 'audit-trail', element: guard(['audit_log:read'], page(() => import('@/pages/AuditTrailPage'), 'AuditTrailPage')) },
      { path: 'settings', element: guard([], page(() => import('@/pages/SettingsPage'), 'SettingsPage')) },
      {
        path: '*',
        element: <EmptyState title="Page not found" description="The page you requested does not exist." action={<Link className="text-brand hover:underline" to="/">Go to dashboard</Link>} />,
      },
    ],
  },
]);
