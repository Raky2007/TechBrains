import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BRANDING } from '@nexus/shared';
import { apiFetch, setStoredAdminToken } from '../../lib/api';
import { Shield, KeyRound, AlertCircle, Loader2 } from 'lucide-react';

export const AdminLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState<string>('admin');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await apiFetch<{ admin: any; token: string }>('/api/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });

      if (res.token) {
        setStoredAdminToken(res.token);
      }
      navigate('/admin');
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Check credentials.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col justify-center items-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-md bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-8 shadow-sm space-y-6"
      >
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-[#FFC928] text-[#171717] flex items-center justify-center mx-auto shadow-xs">
            <Shield className="w-6 h-6 text-[#171717]" />
          </div>
          <h1 className="text-xl font-heading font-bold text-[#171717] tracking-tight">
            Administrator Authentication
          </h1>
          <p className="text-xs text-[#737373] font-mono">
            {BRANDING.title} — Authoritative Host Access
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1.5">
              Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] font-body text-sm focus:outline-none focus:border-[#171717] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-4 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] font-body text-sm focus:outline-none focus:border-[#171717] transition-colors"
            />
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] flex items-center gap-2 text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !password}
            className="w-full py-3.5 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xs cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#171717]" />
                <span>VERIFYING CREDENTIALS...</span>
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4" />
                <span>AUTHORIZE ACCESS</span>
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
};
