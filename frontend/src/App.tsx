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
        <Route path="admin" element={<Admin />} />
        <Route path="leads" element={<Leads />} />
        <Route path="messenger" element={<Messenger />} />
        <Route path="messenger/:channelId" element={<Messenger />} />
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
