/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../shared/src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        bgMain: '#FFFFFF',
        bgSecondary: '#F5F5F2',
        bgCard: '#FFFFFF',
        bgElevated: '#F5F5F2',
        textPrimary: '#171717',
        textSecondary: '#6B7280',
        textMuted: '#9CA3AF',
        borderSubtle: '#E5E5E5',
        primaryYellow: {
          DEFAULT: '#FFC928',
          hover: '#F5BE18',
          active: '#E0AD0E',
          muted: 'rgba(255, 201, 40, 0.18)'
        },
        secondaryOrange: {
          DEFAULT: '#FF8A24',
          hover: '#F27D16',
          active: '#D96B07',
          muted: 'rgba(255, 138, 36, 0.15)'
        },
        creditBadge: {
          bg: '#FFF0D6',
          text: '#B34400',
          border: '#FED7AA'
        },
        timerWarning: {
          DEFAULT: '#FF8A24',
          muted: 'rgba(255, 138, 36, 0.15)'
        },
        error: {
          DEFAULT: '#B42318',
          muted: 'rgba(180, 35, 24, 0.08)',
          border: '#FDA29B'
        },
        success: {
          DEFAULT: '#18794E',
          muted: 'rgba(24, 121, 78, 0.08)',
          border: '#A6F4C5'
        }
      },
      fontFamily: {
        heading: ['Sora', 'system-ui', '-apple-system', 'sans-serif'],
        body: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Courier New', 'monospace']
      },
      borderRadius: {
        'xs': '4px',
        'sm': '6px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px'
      }
    },
  },
  plugins: [],
}
