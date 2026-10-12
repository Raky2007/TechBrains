import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Global branded header shown on every screen (participant and admin):
 * SPEC logo · TECHBRAINS wordmark + tagline · Gradient logo.
 */
export const AppHeader: React.FC = () => (
  <header className="border-b border-[#E5E5E5] bg-[#FFFFFF] py-3 px-5 sm:px-10">
    <div className="max-w-7xl mx-auto grid grid-cols-[auto_1fr_auto] items-center gap-3 sm:gap-6">
      <img src="/spec_logo.png" alt="SPEC" className="h-8 sm:h-11 w-auto object-contain" />
      <Link to="/" className="text-center min-w-0 group" title="TechBrains">
        <span className="block font-heading font-extrabold text-base sm:text-2xl tracking-[0.18em] text-[#FFC928] leading-none group-hover:text-[#F5B800] transition-colors">
          TECHBRAINS
        </span>
        <span className="block mt-1 text-[8px] sm:text-[10px] font-mono uppercase tracking-[0.32em] text-[#737373]">
          Think Smart · Think Fast
        </span>
      </Link>
      <img src="/gradient_logo.png" alt="Gradient" className="h-8 sm:h-11 w-auto object-contain justify-self-end" />
    </div>
  </header>
);
