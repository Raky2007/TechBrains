import React from 'react';

/**
 * Global footer shown on every screen (participant and admin):
 * Department of CSE (AI & ML) · Powered by Gradient.
 */
export const AppFooter: React.FC = () => (
  <footer className="border-t border-[#E5E5E5] bg-[#FFFFFF] py-3.5 px-5 sm:px-10">
    <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs text-[#737373]">
      <span className="font-heading font-semibold tracking-wide text-[#171717]">
        Department of CSE (AI &amp; ML)
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider">Powered by</span>
        <img src="/gradient_logo.png" alt="" aria-hidden="true" className="h-5 w-auto object-contain" />
        <span className="font-heading font-bold text-[#171717]">Gradient</span>
      </span>
    </div>
  </footer>
);
