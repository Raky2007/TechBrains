import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Layouts
import { TeamLayout } from './layouts/TeamLayout';
import { AdminLayout } from './layouts/AdminLayout';

// Participant Pages
import { JoinPage } from './pages/JoinPage';
import { WaitingRoomPage } from './pages/WaitingRoomPage';
import { Level1GamePage } from './pages/Level1GamePage';
import { Level2GamePage } from './pages/Level2GamePage';
import { LeaderboardPage } from './pages/LeaderboardPage';

// Admin Pages
import { AdminLoginPage } from './pages/admin/AdminLoginPage';
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage';
import { AdminControlPage } from './pages/admin/AdminControlPage';
import { AdminQuestionsPage } from './pages/admin/AdminQuestionsPage';
import { AdminCasesPage } from './pages/admin/AdminCasesPage';
import { AdminTeamsPage } from './pages/admin/AdminTeamsPage';
import { AdminSubmissionsPage } from './pages/admin/AdminSubmissionsPage';
import { AdminLeaderboardPage } from './pages/admin/AdminLeaderboardPage';
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Participant Entry */}
        <Route path="/" element={<JoinPage />} />

        {/* Authenticated Participant Routes */}
        <Route element={<TeamLayout />}>
          <Route path="/waiting" element={<WaitingRoomPage />} />
          <Route path="/level1" element={<Level1GamePage />} />
          <Route path="/level2" element={<Level2GamePage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
        </Route>

        {/* Admin Login */}
        <Route path="/admin/login" element={<AdminLoginPage />} />

        {/* Protected Admin Routes */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminOverviewPage />} />
          <Route path="control" element={<AdminControlPage />} />
          <Route path="questions" element={<AdminQuestionsPage />} />
          <Route path="cases" element={<AdminCasesPage />} />
          <Route path="teams" element={<AdminTeamsPage />} />
          <Route path="submissions" element={<AdminSubmissionsPage />} />
          <Route path="leaderboard" element={<AdminLeaderboardPage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
