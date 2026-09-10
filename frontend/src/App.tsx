import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { trackPageview } from "@/lib/analytics";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Invite from "@/pages/Invite";
import VerifyEmail from "@/pages/VerifyEmail";
import { Loader } from "@/components/ui";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const Landing = lazy(() => import("@/pages/Landing"));
const Privacy = lazy(() => import("@/pages/Privacy"));
const Terms = lazy(() => import("@/pages/Terms"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Projects = lazy(() => import("@/pages/Projects"));
const ProjectDetail = lazy(() => import("@/pages/ProjectDetail"));
const Tasks = lazy(() => import("@/pages/Tasks"));
const TaskDetail = lazy(() => import("@/pages/TaskDetail"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const Users = lazy(() => import("@/pages/Users"));
const Settings = lazy(() => import("@/pages/Settings"));
const Profile = lazy(() => import("@/pages/Profile"));
const Admin = lazy(() => import("@/pages/Admin"));
const Leads = lazy(() => import("@/pages/Leads"));
const Messenger = lazy(() => import("@/pages/Messenger"));
const PublicForm = lazy(() => import("@/pages/PublicForm"));
const Automations = lazy(() => import("@/pages/Automations"));
const AutomationEditor = lazy(() => import("@/pages/AutomationEditor"));
const Inbox = lazy(() => import("@/pages/Inbox"));
const Mail = lazy(() => import("@/pages/Mail"));
const Wiki = lazy(() => import("@/pages/Wiki"));
const CalendarPage = lazy(() => import("@/pages/Calendar"));
const BookingPublic = lazy(() => import("@/pages/BookingPublic"));
const TimeTracking = lazy(() => import("@/pages/TimeTracking"));
const People = lazy(() => import("@/pages/People"));
const OrgChart = lazy(() => import("@/pages/OrgChart"));
const Planner = lazy(() => import("@/pages/Planner"));
const Contacts = lazy(() => import("@/pages/Contacts"));
const ProfileSettings = lazy(() => import("@/pages/ProfileSettings"));
const Activity = lazy(() => import("@/pages/Activity"));
const TimeOff = lazy(() => import("@/pages/TimeOff"));
const Deals = lazy(() => import("@/pages/Deals"));
const Reports = lazy(() => import("@/pages/Reports"));
const ProjectGantt = lazy(() => import("@/pages/ProjectGantt"));
const Whiteboard = lazy(() => import("@/pages/Whiteboard"));
const Calls = lazy(() => import("@/pages/Calls"));
const ObjectsPage = lazy(() => import("@/pages/Objects"));
const Documents = lazy(() => import("@/pages/Documents"));
const Directories = lazy(() => import("@/pages/Directories"));
const Holidays = lazy(() => import("@/pages/Holidays"));
const SecurityPolicy = lazy(() => import("@/pages/SecurityPolicy"));
const Integrations = lazy(() => import("@/pages/Integrations"));
const NotFound = lazy(() => import("@/pages/NotFound"));

function HomeGate() {
  const { me, ready } = useAuth();
  const { pathname } = useLocation();
  if (!ready) return <Loader />;
  if (!me) {
    if (pathname === "/") {
      return (
        <Suspense fallback={<Loader />}>
          <Landing />
        </Suspense>
      );
    }
    return <Navigate to="/login" replace />;
  }
  return <Layout />;
}

export default function App() {
  const { fetchMe, ready } = useAuth();
  const location = useLocation();
  useEffect(() => {
    fetchMe();
  }, []);

  useEffect(() => {
    trackPageview(location.pathname + location.search, document.title);
  }, [location.pathname, location.search]);

  if (!ready) return <Loader />;

  return (
    <ErrorBoundary>
    <Routes>
      <Route
        path="/login"
        element={
          <Suspense fallback={<Loader />}>
            <Login />
          </Suspense>
        }
      />
      <Route
        path="/register"
        element={
          <Suspense fallback={<Loader />}>
            <Register />
          </Suspense>
        }
      />
      <Route
        path="/invite/:token"
        element={
          <Suspense fallback={<Loader />}>
            <Invite />
          </Suspense>
        }
      />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route
        path="/f/:slug/:formId"
        element={
          <Suspense fallback={<Loader />}>
            <PublicForm />
          </Suspense>
        }
      />
      <Route
        path="/book/:tenantSlug/:pageSlug"
        element={
          <Suspense fallback={<Loader />}>
            <BookingPublic />
          </Suspense>
        }
      />
      <Route
        path="/privacy"
        element={
          <Suspense fallback={<Loader />}>
            <Privacy />
          </Suspense>
        }
      />
      <Route
        path="/terms"
        element={
          <Suspense fallback={<Loader />}>
            <Terms />
          </Suspense>
        }
      />
      <Route path="/" element={<HomeGate />}>
        <Route index element={<Dashboard />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="tasks/:id" element={<TaskDetail />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="users/*" element={<Users />} />
        <Route path="settings/*" element={<Settings />} />
        <Route path="profile" element={<Profile />} />
        <Route path="profile/settings" element={<ProfileSettings />} />
        <Route path="admin" element={<Admin />} />
        <Route path="leads" element={<Leads />} />
        <Route path="messenger" element={<Messenger />} />
        <Route path="messenger/:channelId" element={<Messenger />} />
        <Route path="automations" element={<Automations />} />
        <Route path="automations/new" element={<AutomationEditor />} />
        <Route path="automations/:id" element={<AutomationEditor />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="mail" element={<Mail />} />
        <Route path="wiki" element={<Wiki />} />
        <Route path="wiki/:slug" element={<Wiki />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="time" element={<TimeTracking />} />
        <Route path="people" element={<People />} />
        <Route path="people/:id" element={<Profile />} />
        <Route path="org-chart" element={<OrgChart />} />
        <Route path="planner" element={<Planner />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="activity" element={<Activity />} />
        <Route path="timeoff" element={<TimeOff />} />
        <Route path="deals" element={<Deals />} />
        <Route path="reports" element={<Reports />} />
        <Route path="projects/:id/gantt" element={<ProjectGantt />} />
        <Route path="whiteboard" element={<Whiteboard />} />
        <Route path="calls" element={<Calls />} />
        <Route path="objects" element={<ObjectsPage />} />
        <Route path="documents" element={<Documents />} />
        <Route path="directories" element={<Directories />} />
        <Route path="holidays" element={<Holidays />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="settings/security" element={<SecurityPolicy />} />
        {/* 404 внутри Layout — авторизованный юзер видит sidebar/header */}
        <Route path="*" element={<NotFound />} />
      </Route>
      {/* Публичный 404 — для неавторизованных ошибок URL */}
      <Route
        path="*"
        element={
          <Suspense fallback={<Loader />}>
            <NotFound />
          </Suspense>
        }
      />
    </Routes>
    </ErrorBoundary>
  );
}
