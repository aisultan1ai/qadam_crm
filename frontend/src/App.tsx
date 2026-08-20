import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/store/auth";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Invite from "@/pages/Invite";
import { Loader } from "@/components/ui";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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
const NotFound = lazy(() => import("@/pages/NotFound"));

function Protected({ children }: { children: React.ReactNode }) {
  const { me, ready } = useAuth();
  if (!ready) return <Loader />;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { fetchMe, ready } = useAuth();
  useEffect(() => {
    fetchMe();
  }, []);

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
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
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
